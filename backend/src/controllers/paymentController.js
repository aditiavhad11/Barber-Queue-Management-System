import crypto from "node:crypto";
import { pool } from "../config/db.js";
import { evaluateScheme } from "../services/schemeService.js";
import {
  QUEUE_ERRORS,
  validateQueueCapacity,
} from "../services/queueCapacityService.js";
import { recordBookingTransition } from "../services/bookingStateMachine.js";
import { jsonIds, parseJson } from "../utils/json.js";
import { money } from "../utils/money.js";
import { AppError } from "../utils/AppError.js";
import {
  clockMinutes,
  localDateKey,
  localTimeKey,
  minutesBetween,
  nowTimeIST,
  todayIST,
  weekdayIST,
} from "../utils/time.js";
import {
  addNotification,
  findBookings,
  hydrateBookings,
  rupees,
} from "../models/bookingModel.js";
import {
  isValidEmail,
  isValidPhone,
  isValidName,
  normalizePhone,
} from "../utils/validators.js";

const REBOOK_BLOCK_MINUTES = 30;
const AMOUNT_WINDOW_MINUTES = 15;

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const signQuote = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.JWT_SECRET || "missing-secret")
    .update(body)
    .digest("hex");
  return `${body}.${signature}`;
};
const verifyQuote = (token) => {
  try {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature) return null;
    const expected = crypto
      .createHmac("sha256", process.env.JWT_SECRET || "missing-secret")
      .update(body)
      .digest("hex");
    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};



function assertAnnualScheduleAllowsBooking(availability, bookingDate) {
  const schedules =
    availability?.annualSchedules &&
    typeof availability.annualSchedules === "object"
      ? availability.annualSchedules
      : {};
  const item = schedules[bookingDate];
  if (!item) return;
  const type = String(item.type || "closed");
  const note = String(item.note || "").trim();
  if (type === "closed") {
    const suffix = note ? `: ${note}` : ".";
    throw Object.assign(new Error(`This shop is closed today${suffix}`), {
      status: 409,
    });
  }
  if (
    ["half_day", "special_hours"].includes(type) &&
    bookingDate === localDateKey()
  ) {
    const open = String(item.open || "09:00").slice(0, 5);
    const close = String(item.close || "21:00").slice(0, 5);
    const now = localTimeKey();
    if (close <= open || now < open || now >= close) {
      const label = type === "half_day" ? "half-day hours" : "special hours";
      throw Object.assign(
        new Error(
          `This shop is only accepting bookings during ${label} today (${open}-${close}).`,
        ),
        { status: 409 },
      );
    }
  }
}

function beneficiaryFrom(body, customer) {
  const raw = body?.beneficiary || {};
  if (raw.isSelf === false) {
    const person = {
      isSelf: false,
      name: String(raw.name || "").trim(),
      mobile: String(raw.mobile || "").trim(),
      email: String(raw.email || "")
        .trim()
        .toLowerCase(),
    };
    if (!person.name || !isValidName(person.name))
      return {
        error:
          "Enter a valid name (2 to 60 alphabetic characters) for the person being booked for.",
      };
    if (person.mobile && !isValidPhone(person.mobile))
      return { error: "Enter a valid 10-digit mobile number." };
    if (person.email && !isValidEmail(person.email))
      return { error: "Enter a valid email address." };
    return {
      person: {
        ...person,
        mobile: person.mobile ? normalizePhone(person.mobile) : "",
      },
      key: `beneficiary:${person.name.toLowerCase()}|${person.mobile || person.email || ""}`,
    };
  }
  const selfMobile = String(raw.mobile || "").trim();
  if (selfMobile && !isValidPhone(selfMobile)) {
    return { error: "Enter a valid 10-digit mobile number." };
  }
  return {
    person: {
      isSelf: true,
      name: customer.name,
      mobile: selfMobile ? normalizePhone(selfMobile) : "",
      email: customer.email,
    },
    key: `user:${customer.id}`,
  };
}

async function validateSelection(
  connection,
  {
    shopId,
    barberId,
    serviceIds,
    serviceQuantities,
    customerId,
    bookingDate,
    scheduledTime = null,
  },
) {
  const [shops] = await connection.query(
    "SELECT id,name,upi_qr_url,availability_json FROM shops WHERE id=? AND status='approved' AND active=1 LIMIT 1",
    [shopId],
  );
  if (!shops.length)
    throw AppError.notFound(
      "This shop is not accepting bookings right now.",
      "SHOP_NOT_FOUND",
    );

  const [closures] = await connection
    .query(
      `SELECT id, closure_type, start_at, end_at, reason
       FROM emergency_closures
       WHERE shop_id=? AND status='active' AND (end_at IS NULL OR end_at > NOW())
       ORDER BY start_at DESC`,
      [shopId],
    )
    .catch(() => [[]]);

  const avail = parseJson(shops[0].availability_json, {});
  const now = new Date();
  const today = todayIST(now);
  const currentTime = nowTimeIST(now);

  const ongoingClosure = closures.find((c) => {
    const start = new Date(c.start_at);
    const end = c.end_at ? new Date(c.end_at) : null;
    return start <= now && (!end || end > now);
  });

  if (ongoingClosure || (avail.isOpen === false && !avail.emergencyClosed)) {
    throw AppError.conflict("This shop is currently closed.", "SHOP_CLOSED");
  }
  const bookingWeekday = weekdayIST(bookingDate);
  const annual = avail.annualSchedules?.[bookingDate];
  const schedule = avail.schedule?.[bookingWeekday];
  const manualOpenToday = bookingDate === today && avail.isOpen === true;
  if (
    !manualOpenToday &&
    (annual?.type === "closed" || (!annual && schedule?.closed))
  ) {
    throw AppError.conflict(
      "This shop is closed on the selected booking date.",
      "SHOP_CLOSED_ON_DATE",
    );
  }
  if (bookingDate === today) {
    const override = avail.operationalHours;
    const shifts =
      override?.enabled && (!override.date || override.date === today)
        ? [{ open: override.open, close: override.close }]
        : annual && ["half_day", "special_hours"].includes(annual.type)
          ? [{ open: annual.open, close: annual.close }]
          : Array.isArray(schedule?.shifts) && schedule.shifts.length
            ? schedule.shifts
            : [
                {
                  open: schedule?.open || "09:00",
                  close: schedule?.close || "21:00",
                },
              ];
    if (
      (!manualOpenToday &&
        (annual?.type === "closed" || (!annual && schedule?.closed))) ||
      (!manualOpenToday &&
        !shifts.some(
          (shift) => currentTime >= shift.open && currentTime < shift.close,
        ))
    ) {
      throw AppError.conflict(
        "This shop is outside its booking hours right now.",
        "OUTSIDE_BOOKING_HOURS",
      );
    }
  }

  // Emergency closure check (emergency_closures table is single source of truth)
  for (const c of closures) {
    const startAt = new Date(c.start_at);
    const endAt = c.end_at ? new Date(c.end_at) : null;
    if (endAt && endAt <= now) continue;

    const startDate = todayIST(startAt);
    const endDate = endAt ? todayIST(endAt) : "";

    const hourClosureApplies =
      c.closure_type === "hours" &&
      bookingDate === startDate &&
      startAt <= now &&
      (!endAt || now < endAt);

    const dayClosureApplies =
      c.closure_type !== "hours" &&
      bookingDate >= startDate &&
      (!endDate || bookingDate <= endDate);

    if (hourClosureApplies || dayClosureApplies) {
      const reasonPart = c.reason ? ` (${c.reason})` : "";
      const untilPart = endDate ? ` until ${endDate}` : "";
      throw AppError.conflict(
        `This shop is temporarily closed for emergency${reasonPart}${untilPart}.`,
        "SHOP_EMERGENCY_CLOSED",
      );
    }
  }

  // Fallback for legacy / mock availability_json with temporaryClosure
  const tc = avail?.temporaryClosure;
  if (!closures.length && tc && tc.active) {
    if (tc.endAt && new Date(tc.endAt) <= now) {
      // The server-side timestamp is authoritative; expired closure ignored
    } else {
      const start = tc.startDate || today;
      const end = tc.endDate || "";
      const hourClosureApplies =
        tc.startAt &&
        bookingDate === String(tc.startAt).slice(0, 10) &&
        new Date(tc.startAt) <= now &&
        (!tc.endAt || now < new Date(tc.endAt));
      const dayClosureApplies =
        !tc.startAt && bookingDate >= start && (!end || bookingDate <= end);
      if (hourClosureApplies || dayClosureApplies) {
        const reasonPart = tc.reason ? ` (${tc.reason})` : "";
        const untilPart = end ? ` until ${end}` : "";
        throw AppError.conflict(
          `This shop is temporarily closed for emergency${reasonPart}${untilPart}.`,
          "SHOP_EMERGENCY_CLOSED",
        );
      }
    }
  }
  if (!manualOpenToday) assertAnnualScheduleAllowsBooking(avail, bookingDate);

  if (!shops[0].upi_qr_url)
    throw AppError.conflict(
      "This shop can't take bookings yet.",
      "SHOP_NOT_CONFIGURED",
    );

  const [barbers] = await connection.query(
    "SELECT id,status,queue_limit FROM barbers WHERE id=? AND shop_id=? LIMIT 1",
    [barberId, shopId],
  );
  if (!barbers.length)
    throw Object.assign(
      new Error("Selected barber was not found in this shop."),
      { status: 404 },
    );
  if (barbers[0].status !== "Available")
    throw Object.assign(new Error("This barber is not available right now."), {
      status: 409,
    });

  const marks = serviceIds.map(() => "?").join(",");
  const [services] = await connection.query(
    `SELECT id,name,price,duration_minutes FROM services WHERE shop_id=? AND enabled=1 AND id IN (${marks})`,
    [shopId, ...serviceIds],
  );
  if (services.length !== serviceIds.length)
    throw Object.assign(
      new Error("One or more selected services are not available."),
      { status: 400 },
    );

  let unavailable;
  try {
    [unavailable] = await connection.query(
      `SELECT u.service_id, s.name, u.reason
       FROM service_unavailability u
       JOIN services s ON s.id=u.service_id AND s.shop_id=u.shop_id
       WHERE u.shop_id=? AND u.unavailable_date=? AND u.service_id IN (${marks})`,
      [shopId, bookingDate, ...serviceIds],
    );
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE")
      throw Object.assign(
        new Error("Service availability could not be checked right now."),
        { status: 503 },
      );
    throw error;
  }
  if (unavailable.length) {
    const details = unavailable.map((row) => {
      const dateLabel = new Date(`${bookingDate}T12:00:00Z`).toLocaleDateString(
        "en-IN",
        { day: "numeric", month: "long", timeZone: "UTC" },
      );
      return `${row.name} is unavailable on ${dateLabel}${row.reason ? `. Reason: ${row.reason}` : "."}`;
    });
    throw Object.assign(new Error(details.join(" ")), { status: 409 });
  }

  const [offered] = await connection.query(
    `SELECT service_id FROM barber_services WHERE barber_id=? AND service_id IN (${marks})`,
    [barberId, ...serviceIds],
  );
  if (offered.length !== serviceIds.length)
    throw Object.assign(
      new Error("This barber does not offer all selected services."),
      { status: 400 },
    );

  const [users] = await connection.query(
    "SELECT id,name,email FROM users WHERE id=? AND role='customer' AND status='active' LIMIT 1",
    [customerId],
  );
  if (!users.length)
    throw Object.assign(new Error("Customer account not found."), {
      status: 403,
    });

  const amount = services.reduce((sum, x) => sum + Number(x.price) * serviceQuantities[String(x.id)], 0);
  const duration = services.reduce((sum, x) => sum + Number(x.duration_minutes) * serviceQuantities[String(x.id)], 0);
  if (!(amount > 0))
    throw Object.assign(new Error("A valid payment amount is required."), {
      status: 400,
    });
  await validateScheduledSlot(connection, {
    shop: shops[0],
    barberId,
    bookingDate,
    scheduledTime,
    duration,
  });
  return { shop: shops[0], services, customer: users[0], amount, duration, serviceQuantities };
}

function normalizeQuantities(raw, serviceIds) {
  const values = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const quantities = Object.fromEntries(serviceIds.map((id) => [id, Number(values[id] ?? 1)]));
  if (Object.values(quantities).some((qty) => !Number.isInteger(qty) || qty < 1 || qty > 20))
    throw Object.assign(new Error("Service quantities must be whole numbers from 1 to 20."), { status: 400 });
  if (Object.keys(values).some((id) => !serviceIds.includes(String(id))))
    throw Object.assign(new Error("Service quantities do not match the selected services."), { status: 400 });
  return quantities;
}


function requestedBookingDate(value) {
  const date = String(value || "");
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00Z`)
    : null;
  if (
    !parsed ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw Object.assign(new Error("Select a valid booking date."), {
      status: 400,
    });
  const today = todayIST();
  if (date < today)
    throw Object.assign(new Error("Choose today or a future booking date."), {
      status: 400,
    });
  return date;
}

function requestedScheduledTime(value, bookingDate) {
  const time = String(value || "").trim();
  if (!time) return null;
  if (bookingDate !== localDateKey())
    throw Object.assign(
      new Error("Same-day scheduling is available for today only."),
      { status: 400 },
    );
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw Object.assign(new Error("Select a valid appointment time."), {
      status: 400,
    });
  if (time <= localTimeKey())
    throw Object.assign(new Error("Choose a future appointment time."), {
      status: 409,
    });
  return time;
}

async function validateScheduledSlot(
  connection,
  { shop, barberId, bookingDate, scheduledTime, duration },
) {
  if (!scheduledTime) return;
  const availability = parseJson(shop.availability_json, {});
  const weekday = weekdayIST(bookingDate);
  const annual = availability.annualSchedules?.[bookingDate];
  const schedule = availability.schedule?.[weekday];
  const shifts = availability.operationalHours?.enabled
    ? [
        {
          open: availability.operationalHours.open,
          close: availability.operationalHours.close,
        },
      ]
    : annual && ["half_day", "special_hours"].includes(annual.type)
      ? [{ open: annual.open, close: annual.close }]
      : schedule?.shifts?.length
        ? schedule.shifts
        : [
            {
              open: schedule?.open || "09:00",
              close: schedule?.close || "21:00",
            },
          ];
  const start = clockMinutes(scheduledTime);
  const end = start + Number(duration);
  const fits = shifts.some((shift) => {
    const open = clockMinutes(shift.open, "09:00");
    const close = clockMinutes(shift.close, "21:00");
    return (
      start !== null &&
      open !== null &&
      close !== null &&
      start >= open &&
      end <= close
    );
  });
  if (!fits)
    throw Object.assign(
      new Error(
        "That appointment would fall outside the shop's operating hours.",
      ),
      { status: 409 },
    );
  const [conflicts] = await connection.query(
    `SELECT id FROM payment_bookings
     WHERE shop_id=? AND barber_id=? AND booking_date=? AND scheduled_time IS NOT NULL
       AND (
         status IN ('payment_submitted','accepted')
         AND COALESCE(queue_status, '') NOT IN
           ('Cancelled','Completed','No Show')
       )
       AND scheduled_time < ADDTIME(?, SEC_TO_TIME(duration_minutes * 60))
       AND ADDTIME(scheduled_time, SEC_TO_TIME(? * 60)) > ? LIMIT 1`,
    [shop.id, barberId, bookingDate, scheduledTime, duration, scheduledTime],
  );
  if (conflicts.length)
    throw AppError.conflict(
      QUEUE_ERRORS.APPOINTMENT_OVERLAP.message,
      QUEUE_ERRORS.APPOINTMENT_OVERLAP.code,
    );
}

async function validateQueueDuration(connection, shopId, barberId, bookingDate, duration) {
  if (bookingDate !== localDateKey()) return;
  const [active] = await connection.query(
    `SELECT COUNT(*) AS total,COALESCE(SUM(duration_minutes),0) AS minutes
     FROM payment_bookings WHERE shop_id=? AND barber_id=? AND status='accepted'
       AND queue_status IN ('Waiting','Your Turn','In Service')`,
    [shopId, barberId],
  );
  const [next] = await connection.query(
    `SELECT scheduled_time FROM payment_bookings WHERE shop_id=? AND barber_id=? AND booking_date=?
       AND scheduled_time IS NOT NULL AND status IN ('payment_submitted','accepted')
       AND COALESCE(queue_status,'') NOT IN ('Cancelled','Completed','No Show')
       AND scheduled_time > TIME(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))
     ORDER BY scheduled_time LIMIT 1`,
    [shopId, barberId, bookingDate],
  );
  if (!next.length) return;
  if (
    Number(active[0]?.minutes || 0) + duration >
    minutesBetween(localTimeKey(), next[0].scheduled_time)
  )
    throw AppError.conflict(
      QUEUE_ERRORS.APPOINTMENT_OVERLAP.message,
      QUEUE_ERRORS.APPOINTMENT_OVERLAP.code,
    );
}

async function chooseAmount(connection, shopId, baseAmount) {
  const [rows] = await connection.query(
    `SELECT amount FROM payment_bookings
     WHERE shop_id=? AND status='payment_submitted'
       AND created_at > (NOW() - INTERVAL ${AMOUNT_WINDOW_MINUTES} MINUTE)`,
    [shopId],
  );

  const used = new Set(rows.map((r) => Number(r.amount).toFixed(2)));
  let amount = Math.round(Number(baseAmount) * 100) / 100;
  while (used.has(amount.toFixed(2)))
    amount = Math.round((amount + 0.01) * 100) / 100;
  return amount;
}

async function expireStalePending(connection, customerId, beneficiaryKey, actor) {
  const [expired] = await connection.query(
    `SELECT id,status,queue_status FROM payment_bookings
     WHERE customer_id=? AND beneficiary_key=? AND status='payment_submitted'
       AND created_at <= (NOW() - INTERVAL ${NEW_CUSTOMER_RESERVATION_MINUTES} MINUTE)
     FOR UPDATE`,
    [customerId, beneficiaryKey],
  );
  for (const booking of expired) {
    await recordBookingTransition(connection, {
      bookingId: booking.id,
      toBookingStatus: "cancelled",
      actorId: actor?.sub,
      actorRole: actor?.role || "system",
      action: "payment_reservation_expired",
      current: booking,
    });
    await connection.query(
      `UPDATE payment_bookings
       SET status='cancelled', decline_reason='Confirmation window expired'
       WHERE id=? AND status='payment_submitted'`,
      [booking.id],
    );
  }
}

function responsePayload(booking, shop, services) {
  return {
    bookingId: booking.id,
    amount: Number(booking.amount),
    currency: "INR",
    qrUrl: shop.upi_qr_url,
    shopName: shop.name,
    description: services.map((x) => x.name).join(", "),
  };
}

// Read-only quote used by the pay screen. The actual submit endpoint recalculates everything again.
export async function paymentQuote(req, res) {
  const connection = await pool.getConnection();
  try {
    const customerId = req.user.sub;
    const shopId = String(req.body?.shopId || "");
    const barberId = String(req.body?.barberId || "");
    let bookingDate;
    try {
      bookingDate = requestedBookingDate(req.body?.bookingDate);
    } catch (error) {
      return res.status(error.status).json({ message: error.message });
    }
    let scheduledTime;
    try {
      scheduledTime = requestedScheduledTime(
        req.body?.scheduledTime,
        bookingDate,
      );
    } catch (error) {
      return res.status(error.status).json({ message: error.message });
    }
    const serviceIds = [
      ...new Set(
        (Array.isArray(req.body?.serviceIds) ? req.body.serviceIds : []).map(
          String,
        ),
      ),
    ].sort();
    const serviceQuantities = normalizeQuantities(req.body?.serviceQuantities, serviceIds);
    if (!shopId || !barberId || !serviceIds.length)
      return res.status(400).json({
        message: "Shop, barber and at least one service are required.",
      });

    const { shop, services, customer, amount } = await validateSelection(
      connection,
      { shopId, barberId, serviceIds, serviceQuantities, customerId, bookingDate, scheduledTime },
    );
    const who = beneficiaryFrom(req.body, customer);
    if (who.error) return res.status(400).json({ message: who.error });

    await connection.beginTransaction();
    try {
      await expireStalePending(connection, customerId, who.key, req.user);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    }

    const [pending] = await connection.query(
      "SELECT id FROM payment_bookings WHERE customer_id=? AND beneficiary_key=? AND status='payment_submitted' LIMIT 1",
      [customerId, who.key],
    );
    if (pending.length)
      return res.status(409).json({
        message: "You already have a payment waiting for this booking.",
        bookingId: pending[0].id,
      });

    const [blocked] = await connection.query(
      "SELECT id FROM payment_bookings WHERE shop_id=? AND customer_id=? AND status='rejected' AND declined_until > NOW() ORDER BY declined_until DESC LIMIT 1",
      [shopId, customerId],
    );
    if (blocked.length)
      return res.status(429).json({
        message:
          "This booking cannot be retried for 30 minutes after a declined payment.",
        bookingId: blocked[0].id,
      });

    const applied = await evaluateScheme(connection, {
      shopId,
      barberId,
      serviceIds,
      services,
      serviceQuantities,
      customerId,
      bookingDate,
      scheduledTime,
      promoCode: req.body?.promoCode,
      bogoOfferId: req.body?.bogoOfferId,
      rewardServiceQuantities: req.body?.rewardServiceQuantities,
    });
    if (applied.duration) {
      await validateScheduledSlot(connection, { shop, barberId, bookingDate, scheduledTime, duration: applied.duration });
      if (!scheduledTime) await validateQueueDuration(connection, shopId, barberId, bookingDate, applied.duration);
      await validateQueueCapacity(connection, {
        shopId,
        barberId,
        bookingDate,
        lock: false,
      });
    }
    const finalAmount = applied.scheme?.offerType === "bogo" ? applied.discountedSubtotal : await chooseAmount(connection, shopId, applied.discountedSubtotal);
    const quotePayload = {
      customerId,
      shopId,
      barberId,
      serviceIds,
      serviceQuantities,
      bookingDate,
      scheduledTime,
      beneficiaryKey: who.key,
      amount: finalAmount,
      originalAmount: applied.originalAmount,
      discountAmount: applied.discountAmount,
      schemeId: applied.schemeId,
      promoCode: applied.promoCode,
      discountedSubtotal: applied.discountedSubtotal,
      freeServiceQuantities: applied.freeServiceQuantities || {},
      rewardServiceQuantities: applied.rewardServiceQuantities || {},
      qrUrl: shop.upi_qr_url,
      exp: Date.now() + AMOUNT_WINDOW_MINUTES * 60 * 1000,
    };
    res.json({
      ...responsePayload({ id: null, amount: finalAmount }, shop, services),
      originalAmount: applied.originalAmount,
      discountAmount: applied.discountAmount,
      freeServiceQuantities: applied.freeServiceQuantities || {},
      paidAmount: applied.discountedSubtotal,
      scheme: applied.scheme,
      offerMessages: applied.offerMessages || [],
      quoteToken: signQuote(quotePayload),
    });
  } catch (error) {
    throw error;
  } finally {
    connection.release();
  }
}

// The customer only reaches this endpoint after paying the exact amount shown on the pay screen.
// The server recalculates prices, beneficiary rules, duplicate rules and the amount before creating the booking.
export async function submitPayment(req, res) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const customerId = req.user.sub;
    const shopId = String(req.body?.shopId || "");
    const barberId = String(req.body?.barberId || "");
    const bookingDate = requestedBookingDate(req.body?.bookingDate);
    const scheduledTime = requestedScheduledTime(
      req.body?.scheduledTime,
      bookingDate,
    );
    const serviceIds = [
      ...new Set(
        (Array.isArray(req.body?.serviceIds) ? req.body.serviceIds : []).map(
          String,
        ),
      ),
    ].sort();
    const serviceQuantities = normalizeQuantities(req.body?.serviceQuantities, serviceIds);
    if (!shopId || !barberId || !serviceIds.length)
      throw Object.assign(
        new Error("Shop, barber and at least one service are required."),
        { status: 400 },
      );

    // Serialize submissions for the same customer so a double-click cannot create two pending bookings.
    const [customerRows] = await connection.query(
      "SELECT id FROM users WHERE id=? AND role='customer' AND status='active' FOR UPDATE",
      [customerId],
    );
    if (!customerRows.length)
      throw Object.assign(new Error("Customer account not found."), {
        status: 403,
      });

    const {
      shop,
      services,
      customer,
      amount: baseAmount,
      duration,
    } = await validateSelection(connection, {
      shopId,
      barberId,
      serviceIds,
      serviceQuantities,
      bookingDate,
      customerId,
      scheduledTime,
    });
    const who = beneficiaryFrom(req.body, customer);
    if (who.error) throw Object.assign(new Error(who.error), { status: 400 });

    await expireStalePending(connection, customerId, who.key, req.user);

    const [pending] = await connection.query(
      "SELECT id FROM payment_bookings WHERE customer_id=? AND beneficiary_key=? AND status='payment_submitted' LIMIT 1",
      [customerId, who.key],
    );
    if (pending.length)
      throw Object.assign(
        new Error("You already have a payment waiting for the shop."),
        { status: 409, bookingId: pending[0].id },
      );

    const [blocked] = await connection.query(
      "SELECT id FROM payment_bookings WHERE shop_id=? AND customer_id=? AND status='rejected' AND declined_until > NOW() ORDER BY declined_until DESC LIMIT 1",
      [shopId, customerId],
    );
    if (blocked.length)
      throw Object.assign(
        new Error(
          "This booking cannot be retried for 30 minutes after a declined payment.",
        ),
        { status: 429, bookingId: blocked[0].id },
      );

    const quote = verifyQuote(req.body?.quoteToken);
    const selectionMatches =
      quote &&
      quote.customerId === customerId &&
      quote.shopId === shopId &&
      quote.barberId === barberId &&
      quote.bookingDate === bookingDate &&
      quote.scheduledTime === scheduledTime &&
      quote.beneficiaryKey === who.key &&
      quote.qrUrl === shop.upi_qr_url &&
      JSON.stringify(quote.serviceIds) === JSON.stringify(serviceIds);
    const quantitiesMatch = JSON.stringify(quote?.serviceQuantities) === JSON.stringify(serviceQuantities);
    if (!selectionMatches || !quantitiesMatch)
      throw Object.assign(
        new Error(
          "Payment amount could not be verified. Reopen the payment screen and try again.",
        ),
        { status: 400 },
      );

    const applied = await evaluateScheme(connection, {
      shopId,
      barberId,
      serviceIds,
      services,
      serviceQuantities,
      customerId,
      bookingDate,
      scheduledTime,
      promoCode: quote.promoCode,
      schemeId: quote.schemeId,
      rewardServiceQuantities: quote.rewardServiceQuantities || {},
      lock: Boolean(quote.schemeId),
    });
    if (applied.duration) {
      await validateScheduledSlot(connection, { shop, barberId, bookingDate, scheduledTime, duration: applied.duration });
      if (!scheduledTime) await validateQueueDuration(connection, shopId, barberId, bookingDate, applied.duration);
      await validateQueueCapacity(connection, {
        shopId,
        barberId,
        bookingDate,
        lock: true,
      });
    }
    if (
      money(applied.originalAmount) !== money(quote.originalAmount) ||
      money(applied.discountAmount) !== money(quote.discountAmount) ||
      money(applied.discountedSubtotal) !== money(quote.discountedSubtotal)
      || JSON.stringify(applied.freeServiceQuantities || {}) !== JSON.stringify(quote.freeServiceQuantities || {})
    )
      throw Object.assign(
        new Error(
          "Offer eligibility or discount changed. Reopen the payment screen for an updated quote.",
        ),
        { status: 409 },
      );

    const finalAmount = Number(quote.amount);
    if (!Number.isFinite(finalAmount) || finalAmount <= 0)
      throw Object.assign(new Error("Invalid payment amount."), {
        status: 400,
      });

    const bookingId = crypto.randomUUID();
    const requestHash = sha256(
      [
        shopId,
        barberId,
        serviceIds.join(","),
        JSON.stringify(serviceQuantities),
        applied.schemeId || "",
        JSON.stringify(applied.freeServiceQuantities || {}),
        bookingDate,
        scheduledTime || "",
        scheduledTime,
        who.key,
        finalAmount.toFixed(2),
      ].join("|"),
    );

    const [recentSame] = await connection.query(
      `SELECT id FROM payment_bookings
       WHERE customer_id=? AND request_hash=? AND status='payment_submitted'
         AND created_at > (NOW() - INTERVAL ${REBOOK_BLOCK_MINUTES} MINUTE)
       LIMIT 1`,
      [customerId, requestHash],
    );
    if (recentSame.length)
      throw Object.assign(
        new Error(
          "This payment submission is already being checked by the shop.",
        ),
        { status: 409, bookingId: recentSame[0].id },
      );

    await connection.query(
      `INSERT INTO payment_bookings
   (
     id, shop_id, barber_id, customer_id, booking_date, scheduled_time, service_ids_json, service_quantities_json, free_service_quantities_json,
     amount, original_amount, discount_amount, scheme_id, duration_minutes, beneficiary_json, beneficiary_key,
     request_hash, payment_method, status, payer_name, payment_submitted_at
   )
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        bookingId,
        shopId,
        barberId,
        customerId,
        bookingDate,
        scheduledTime,
        JSON.stringify(serviceIds),
        JSON.stringify(serviceQuantities),
        JSON.stringify(applied.freeServiceQuantities || {}),
        finalAmount,
        applied.originalAmount,
        applied.discountAmount,
        applied.schemeId,
        applied.duration || duration,
        JSON.stringify(who.person),
        who.key,
        requestHash,
        "upi_qr",
        "payment_submitted",
        String(req.body?.payerName || "")
          .trim()
          .slice(0, 120) || customer.name,
      ],
    );
    await recordBookingTransition(connection, {
      bookingId,
      toBookingStatus: "payment_submitted",
      actorId: customerId,
      actorRole: "customer",
      action: "payment_submitted",
      metadata: { shopId, barberId, amount: finalAmount, bookingDate, scheduledTime },
      current: { status: null, queue_status: null },
    });

    await connection.commit();

    const rows = await findBookings("b.id=?", [bookingId], "LIMIT 1");
    const hydrated = await hydrateBookings(rows);
    const booking = hydrated[0];

    if (!booking) {
      throw Object.assign(
        new Error("Booking was created but could not be loaded."),
        { status: 500 },
      );
    }
    const payer = booking.payerName || booking.customerName;
    const bookedFor =
      booking.beneficiary?.isSelf === false
        ? `for ${booking.beneficiary.name}, booked by ${booking.customerName}`
        : booking.customerName;

    await addNotification({
      shopId,
      tone: "info",
      refId: bookingId,
      text: `New payment submitted: ${rupees(booking.amount)} by ${payer} for ${bookedFor}. ${booking.services.map((x) => x.name).join(" + ")} with ${booking.barberName}.`,
    });

    await addNotification({
      userId: customerId,
      tone: "info",
      refId: bookingId,
      text: `Payment submitted for ${rupees(booking.amount)} at ${booking.shopName}. The shop is checking your payment.`,
    });

    res.status(201).json({ booking });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
