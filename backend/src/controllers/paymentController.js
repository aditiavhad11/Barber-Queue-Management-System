import crypto from "node:crypto";
import { pool } from "../config/db.js";
import { calculateBogoReward, barberCanFulfillBogo, findBogoServiceOverlap, normalizeBogoRewardSelection } from "../utils/bogoOffer.js";
import { hasActiveNewCustomerOfferReservation, hasSuccessfulCompletedBooking, isOfferValueWithinCap, NEW_CUSTOMER_RESERVATION_MINUTES } from "../utils/offerEligibility.js";
import { isWithinHappyHour } from "../utils/happyHour.js";
import { calculateOfferDiscount } from "../utils/offerDiscount.js";
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

const localDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
};

const localTimeKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick("hour")}:${pick("minute")}`;
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
    throw Object.assign(
      new Error("This shop is not accepting bookings right now."),
      { status: 404 },
    );

  const avail =
    typeof shops[0].availability_json === "string"
      ? JSON.parse(shops[0].availability_json || "{}")
      : shops[0].availability_json || {};
  const now = new Date();
  const istParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const part = (type) => istParts.find((item) => item.type === type)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const currentTime = `${part("hour")}:${part("minute")}`;
  const emergencyEnd = avail.temporaryClosure?.endAt
    ? new Date(avail.temporaryClosure.endAt)
    : null;
  const emergencyExpired =
    avail.emergencyClosed && emergencyEnd && emergencyEnd <= new Date();
  if (avail.isOpen === false && !emergencyExpired) {
    throw Object.assign(new Error("This shop is currently closed."), {
      status: 409,
    });
  }
  const bookingWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  }).format(new Date(`${bookingDate}T12:00:00Z`));
  const annual = avail.annualSchedules?.[bookingDate];
  const schedule = avail.schedule?.[bookingWeekday];
  const manualOpenToday = bookingDate === today && avail.isOpen === true;
  if (
    !manualOpenToday &&
    (annual?.type === "closed" || (!annual && schedule?.closed))
  ) {
    throw Object.assign(
      new Error("This shop is closed on the selected booking date."),
      {
        status: 409,
      },
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
      throw Object.assign(
        new Error("This shop is outside its booking hours right now."),
        { status: 409 },
      );
    }
  }
  const tc = avail?.temporaryClosure;
  if (tc && tc.active) {
    if (tc.endAt && new Date(tc.endAt) <= new Date()) {
      // The server-side timestamp is authoritative; an expired hour closure
      // must not keep blocking new bookings because the UI was not refreshed.
    } else {
      const start = tc.startDate || today;
      const end = tc.endDate || "";
      const hourClosureApplies =
        tc.startAt &&
        bookingDate === String(tc.startAt).slice(0, 10) &&
        new Date(tc.startAt) <= new Date() &&
        (!tc.endAt || new Date() < new Date(tc.endAt));
      const dayClosureApplies =
        !tc.startAt && bookingDate >= start && (!end || bookingDate <= end);
      if (hourClosureApplies || dayClosureApplies) {
        const reasonPart = tc.reason ? ` (${tc.reason})` : "";
        const untilPart = end ? ` until ${end}` : "";
        throw Object.assign(
          new Error(
            `This shop is temporarily closed for emergency${reasonPart}${untilPart}.`,
          ),
          { status: 409 },
        );
      }
    }
  }
  if (!manualOpenToday) assertAnnualScheduleAllowsBooking(avail, bookingDate);

  if (!shops[0].upi_qr_url)
    throw Object.assign(new Error("This shop can't take bookings yet."), {
      status: 409,
    });

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
  if (!scheduledTime && bookingDate === localDateKey()) {
    const limit = Number(barbers[0].queue_limit || 0);
    const [active] = await connection.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(duration_minutes),0) AS minutes
       FROM payment_bookings
       WHERE shop_id=? AND barber_id=? AND status='accepted'
         AND queue_status IN ('Waiting','Your Turn','In Service')`,
      [shopId, barberId],
    );
    const expectedWait = Number(active[0].minutes || 0);
    if (Number(active[0].total || 0) >= limit)
      throw Object.assign(
        new Error(
          `Cannot take in queue till for next ${expectedWait} minutes, as queue is full.`,
        ),
        { status: 409 },
      );
    const [nextAppointment] = await connection.query(
      `SELECT scheduled_time FROM payment_bookings
       WHERE shop_id=? AND barber_id=? AND booking_date=? AND scheduled_time IS NOT NULL
         AND (
           status IN ('payment_submitted','accepted')
           AND COALESCE(queue_status, '') NOT IN
             ('Cancelled','Completed','No Show')
         )
         AND scheduled_time > TIME(NOW())
       ORDER BY scheduled_time ASC LIMIT 1`,
      [shopId, barberId, bookingDate],
    );
    if (nextAppointment.length) {
      const now = localTimeKey();
      const toMinutes = (value) =>
        Number(String(value).slice(0, 2)) * 60 +
        Number(String(value).slice(3, 5));
      if (
        expectedWait + duration >
        toMinutes(nextAppointment[0].scheduled_time) - toMinutes(now)
      )
        throw Object.assign(
          new Error(
            `Cannot take in queue till for next ${expectedWait} minutes, as queue is full.`,
          ),
          { status: 409 },
        );
    }
  }
  await validateScheduledSlot(connection, {
    shop: shops[0],
    barberId,
    bookingDate,
    scheduledTime,
    duration,
  });
  return { shop: shops[0], services, customer: users[0], amount, duration, serviceQuantities };
}

const jsonIds = (value) => {
  if (Array.isArray(value)) return value.map(String);
  try {
    return JSON.parse(value || "[]").map(String);
  } catch {
    return [];
  }
};
const money = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;
function normalizeQuantities(raw, serviceIds) {
  const values = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const quantities = Object.fromEntries(serviceIds.map((id) => [id, Number(values[id] ?? 1)]));
  if (Object.values(quantities).some((qty) => !Number.isInteger(qty) || qty < 1 || qty > 20))
    throw Object.assign(new Error("Service quantities must be whole numbers from 1 to 20."), { status: 400 });
  if (Object.keys(values).some((id) => !serviceIds.includes(String(id))))
    throw Object.assign(new Error("Service quantities do not match the selected services."), { status: 400 });
  return quantities;
}

async function evaluateScheme(
  connection,
  {
    shopId,
    barberId,
    serviceIds,
    serviceQuantities,
    services,
    customerId,
    bookingDate,
    scheduledTime = null,
    promoCode,
    bogoOfferId,
    rewardServiceQuantities = {},
    schemeId,
    lock = false,
  },
) {
  const code = String(promoCode || "")
    .trim()
    .toUpperCase();
  if (rewardServiceQuantities != null && (typeof rewardServiceQuantities !== "object" || Array.isArray(rewardServiceQuantities)))
    throw Object.assign(new Error("Free reward selections must be provided as service quantities."), { status: 400 });
  const hasRewardSelection = Object.keys(rewardServiceQuantities || {}).length > 0;
  const evaluationNow = new Date();
  let sql = `SELECT * FROM schemes WHERE shop_id=? AND status='active'
    AND starts_at<=UTC_TIMESTAMP() AND ends_at>=UTC_TIMESTAMP()`;
  const params = [shopId];
  if (schemeId) {
    sql += " AND id=?";
    params.push(schemeId);
  } else if (code) {
    sql += " AND UPPER(promo_code)=?";
    params.push(code);
  } else sql += " AND promo_code IS NULL";
  if (bogoOfferId && !schemeId) {
    sql += " AND id=?";
    params.push(bogoOfferId);
  }
  sql += lock ? " FOR UPDATE" : "";
  const [candidates] = await connection.query(sql, params);
  if (!candidates.length && code)
    throw Object.assign(
      new Error("This promo code is not active or valid for this booking."),
      { status: 400 },
    );
  if (schemeId && !candidates.length)
    throw Object.assign(
      new Error("This offer is no longer valid. Request a new payment quote."),
      { status: 409 },
    );
  if (bogoOfferId && !candidates.length)
    throw Object.assign(new Error("This BOGO offer is no longer eligible. Refresh the booking and choose rewards again."), { status: 409 });

  const serviceById = new Map(
    services.map((service) => [String(service.id), service]),
  );
  let customerHasCompletedBooking = false;
  let customerHasNewCustomerReservation = false;
  if (candidates.some((offer) => Boolean(offer.new_customer_only))) {
    const [completedRows] = await connection.query(
      `SELECT status,queue_status FROM payment_bookings
       WHERE customer_id=? AND status IN ('accepted','paid') AND queue_status='Completed' LIMIT 1`,
      [customerId],
    );
    customerHasCompletedBooking = hasSuccessfulCompletedBooking(completedRows);
    if (!customerHasCompletedBooking) {
      const [reservationRows] = await connection.query(
        `SELECT status,queue_status FROM payment_bookings
         WHERE customer_id=? AND (
           (status='payment_submitted' AND created_at > (NOW() - INTERVAL ${NEW_CUSTOMER_RESERVATION_MINUTES} MINUTE))
           OR (status IN ('accepted','paid') AND COALESCE(queue_status,'') NOT IN ('Cancelled','No Show'))
         )
           AND scheme_id IN (SELECT id FROM schemes WHERE new_customer_only=1) LIMIT 1`,
        [customerId],
      );
      customerHasNewCustomerReservation = hasActiveNewCustomerOfferReservation(reservationRows);
    }
  }
  const baseAmount = money(services.reduce((sum, service) => sum + Number(service.price) * serviceQuantities[String(service.id)], 0));
  let bestAutomatic = null;
  let ineligibleBogoBarber = false;
  const offerMessages = [];
  for (const offer of candidates) {
    if (bogoOfferId && offer.offer_type !== 'bogo') throw Object.assign(new Error('The selected offer is not a BOGO offer.'), { status: 400 });
    if (offer.happy_hour_start_time != null || offer.happy_hour_end_time != null) {
      const happyHourDays = jsonIds(offer.happy_hour_days_json);
      if (!isWithinHappyHour({
        startTime: offer.happy_hour_start_time,
        endTime: offer.happy_hour_end_time,
        days: happyHourDays,
        bookingDate,
        scheduledTime,
        now: evaluationNow,
      })) {
        const dayText = happyHourDays.length ? ` on ${happyHourDays.join(", ")}` : "";
        const message = `${offer.title} is available from ${String(offer.happy_hour_start_time || "").slice(0, 5)} to ${String(offer.happy_hour_end_time || "").slice(0, 5)}${dayText} in shop local time (end time excluded).`;
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error(message), { status: 400 });
        offerMessages.push(`${message} It was not applied to this booking.`);
        continue;
      }
    }
    if (offer.new_customer_only && (customerHasCompletedBooking || customerHasNewCustomerReservation)) {
      const message = customerHasCompletedBooking
        ? "This new-customer offer is only available before your first completed booking."
        : "A new-customer offer is already reserved by another pending booking.";
      if (code || schemeId || bogoOfferId) throw Object.assign(new Error(message), { status: 403 });
      offerMessages.push(`${offer.title} was not applied: ${message}`);
      continue;
    }
    const eligibleServiceIds = offer.all_services
      ? serviceIds
      : jsonIds(offer.service_ids_json).filter((id) => serviceById.has(id));
    if (!eligibleServiceIds.length) {
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error("This offer does not apply to the selected services."),
          { status: 400 },
        );
      if (offer.offer_type === "bogo") offerMessages.push(`${offer.title} was not applied: select the required purchased services shown in the offer details.`);
      continue;
    }
    if (
      !offer.all_barbers &&
      !jsonIds(offer.barber_ids_json).includes(String(barberId))
    ) {
      if (offer.offer_type === "bogo") {
        const requiredIds = jsonIds(offer.service_ids_json);
        const requiredQuantities = typeof offer.required_service_quantities_json === "string"
          ? JSON.parse(offer.required_service_quantities_json || "{}")
          : offer.required_service_quantities_json || {};
        const qualifies = requiredIds.length > 0 && requiredIds.every((id) =>
          serviceById.has(id) && Number(serviceQuantities[id] || 0) >= Number(requiredQuantities[id] || 0),
        );
        if (qualifies) throw Object.assign(new Error("This BOGO offer is not available with the selected barber. Choose an eligible barber or change the selected services."), { status: 400 });
      }
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error("This offer does not apply to the selected barber."),
          { status: 400 },
        );
      if (offer.offer_type === "bogo") offerMessages.push(`${offer.title} was not applied: it is not available with the selected barber.`);
      continue;
    }
    if (baseAmount < Number(offer.minimum_amount || 0)) {
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error(
            `This offer requires a minimum booking amount of ₹${Number(offer.minimum_amount).toFixed(2)}.`,
          ),
          { status: 400 },
        );
      if (offer.offer_type === "bogo") offerMessages.push(`${offer.title} was not applied: the booking does not meet its minimum amount of ₹${Number(offer.minimum_amount).toFixed(2)}.`);
      continue;
    }
    const [useRows] = await connection.query(
      `SELECT COUNT(*) AS uses,COALESCE(SUM(customer_id=?),0) AS customer_uses
       FROM payment_bookings WHERE scheme_id=? AND (
         (status='payment_submitted' AND created_at > (NOW() - INTERVAL ${NEW_CUSTOMER_RESERVATION_MINUTES} MINUTE))
         OR (status IN ('accepted','paid') AND COALESCE(queue_status,'') NOT IN ('Cancelled','No Show'))
       )`,
      [customerId, offer.id],
    );
    const uses = Number(useRows[0]?.uses || 0);
    const customerUses = Number(useRows[0]?.customer_uses || 0);
    if (
      (offer.usage_limit != null && uses >= Number(offer.usage_limit)) ||
      (offer.per_customer_limit != null &&
        customerUses >= Number(offer.per_customer_limit))
    ) {
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error("This offer has reached its redemption limit."),
          { status: 409 },
        );
      if (offer.offer_type === "bogo") offerMessages.push(`${offer.title} was not applied because its redemption limit has been reached.`);
      continue;
    }
    const eligibleSubtotal = money(eligibleServiceIds.reduce((sum, id) => sum + Number(serviceById.get(id).price) * serviceQuantities[id], 0));
    if (offer.offer_type === "bogo") {
      const requiredIds = jsonIds(offer.service_ids_json);
      const configuredRewardIds = jsonIds(offer.reward_service_ids_json);
      if (findBogoServiceOverlap(requiredIds, [...configuredRewardIds, ...(offer.reward_service_id ? [String(offer.reward_service_id)] : [])]))
        throw Object.assign(new Error("This BOGO offer has a service configured as both paid and free."), { status: 400 });
      const requiredQuantities = typeof offer.required_service_quantities_json === "string"
        ? JSON.parse(offer.required_service_quantities_json || "{}")
        : offer.required_service_quantities_json || {};
      const allRequiredSelected = requiredIds.length > 0 && requiredIds.every((id) => serviceById.has(id));
      if (!allRequiredSelected) {
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error("Select all required services for this offer."), { status: 400 });
        offerMessages.push(`${offer.title} was not applied: select all of its required services and quantities.`);
        continue;
      }
      const requiredQuantitiesMet = requiredIds.every((id) => Number(serviceQuantities[id] || 0) >= Number(requiredQuantities[id] || 0));
      if (!requiredQuantitiesMet) {
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error("The selected paid service quantities do not meet this BOGO offer's requirements."), { status: 400 });
        offerMessages.push(`${offer.title} was not applied: increase the required paid service quantities.`);
        continue;
      }
      let freeServiceQuantities;
      let rewardTargets;
      if (configuredRewardIds.length) {
        const selection = normalizeBogoRewardSelection(rewardServiceQuantities, configuredRewardIds, Number(offer.max_reward_count || 1));
        if (!selection) {
          if (code || schemeId || bogoOfferId) throw Object.assign(new Error(`Choose between 1 and ${Number(offer.max_reward_count || 1)} valid free rewards for this offer.`), { status: 400 });
          offerMessages.push(`${offer.title}: choose free reward(s) to apply this offer.`);
          continue;
        }
        freeServiceQuantities = selection.quantities;
        const rewardIds = Object.keys(freeServiceQuantities);
        const [rows] = await connection.query(
          `SELECT id,name,price,duration_minutes FROM services WHERE shop_id=? AND enabled=1 AND id IN (${rewardIds.map(() => "?").join(",")})`,
          [shopId, ...rewardIds],
        );
        if (rows.length !== rewardIds.length) throw Object.assign(new Error("One or more selected free rewards are no longer active in this shop."), { status: 400 });
        rewardTargets = rows;
      } else {
        if (hasRewardSelection) throw Object.assign(new Error("This existing offer does not allow reward selection."), { status: 400 });
        const [rewardRows] = await connection.query(
          "SELECT id,name,price,duration_minutes FROM services WHERE shop_id=? AND id=? AND enabled=1 LIMIT 1",
          [shopId, offer.reward_service_id],
        );
        const legacyReward = rewardRows[0];
        const reward = legacyReward ? calculateBogoReward(requiredIds.map((id) => serviceById.get(id)), serviceQuantities, requiredQuantities, Number(offer.free_quantity || 0), legacyReward) : null;
        if (!reward) {
          if (code || schemeId || bogoOfferId) throw Object.assign(new Error("The required services, quantities, or reward service are no longer valid for this offer."), { status: 400 });
          offerMessages.push(`${offer.title} was not applied because its required quantities or configured reward service are unavailable.`);
          continue;
        }
        freeServiceQuantities = { [reward.serviceId]: reward.quantity };
        rewardTargets = [legacyReward];
      }
      const rewardIds = Object.keys(freeServiceQuantities);
      const rewardsById = new Map(rewardTargets.map((reward) => [String(reward.id), reward]));
      const rewardCount = Object.values(freeServiceQuantities).reduce((sum, quantity) => sum + Number(quantity), 0);
      const discount = money(rewardIds.reduce((sum, id) => sum + Number(rewardsById.get(id).price) * Number(freeServiceQuantities[id]), 0));
      if (!isOfferValueWithinCap(discount, offer.maximum_discount)) {
        const message = `The selected BOGO rewards exceed this offer's maximum reward value of ₹${Number(offer.maximum_discount).toFixed(2)}.`;
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error(message), { status: 400 });
        offerMessages.push(`${offer.title} was not applied: ${message}`);
        continue;
      }
      const rewardDuration = rewardIds.reduce((sum, id) => sum + Number(rewardsById.get(id).duration_minutes) * Number(freeServiceQuantities[id]), 0);
      const rewardNames = rewardIds.map((id) => ({ id, name: rewardsById.get(id).name, quantity: Number(freeServiceQuantities[id]) }));
      const eligible = {
        schemeId: offer.id, discountAmount: discount, originalAmount: money(baseAmount + discount),
        discountedSubtotal: baseAmount, freeServiceQuantities,
        rewardServiceQuantities: configuredRewardIds.length ? freeServiceQuantities : {},
        duration: services.reduce((sum, service) => sum + Number(service.duration_minutes) * serviceQuantities[String(service.id)], 0) + rewardDuration,
        promoCode: offer.promo_code || "",
        scheme: { id: offer.id, title: offer.title, offerType: "bogo", requiredServices: requiredIds.map((id) => ({ id, name: serviceById.get(id).name, quantity: Number(requiredQuantities[id]) })), buyQuantity: Object.values(requiredQuantities).reduce((sum, qty) => sum + Number(qty), 0), freeQuantity: rewardCount, maxRewardCount: Number(offer.max_reward_count || offer.free_quantity || 1), rewardServiceId: rewardIds[0], rewardServiceName: rewardsById.get(rewardIds[0])?.name, rewardServices: rewardNames },
      };
      const [barberCanReward] = await connection.query(
        `SELECT service_id FROM barber_services WHERE barber_id=? AND service_id IN (${[...requiredIds, ...rewardIds].map(() => "?").join(",")})`,
        [barberId, ...requiredIds, ...rewardIds],
      );
      if (!barberCanFulfillBogo(barberCanReward.map((row) => row.service_id), requiredIds, rewardIds)) {
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error(`The selected barber cannot provide all required services for ${offer.title}, including the selected free reward(s). Choose another barber or change the selected services.`), { status: 400 });
        ineligibleBogoBarber = true;
        continue;
      }
      const [unavailableReward] = await connection.query(
        `SELECT service_id FROM service_unavailability WHERE shop_id=? AND service_id IN (${rewardIds.map(() => "?").join(",")}) AND unavailable_date=? LIMIT 1`,
        [shopId, ...rewardIds, bookingDate],
      );
      if (unavailableReward.length) {
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error("One or more selected free services are unavailable on the selected date."), { status: 409 });
        offerMessages.push(`${offer.title} was not applied because one or more selected rewards are unavailable on the selected date.`);
        continue;
      }
      if (code || schemeId || bogoOfferId) return eligible;
      if (!bestAutomatic || eligible.discountAmount > bestAutomatic.discountAmount) bestAutomatic = eligible;
      continue;
    }
    if (hasRewardSelection) throw Object.assign(new Error("Free rewards can only be selected for an eligible BOGO offer."), { status: 400 });
    const discount = calculateOfferDiscount({
      eligibleSubtotal,
      baseAmount,
      discountType: offer.discount_type,
      discountValue: offer.discount_value,
      maximumDiscount: offer.maximum_discount,
    });
    if (discount >= baseAmount) {
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error("This offer cannot reduce the booking to a zero payment."),
          { status: 400 },
        );
      continue;
    }
    if (discount <= 0) {
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error(
            "This offer does not provide a discount for the selected services.",
          ),
          { status: 400 },
        );
      continue;
    }
    const eligible = {
      schemeId: offer.id,
      discountAmount: discount,
      originalAmount: baseAmount,
      discountedSubtotal: money(baseAmount - discount),
      promoCode: offer.promo_code || "",
      scheme: {
        id: offer.id,
        title: offer.title,
        offerType: "discount",
        discountType: offer.discount_type,
        discountValue: Number(offer.discount_value),
      },
    };
    if (code || schemeId || bogoOfferId) return eligible;
    if (
      !bestAutomatic ||
      eligible.discountAmount > bestAutomatic.discountAmount
    )
      bestAutomatic = eligible;
  }
  if (bestAutomatic) {
    if (hasRewardSelection && bestAutomatic.scheme?.offerType !== "bogo") throw Object.assign(new Error("Free rewards can only be selected for an eligible BOGO offer."), { status: 400 });
    return { ...bestAutomatic, offerMessages };
  }
  if (ineligibleBogoBarber) throw Object.assign(new Error("The selected barber cannot provide the free service for this BOGO offer. Choose an eligible barber or change the selected services."), { status: 400 });
  if (hasRewardSelection) throw Object.assign(new Error("Free rewards can only be selected for an eligible BOGO offer."), { status: 400 });
  return {
    schemeId: null,
    discountAmount: 0,
    originalAmount: baseAmount,
    discountedSubtotal: baseAmount,
    freeServiceQuantities: {},
    promoCode: "",
    scheme: null,
    offerMessages,
  };
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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const today = `${parts.find((x) => x.type === "year").value}-${parts.find((x) => x.type === "month").value}-${parts.find((x) => x.type === "day").value}`;
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

function clockMinutes(value, fallback) {
  const match = String(value || fallback).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours > 23 ||
    minutes > 59
  )
    return null;
  return hours * 60 + minutes;
}

async function validateScheduledSlot(
  connection,
  { shop, barberId, bookingDate, scheduledTime, duration },
) {
  if (!scheduledTime) return;
  const availability =
    typeof shop.availability_json === "string"
      ? JSON.parse(shop.availability_json || "{}")
      : shop.availability_json || {};
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  }).format(new Date(`${bookingDate}T12:00:00Z`));
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
    throw Object.assign(
      new Error("That time overlaps another scheduled appointment."),
      { status: 409 },
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
       AND scheduled_time > TIME(NOW()) ORDER BY scheduled_time LIMIT 1`,
    [shopId, barberId, bookingDate],
  );
  if (!next.length) return;
  const toMinutes = (value) => Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5));
  if (Number(active[0]?.minutes || 0) + duration > toMinutes(next[0].scheduled_time) - toMinutes(localTimeKey()))
    throw Object.assign(new Error("This booking duration would overlap the next scheduled appointment."), { status: 409 });
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

async function expireStalePending(connection, customerId, beneficiaryKey) {
  await connection.query(
    `UPDATE payment_bookings
     SET status='cancelled', decline_reason='Confirmation window expired'
     WHERE customer_id=? AND beneficiary_key=? AND status='payment_submitted'
       AND created_at <= (NOW() - INTERVAL ${NEW_CUSTOMER_RESERVATION_MINUTES} MINUTE)`,
    [customerId, beneficiaryKey],
  );
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

    await expireStalePending(connection, customerId, who.key);

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
    res
      .status(error.status || 500)
      .json({ message: error.message || "Could not prepare payment." });
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

    await expireStalePending(connection, customerId, who.key);

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
    console.log(error);
    await connection.rollback().catch(() => {});
    res.status(error.status || 500).json({
      message: error.message || "Could not submit the payment.",
      bookingId: error.bookingId,
      amount: error.amount,
    });
  } finally {
    connection.release();
  }
}
