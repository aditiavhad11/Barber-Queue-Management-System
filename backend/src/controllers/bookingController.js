import { pool } from "../config/db.js";
import crypto from "node:crypto";
import {
  addNotification,
  findBookings,
  hydrateBookings,
  rupees,
} from "../models/bookingModel.js";
import {
  recalculateScheduledBookings,
  requestScheduledQueueRecalculation,
  scheduledQueueDate,
} from "../services/scheduledQueueService.js";

const jsonArray = (value) => {
  if (Array.isArray(value)) return value.map(String);
  try {
    return JSON.parse(value || "[]").map(String);
  } catch {
    return [];
  }
};
const money = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const SERVICE_EDIT_QUEUE_STATUSES = ["Waiting", "Your Turn"];

function mapServiceEdit(row, serviceMap = new Map()) {
  const oldIds = jsonArray(row.old_service_ids_json);
  const requestedIds = jsonArray(row.requested_service_ids_json);
  const details = (ids) =>
    ids
      .map((id) => serviceMap.get(id))
      .filter(Boolean)
      .map((service) => ({
        id: service.id,
        name: service.name,
        price: Number(service.price),
        duration: Number(service.duration_minutes),
      }));
  return {
    id: row.id,
    requestKey: row.request_key,
    bookingId: row.booking_id,
    queueId: row.queue_id,
    token: row.token,
    customerId: row.customer_id,
    customerName: row.customer_name,
    shopId: row.shop_id,
    shopName: row.shop_name,
    barberId: row.barber_id,
    barberName: row.barber_name,
    oldServiceIds: oldIds,
    requestedServiceIds: requestedIds,
    oldServices: details(oldIds),
    requestedServices: details(requestedIds),
    amountDelta: Number(row.amount_delta),
    proposedTotal: Number(row.proposed_total),
    proposedDuration: Number(row.proposed_duration),
    paymentReference: row.payment_reference || "",
    payerName: row.payer_name || "",
    status: row.status,
    paymentStatus: row.payment_status,
    refundStatus: row.refund_status,
    resolutionNote: row.resolution_note || "",
    resolvedBy: row.resolved_by || null,
    resolvedByRole: row.resolved_by_role || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

async function serviceMapForEditRows(rows) {
  const ids = [
    ...new Set(
      rows.flatMap((row) => [
        ...jsonArray(row.old_service_ids_json),
        ...jsonArray(row.requested_service_ids_json),
      ]),
    ),
  ];
  if (!ids.length) return new Map();
  const [services] = await pool.query(
    `SELECT id,name,price,duration_minutes FROM services WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  return new Map(services.map((service) => [service.id, service]));
}

async function validateEditedServices(connection, booking, serviceIds) {
  const ids = serviceIds;
  if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
    throw Object.assign(
      new Error("Choose between 1 and 20 different services."),
      { status: 400 },
    );
  const marks = ids.map(() => "?").join(",");
  const [services] = await connection.query(
    `SELECT id,name,price,duration_minutes,enabled FROM services WHERE shop_id=? AND id IN (${marks})`,
    [booking.shop_id, ...ids],
  );
  if (
    services.length !== ids.length ||
    services.some((service) => !service.enabled)
  )
    throw Object.assign(
      new Error(
        "One or more selected services are no longer available at this shop.",
      ),
      { status: 400 },
    );
  const availability =
    typeof booking.availability_json === "string"
      ? (() => {
          try {
            return JSON.parse(booking.availability_json || "{}");
          } catch {
            return {};
          }
        })()
      : booking.availability_json || {};
  if (availability.annualSchedules?.[booking.booking_date]?.type === "closed")
    throw Object.assign(new Error("The shop is closed on this booking date."), {
      status: 409,
    });
  const [barbers] = await connection.query(
    "SELECT status FROM barbers WHERE id=? AND shop_id=? LIMIT 1",
    [booking.barber_id, booking.shop_id],
  );
  if (!barbers.length || barbers[0].status !== "Available")
    throw Object.assign(
      new Error(
        "The selected barber is not available for service changes right now.",
      ),
      { status: 409 },
    );
  let unavailable;
  try {
    [unavailable] = await connection.query(
      `SELECT s.name,u.reason FROM service_unavailability u
       JOIN services s ON s.id=u.service_id AND s.shop_id=u.shop_id
       WHERE u.shop_id=? AND u.unavailable_date=? AND u.service_id IN (${marks})`,
      [booking.shop_id, booking.booking_date, ...ids],
    );
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE")
      throw Object.assign(
        new Error("Service availability could not be checked right now."),
        { status: 503 },
      );
    throw error;
  }
  if (unavailable.length)
    throw Object.assign(
      new Error(
        `${unavailable[0].name} is unavailable on the booking date${unavailable[0].reason ? `: ${unavailable[0].reason}` : "."}`,
      ),
      { status: 409 },
    );
  return ids.map((id) => services.find((service) => service.id === id));
}

export async function requestServiceEdit(req, res) {
  const bookingId = String(req.params.id || "");
  const requestKey = String(
    req.get("Idempotency-Key") || req.body?.requestKey || "",
  );

  const input = req.body?.serviceIds;
  const serviceIds = Array.isArray(input) ? input.map((id) => String(id)) : [];

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestKey))
    return res
      .status(400)
      .json({ message: "A valid edit request key is required." });

  if (
    !serviceIds.length ||
    serviceIds.length > 20 ||
    new Set(serviceIds).size !== serviceIds.length
  )
    return res
      .status(400)
      .json({ message: "Choose between 1 and 20 different services." });

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [bookings] = await connection.query(
      `SELECT b.*,DATE_FORMAT(COALESCE(b.booking_date,DATE(b.accepted_at),DATE(b.created_at)),'%Y-%m-%d') AS edit_booking_date,
              s.name AS shop_name,s.upi_qr_url,s.status AS shop_status,s.active AS shop_active,s.availability_json
       FROM payment_bookings b JOIN shops s ON s.id=b.shop_id
       WHERE b.id=? AND b.customer_id=? LIMIT 1 FOR UPDATE`,
      [bookingId, req.user.sub],
    );
    if (!bookings.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Booking not found." });
    }
    const booking = bookings[0];
    const [priorKey] = await connection.query(
      "SELECT * FROM booking_service_edits WHERE customer_id=? AND request_key=? LIMIT 1",
      [req.user.sub, requestKey],
    );
    if (priorKey.length) {
      if (priorKey[0].booking_id !== bookingId) {
        await connection.rollback();
        return res.status(409).json({
          message: "This request key was already used for another booking.",
        });
      }
      const priorServices = await serviceMapForEditRows(priorKey);
      await connection.commit();
      return res.json({
        edit: mapServiceEdit(priorKey[0], priorServices),
        repeated: true,
      });
    }
    if (
      booking.status !== "accepted" ||
      !SERVICE_EDIT_QUEUE_STATUSES.includes(booking.queue_status)
    ) {
      await connection.rollback();
      return res.status(409).json({
        message: "Services can only be edited while this booking is waiting.",
      });
    }
    if (booking.shop_status !== "approved" || !booking.shop_active) {
      await connection.rollback();
      return res.status(409).json({
        message: "This shop is not accepting service changes right now.",
      });
    }
    const currentIds = jsonArray(booking.service_ids_json);
    if (
      serviceIds.length === currentIds.length &&
      serviceIds.every((id) => currentIds.includes(id))
    ) {
      await connection.commit();
      return res.json({
        unchanged: true,
        message: "The booking already has those services.",
      });
    }
    const [activeRequests] = await connection.query(
      `SELECT * FROM booking_service_edits WHERE booking_id=? AND status IN ('payment_review','refund_review') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [bookingId],
    );
    if (activeRequests.length) {
      if (
        JSON.stringify(
          jsonArray(activeRequests[0].requested_service_ids_json).sort(),
        ) === JSON.stringify([...serviceIds].sort())
      ) {
        const priorServices = await serviceMapForEditRows(activeRequests);
        await connection.commit();
        return res.json({
          edit: mapServiceEdit(activeRequests[0], priorServices),
          repeated: true,
        });
      }
      await connection.rollback();
      return res.status(409).json({
        message: "A service edit is already waiting for the shop to review.",
      });
    }
    booking.booking_date = booking.edit_booking_date;
    const services = await validateEditedServices(
      connection,
      booking,
      serviceIds,
    );
    const oldIds = currentIds;
    const [currentServices] = await connection.query(
      `SELECT id,name,price,duration_minutes FROM services WHERE shop_id=? AND id IN (${oldIds.map(() => "?").join(",")})`,
      [booking.shop_id, ...oldIds],
    );
    if (currentServices.length !== oldIds.length) {
      await connection.rollback();
      return res.status(409).json({
        message:
          "The existing service details could not be verified; contact the shop.",
      });
    }
    const currentBase = money(
      currentServices.reduce((sum, service) => sum + Number(service.price), 0),
    );
    const requestedBase = money(
      services.reduce((sum, service) => sum + Number(service.price), 0),
    );
    const amountDelta = money(requestedBase - currentBase);
    const [appliedRows] = await connection.query(
      "SELECT COALESCE(SUM(amount_delta),0) AS total FROM booking_service_edits WHERE booking_id=? AND status='applied'",
      [bookingId],
    );
    const newTotal = money(
      Number(booking.amount) + Number(appliedRows[0].total) + amountDelta,
    );
    const payerName = String(req.body?.payerName || "")
      .trim()
      .slice(0, 120);
    if (amountDelta > 0 && (!booking.upi_qr_url || !payerName)) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "Pay the additional amount using the shop's UPI QR and enter your payer name.",
      });
    }
    const status = amountDelta < 0 ? "refund_review" : "applied";
    const editId = crypto.randomUUID();
    const duration = services.reduce(
      (sum, service) => sum + Number(service.duration_minutes),
      0,
    );
    await connection.query(
      `INSERT INTO booking_service_edits
       (id,request_key,booking_id,customer_id,shop_id,barber_id,old_service_ids_json,requested_service_ids_json,
        amount_delta,proposed_total,proposed_duration,payment_reference,payer_name,status,payment_status,refund_status,resolution_note,resolved_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        editId,
        requestKey,
        bookingId,
        req.user.sub,
        booking.shop_id,
        booking.barber_id,
        JSON.stringify(oldIds),
        JSON.stringify(serviceIds),
        amountDelta,
        newTotal,
        duration,
        null,
        amountDelta > 0 ? payerName : null,
        status,
        amountDelta > 0 ? "verified" : "not_required",
        amountDelta < 0 ? "requested" : "not_required",
        amountDelta > 0
          ? "Customer confirmed the additional UPI payment."
          : null,
        amountDelta >= 0 ? new Date() : null,
      ],
    );
    if (status === "applied") {
      await connection.query(
        "UPDATE payment_bookings SET service_ids_json=?,duration_minutes=? WHERE id=? AND status='accepted' AND queue_status IN ('Waiting','Your Turn')",
        [JSON.stringify(serviceIds), duration, bookingId],
      );
      await connection.query(
        "INSERT INTO notifications(id,user_id,shop_id,tone,text,ref_id) VALUES (?,?,?,?,?,?)",
        [
          crypto.randomUUID(),
          req.user.sub,
          booking.shop_id,
          "ok",
          `Your services for token #${booking.token} were updated. New total: ₹${newTotal.toFixed(2)}.`,
          bookingId,
        ],
      );
      await connection.query(
        "INSERT INTO notifications(id,shop_id,tone,text,ref_id) VALUES (?,?,?,?,?)",
        [
          crypto.randomUUID(),
          booking.shop_id,
          "info",
          `Token #${booking.token} service selection was updated by the customer.`,
          bookingId,
        ],
      );
    } else {
      await connection.query(
        "INSERT INTO notifications(id,shop_id,tone,text,ref_id) VALUES (?,?,?,?,?)",
        [
          crypto.randomUUID(),
          booking.shop_id,
          "info",
          `Token #${booking.token} has a service edit awaiting ${status === "payment_review" ? "UPI payment verification" : "refund processing"}.`,
          bookingId,
        ],
      );
    }
    const [created] = await connection.query(
      "SELECT * FROM booking_service_edits WHERE id=?",
      [editId],
    );
    const editServices = new Map(
      [...currentServices, ...services].map((service) => [service.id, service]),
    );
    await connection.commit();
    res.status(201).json({
      edit: mapServiceEdit(created[0], editServices),
      totalAmount: newTotal,
      unchanged: false,
    });
  } catch (error) {
    console.error(error);
    console.log(error);
    await connection.rollback().catch(() => {});
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "That service edit was already submitted." });
    res
      .status(error.status || 500)
      .json({ message: error.message || "Could not submit the service edit." });
  } finally {
    connection.release();
  }
}

export async function listMyServiceEdits(req, res) {
  const [rows] = await pool.query(
    `SELECT e.*,b.queue_id,b.token,s.name AS shop_name,bar.name AS barber_name
     FROM booking_service_edits e JOIN payment_bookings b ON b.id=e.booking_id
     JOIN shops s ON s.id=e.shop_id JOIN barbers bar ON bar.id=e.barber_id
     WHERE e.customer_id=? ORDER BY e.created_at DESC LIMIT 100`,
    [req.user.sub],
  );
  const services = await serviceMapForEditRows(rows);
  res.json(rows.map((row) => mapServiceEdit(row, services)));
}

export async function listPendingServiceEdits(req, res) {
  const { sql, params } = scope(req);
  const [rows] = await pool.query(
    `SELECT e.*,b.queue_id,b.token,u.name AS customer_name,s.name AS shop_name,bar.name AS barber_name
     FROM booking_service_edits e JOIN payment_bookings b ON b.id=e.booking_id
     JOIN shops s ON s.id=e.shop_id JOIN users u ON u.id=e.customer_id
     JOIN barbers bar ON bar.id=e.barber_id
     WHERE e.status IN ('payment_review','refund_review') AND ${sql}
     ORDER BY e.created_at ASC LIMIT 200`,
    params,
  );
  const services = await serviceMapForEditRows(rows);
  res.json(rows.map((row) => mapServiceEdit(row, services)));
}

export async function resolveServiceEdit(req, res) {
  const action = String(req.body?.action || "");
  if (!["confirm_payment", "confirm_refund", "reject"].includes(action))
    return res
      .status(400)
      .json({ message: "Choose a valid service edit action." });
  const { sql, params } = scope(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT e.*,b.queue_id,b.token,b.status AS booking_status,b.queue_status,b.amount,
              b.service_ids_json,b.shop_id AS current_shop_id,b.barber_id AS current_barber_id,
              DATE_FORMAT(COALESCE(b.booking_date,DATE(b.accepted_at),DATE(b.created_at)),'%Y-%m-%d') AS edit_booking_date,
              s.name AS shop_name,s.upi_qr_url,s.availability_json,u.name AS customer_name,bar.name AS barber_name
       FROM booking_service_edits e JOIN payment_bookings b ON b.id=e.booking_id
       JOIN shops s ON s.id=e.shop_id JOIN users u ON u.id=e.customer_id JOIN barbers bar ON bar.id=e.barber_id
       WHERE e.id=? AND ${sql} LIMIT 1 FOR UPDATE`,
      [req.params.editId, ...params],
    );
    if (!rows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "Service edit not found for this shop." });
    }
    const edit = rows[0];
    if (edit.status === "applied" || edit.status === "rejected") {
      await connection.commit();
      return res.json({ edit: mapServiceEdit(edit), unchanged: true });
    }
    if (
      (action === "confirm_payment" && edit.status !== "payment_review") ||
      (action === "confirm_refund" && edit.status !== "refund_review")
    ) {
      await connection.rollback();
      return res.status(409).json({
        message: "That action does not match the pending payment or refund.",
      });
    }
    if (action === "reject") {
      await connection.query(
        `UPDATE booking_service_edits SET status='rejected',
         payment_status=IF(payment_status='submitted','declined',payment_status),
         refund_status=IF(refund_status='requested','not_required',refund_status),
         resolution_note=?,resolved_by=?,resolved_by_role=?,resolved_at=NOW() WHERE id=?`,
        [
          String(req.body?.note || "Request was not approved by the shop.")
            .trim()
            .slice(0, 255),
          req.user.sub,
          req.user.role,
          edit.id,
        ],
      );
      await connection.query(
        "INSERT INTO notifications(id,user_id,shop_id,tone,text,ref_id) VALUES (?,?,?,?,?,?)",
        [
          crypto.randomUUID(),
          edit.customer_id,
          edit.shop_id,
          "alert",
          `The shop did not approve the requested service change for token #${edit.token}. If you sent extra UPI payment, contact the shop to arrange its return.`,
          edit.booking_id,
        ],
      );
      const [rejectedRows] = await connection.query(
        "SELECT * FROM booking_service_edits WHERE id=?",
        [edit.id],
      );
      await connection.commit();
      return res.json({
        edit: mapServiceEdit({ ...edit, ...rejectedRows[0] }),
      });
    }
    if (
      edit.booking_status !== "accepted" ||
      !SERVICE_EDIT_QUEUE_STATUSES.includes(edit.queue_status)
    ) {
      await connection.rollback();
      return res.status(409).json({
        message:
          "This booking is no longer waiting, so its services cannot be changed.",
      });
    }
    edit.shop_id = edit.current_shop_id;
    edit.barber_id = edit.current_barber_id;
    edit.booking_date = edit.edit_booking_date;
    const requestedIds = jsonArray(edit.requested_service_ids_json);
    const services = await validateEditedServices(
      connection,
      edit,
      requestedIds,
    );
    const oldIds = jsonArray(edit.service_ids_json);
    if (
      JSON.stringify([...oldIds].sort()) !==
      JSON.stringify(jsonArray(edit.old_service_ids_json).sort())
    ) {
      await connection.rollback();
      return res.status(409).json({
        message:
          "The booking services changed after this request. Refresh and submit a new edit.",
      });
    }
    const [current] = await connection.query(
      `SELECT id,price FROM services WHERE shop_id=? AND id IN (${oldIds.map(() => "?").join(",")})`,
      [edit.shop_id, ...oldIds],
    );
    if (current.length !== oldIds.length) {
      await connection.rollback();
      return res.status(409).json({
        message: "The existing service prices could not be verified.",
      });
    }
    const delta = money(
      services.reduce((sum, service) => sum + Number(service.price), 0) -
        current.reduce((sum, service) => sum + Number(service.price), 0),
    );
    if (money(delta) !== money(edit.amount_delta)) {
      await connection.rollback();
      return res.status(409).json({
        message:
          "Service prices changed after submission. Ask the customer to review the updated total.",
      });
    }
    const duration = services.reduce(
      (sum, service) => sum + Number(service.duration_minutes),
      0,
    );
    await connection.query(
      "UPDATE payment_bookings SET service_ids_json=?,duration_minutes=? WHERE id=? AND status='accepted' AND queue_status IN ('Waiting','Your Turn')",
      [JSON.stringify(requestedIds), duration, edit.booking_id],
    );
    const paymentUpdate =
      action === "confirm_payment"
        ? "payment_status='verified'"
        : "refund_status='shop_confirmed'";
    const resolutionNote =
      action === "confirm_payment"
        ? "Additional UPI payment manually verified by the shop."
        : "The shop confirmed it manually processed the refund outside this system.";
    await connection.query(
      `UPDATE booking_service_edits SET status='applied',${paymentUpdate},resolution_note=?,resolved_by=?,resolved_by_role=?,resolved_at=NOW() WHERE id=?`,
      [resolutionNote, req.user.sub, req.user.role, edit.id],
    );
    await connection.query(
      "INSERT INTO notifications(id,user_id,shop_id,tone,text,ref_id) VALUES (?,?,?,?,?,?)",
      [
        crypto.randomUUID(),
        edit.customer_id,
        edit.shop_id,
        "ok",
        action === "confirm_payment"
          ? `The shop verified your additional payment and updated services for token #${edit.token}.`
          : `The shop confirmed the refund and updated services for token #${edit.token}.`,
        edit.booking_id,
      ],
    );
    const [resolvedRows] = await connection.query(
      "SELECT * FROM booking_service_edits WHERE id=?",
      [edit.id],
    );
    await connection.commit();
    await recalculateScheduledBookings({
      shopId: edit.shop_id,
      barberId: edit.barber_id,
    });
    const resolvedServices = new Map(
      services.map((service) => [service.id, service]),
    );
    res.json({
      edit: mapServiceEdit({ ...edit, ...resolvedRows[0] }, resolvedServices),
      changed: true,
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    res.status(error.status || 500).json({
      message: error.message || "Could not resolve the service edit.",
    });
  } finally {
    connection.release();
  }
}

// Owners see bookings of shops they own. A shop or co-owner login only sees their own shop.
const scope = (req) =>
  req.user.role === "shop" || req.user.role === "co_owner"
    ? { sql: "s.id=?", params: [req.user.shopId || req.user.sub] }
    : { sql: "s.owner_id=?", params: [req.user.sub] };

const localDateKey = (date = new Date()) =>
  scheduledQueueDate(date);

export async function listMine(req, res) {
  const rows = await findBookings(
    "b.customer_id=? AND b.status IN ('payment_submitted','accepted','rejected')",
    [req.user.sub],
    "ORDER BY b.created_at DESC LIMIT 30",
  );
  res.json(await hydrateBookings(rows));
}

export async function listRefunds(req, res) {
  const rows = await findBookings(
    "b.customer_id=? AND b.refund_status IS NOT NULL",
    [req.user.sub],
    "ORDER BY b.created_at DESC LIMIT 100",
  );
  res.json(await hydrateBookings(rows));
}

export async function listClosureResolutions(req, res) {
  const { sql, params } = scope(req);
  const rows = await findBookings(
    `b.status='accepted' AND ${sql} AND (
      (b.queue_status='Emergency Closed' AND b.closure_choice='wait')
      OR b.refund_status='requested'
    )`,
    params,
    "ORDER BY b.created_at ASC LIMIT 500",
  );
  res.json(await hydrateBookings(rows));
}

export async function getMine(req, res) {
  const rows = await findBookings(
    "b.id=? AND b.customer_id=?",
    [req.params.id, req.user.sub],
    "LIMIT 1",
  );
  if (!rows.length)
    return res.status(404).json({ message: "Booking not found." });
  res.json((await hydrateBookings(rows))[0]);
}

export async function listPending(req, res) {
  const { sql, params } = scope(req);
  const rows = await findBookings(
    `b.status='payment_submitted' AND ${sql}`,
    params,
    "ORDER BY b.payment_submitted_at ASC, b.created_at ASC",
  );
  res.json(await hydrateBookings(rows));
}

export async function listPrebookings(req, res) {
  const { sql, params } = scope(req);
  const date = String(req.query.date || "").trim();
  const pageSize = Math.min(30, Math.max(10, Number(req.query.pageSize) || 10));
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * pageSize;
  const dateFilter = date ? " AND b.booking_date=?" : "";
  const dateParams = date ? [date] : [];
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM payment_bookings b
     JOIN shops s ON s.id=b.shop_id
     WHERE b.status='accepted' AND b.queue_status='Prebooked'
       ${dateFilter} AND ${sql}`,
    [...dateParams, ...params],
  );
  const rows = await findBookings(
    `b.status='accepted' AND b.queue_status='Prebooked'${dateFilter} AND ${sql}`,
    [...dateParams, ...params],
    `ORDER BY b.booking_date ASC, b.accepted_at ASC LIMIT ${pageSize} OFFSET ${offset}`,
  );
  res.json({
    items: await hydrateBookings(rows),
    total: Number(countRows[0]?.total || 0),
    page,
    pageSize,
  });
}

async function loadOwned(req) {
  const { sql, params } = scope(req);
  const rows = await findBookings(
    `b.id=? AND ${sql}`,
    [req.params.id, ...params],
    "LIMIT 1",
  );
  return rows[0] ? (await hydrateBookings(rows))[0] : null;
}

// Owner ACCEPT. Only the owner's action creates the queue entry.
export async function acceptBooking(req, res) {
  const booking = await loadOwned(req);
  if (!booking)
    return res
      .status(404)
      .json({ message: "Booking not found for this shop." });

  if (booking.status === "accepted")
    return res.json({ booking, alreadyAccepted: true });

  if (booking.status !== "payment_submitted") {
    return res.status(409).json({
      message: `This booking is ${booking.status} and cannot be accepted.`,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [barberRows] = await connection.query(
      "SELECT id,queue_limit FROM barbers WHERE id=? AND shop_id=? FOR UPDATE",
      [booking.barberId, booking.shopId],
    );
    const limit = Number(barberRows[0]?.queue_limit || 0);
    if (!limit)
      throw Object.assign(
        new Error("This barber has no valid queue capacity configured."),
        { status: 409 },
      );
    const [activeRows] = await connection.query(
      `SELECT COUNT(*) AS total FROM payment_bookings
       WHERE shop_id=? AND barber_id=? AND status='accepted'
         AND queue_status IN ('Waiting','Your Turn','In Service','Scheduled')`,
      [booking.shopId, booking.barberId],
    );
    if (Number(activeRows[0].total) >= limit) {
      const [waitRows] = await connection.query(
        `SELECT COALESCE(SUM(duration_minutes),0) AS minutes FROM payment_bookings
         WHERE shop_id=? AND barber_id=? AND status='accepted'
           AND queue_status IN ('Waiting','Your Turn','In Service')`,
        [booking.shopId, booking.barberId],
      );
      throw Object.assign(
        new Error(
          `Cannot take in queue till for next ${Number(waitRows[0].minutes || 0)} minutes, as queue is full.`,
        ),
        { status: 409 },
      );
    }
    if (booking.bookingDate === localDateKey() && !booking.scheduledTime) {
      const [scheduled] = await connection.query(
        `SELECT scheduled_time,duration_minutes FROM payment_bookings
         WHERE shop_id=? AND barber_id=? AND booking_date=? AND scheduled_time IS NOT NULL
           AND (
             status IN ('payment_submitted','accepted')
             AND COALESCE(queue_status, '') NOT IN
               ('Cancelled','Completed','No Show')
           )
           AND scheduled_time > TIME(NOW())
         ORDER BY scheduled_time ASC`,
        [booking.shopId, booking.barberId, booking.bookingDate],
      );
      if (scheduled.length) {
        const [ahead] = await connection.query(
          `SELECT COALESCE(SUM(duration_minutes),0) AS minutes FROM payment_bookings
           WHERE shop_id=? AND barber_id=? AND status='accepted'
             AND queue_status IN ('Waiting','Your Turn','In Service')`,
          [booking.shopId, booking.barberId],
        );
        const now = new Date();
        const walkInWorkload =
          Number(ahead[0].minutes || 0) + Number(booking.durationMinutes || 0);
        const blockingAppointment = scheduled.find((appointment) => {
          const appointmentAt = new Date(
            `${booking.bookingDate}T${String(appointment.scheduled_time).slice(0, 8)}+05:30`,
          );
          const available = Math.floor(
            (appointmentAt.getTime() - now.getTime()) / 60000,
          );
          return (
            walkInWorkload + Number(appointment.duration_minutes || 0) >
            available
          );
        });
        if (blockingAppointment)
          throw Object.assign(
            new Error(
              `Cannot take in queue because it would overlap the scheduled appointment at ${String(blockingAppointment.scheduled_time).slice(0, 5)}.`,
            ),
            { status: 409 },
          );
      }
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    connection.release();
    return res
      .status(error.status || 500)
      .json({ message: error.message || "Could not validate queue capacity." });
  }
  const nextFree = async () => {
    const [[row]] = await connection.query(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(token,2) AS UNSIGNED)),0) AS n FROM payment_bookings WHERE shop_id=? AND token REGEXP '^A[0-9]+$'",
      [booking.shopId],
    );
    return `A${String(Number(row.n) + 1).padStart(3, "0")}`;
  };

  let token = String(req.body?.token || "")
    .trim()
    .toUpperCase();
  if (!/^A\d{3,6}$/.test(token)) token = await nextFree();

  let tokenToUse = token;
  let accepted = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const [result] = await connection.query(
        `UPDATE payment_bookings
         SET status='accepted',
             queue_status=IF(booking_date<>?, 'Prebooked', IF(scheduled_time IS NULL, 'Waiting', 'Scheduled')),
             token=?, queue_id=?, payment_reference=?, accepted_at=NOW()
         WHERE id=? AND status='payment_submitted'`,
        [
          localDateKey(),
          tokenToUse,
          `q-${booking.id}`,
          `PAY-${booking.id}`,
          booking.id,
        ],
      );

      if (!result.affectedRows) {
        await connection.rollback();
        connection.release();
        const [again] = await hydrateBookings(
          await findBookings("b.id=?", [booking.id], "LIMIT 1"),
        );
        if (again?.status === "accepted")
          return res.json({ booking: again, alreadyAccepted: true });
        return res
          .status(409)
          .json({ message: "This booking was already handled." });
      }

      accepted = true;
      token = tokenToUse;
      break;
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY" && attempt < 2) {
        tokenToUse = await nextFree();
        continue;
      }
      await connection.rollback();
      connection.release();
      throw error;
    }
  }

  if (!accepted) {
    await connection.rollback();
    connection.release();
    return res
      .status(409)
      .json({ message: "Could not allocate a queue token. Please try again." });
  }
  await connection.commit();
  connection.release();

  await addNotification({
    userId: booking.customerId,
    tone: "ok",
    refId: booking.id,
    text: booking.isPrebooking
      ? `${booking.shopName} accepted your payment for ${booking.bookingDate}.`
      : `${booking.shopName} accepted your payment. You are in the queue, token #${token}.`,
  });

  requestScheduledQueueRecalculation({
    shopId: booking.shopId,
    barberId: booking.barberId,
  });

  const [fresh] = await hydrateBookings(
    await findBookings("b.id=?", [booking.id], "LIMIT 1"),
  );
  res.json({ booking: fresh });
}

export async function takePrebooking(req, res) {
  const booking = await loadOwned(req);
  if (
    !booking ||
    booking.status !== "accepted" ||
    booking.queueStatus !== "Prebooked"
  )
    return res.status(404).json({ message: "Prebooking not found." });
  if (booking.bookingDate !== localDateKey())
    return res
      .status(409)
      .json({ message: "Only today's prebookings can be added to the queue." });
  await pool.query(
    "UPDATE payment_bookings SET queue_status='Waiting', skipped_at=NOW() WHERE id=? AND status='accepted' AND queue_status='Prebooked'",
    [booking.id],
  );
  requestScheduledQueueRecalculation({
    shopId: booking.shopId,
    barberId: booking.barberId,
  });
  const [fresh] = await hydrateBookings(
    await findBookings("b.id=?", [booking.id], "LIMIT 1"),
  );
  await addNotification({
    userId: booking.customerId,
    tone: "ok",
    refId: booking.id,
    text: `${booking.shopName} added your prebooking for today to the queue.`,
  });
  res.json({ booking: fresh });
}

// Owner DECLINE. No payment gateway/refund is involved. A 30-minute rebooking block is enforced server-side.
export async function declineBooking(req, res) {
  const booking = await loadOwned(req);
  if (!booking)
    return res
      .status(404)
      .json({ message: "Booking not found for this shop." });
  if (booking.status === "rejected")
    return res.json({ booking, alreadyDeclined: true });
  if (booking.status !== "payment_submitted") {
    return res.status(409).json({
      message: `This booking is ${booking.status} and cannot be declined.`,
    });
  }

  const reason =
    String(req.body?.reason || "")
      .trim()
      .slice(0, 200) || "Payment not received";
  const [result] = await pool.query(
    `UPDATE payment_bookings
     SET status='rejected', decline_reason=?, declined_until=DATE_ADD(NOW(), INTERVAL 30 MINUTE)
     WHERE id=? AND status='payment_submitted'`,
    [reason, booking.id],
  );

  if (!result.affectedRows) {
    const [again] = await hydrateBookings(
      await findBookings("b.id=?", [booking.id], "LIMIT 1"),
    );
    if (again?.status === "rejected")
      return res.json({ booking: again, alreadyDeclined: true });
    return res
      .status(409)
      .json({ message: "This booking was already handled." });
  }

  await addNotification({
    userId: booking.customerId,
    tone: "alert",
    refId: booking.id,
    text: `${booking.shopName}: Payment was not received. Please try again. You can book again after 30 minutes.`,
  });

  const [fresh] = await hydrateBookings(
    await findBookings("b.id=?", [booking.id], "LIMIT 1"),
  );
  res.json({ booking: fresh });
}

// Owner payment settings: the owner uploads their original UPI QR image.
// The backend stores only the exact image URL supplied by the authenticated owner.
export async function getUpiSettings(req, res) {
  const { sql, params } = scope(req);
  const [rows] = await pool.query(
    `SELECT s.id,s.upi_qr_url FROM shops s WHERE s.id=? AND ${sql} LIMIT 1`,
    [String(req.query.shopId || ""), ...params],
  );
  if (!rows.length) return res.status(404).json({ message: "Shop not found." });
  res.json({ shopId: rows[0].id, qrUrl: rows[0].upi_qr_url || "" });
}

export async function saveUpiSettings(req, res) {
  const qrUrl = String(req.body?.qrUrl || "").trim();
  const { sql, params } = scope(req);
  const [result] = await pool.query(
    `UPDATE shops s SET s.upi_qr_url=? WHERE s.id=? AND ${sql}`,
    [qrUrl || null, String(req.body?.shopId || ""), ...params],
  );
  if (!result.affectedRows)
    return res.status(404).json({ message: "Shop not found." });
  res.json({ ok: true, qrUrl });
}

export async function deleteBookingHistory(req, res) {
  const { sql, params } = scope(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT b.id,b.queue_id,b.queue_status FROM payment_bookings b JOIN shops s ON s.id=b.shop_id WHERE b.id=? AND ${sql} LIMIT 1`,
      [req.params.id, ...params],
    );
    if (!rows.length)
      throw Object.assign(
        new Error("Payment record not found for this shop."),
        { status: 404 },
      );
    if (!["Completed", "Cancelled"].includes(rows[0].queue_status)) {
      throw Object.assign(
        new Error(
          "Only completed or cancelled payment records can be deleted.",
        ),
        { status: 409 },
      );
    }
    if (rows[0].queue_id)
      await connection.query("DELETE FROM booking_reviews WHERE queue_id=?", [
        rows[0].queue_id,
      ]);
    await connection.query("DELETE FROM payment_bookings WHERE id=?", [
      rows[0].id,
    ]);
    await connection.commit();
    res.json({ ok: true, id: rows[0].id });
  } catch (error) {
    await connection.rollback().catch(() => {});
    res.status(error.status || 500).json({
      message: error.message || "Could not delete the payment record.",
    });
  } finally {
    connection.release();
  }
}

// ---- Server-side queue -------------------------------------------------------------------
const QUEUE_STATUSES = [
  "Waiting",
  "Your Turn",
  "In Service",
  "Completed",
  "Skipped",
  "No Show",
  "Cancelled",
];

// Every accepted booking is a queue entry. Owners/shops get their shops' entries, customers their own.
export async function listQueue(req, res) {
  const isCustomer = req.user.role === "customer";
  let rows = [];
  await recalculateScheduledBookings({
    shopId:
      isCustomer || req.user.role === "owner"
        ? null
        : req.user.shopId || req.user.sub,
  });

  if (isCustomer) {
    const ownRows = await findBookings(
      "b.status='accepted' AND b.customer_id=? AND b.queue_status <> 'Prebooked'",
      [req.user.sub],
      "ORDER BY COALESCE(b.skipped_at, b.accepted_at) ASC LIMIT 100",
    );

    if (!ownRows.length) return res.json([]);

    const queueScopes = [
      ...new Map(
        ownRows.map((row) => [
          `${row.shop_id}:${row.barber_id}`,
          { shopId: row.shop_id, barberId: row.barber_id },
        ]),
      ).values(),
    ];
    const scopeSql = queueScopes
      .map(() => "(b.shop_id=? AND b.barber_id=?)")
      .join(" OR ");
    const scopeParams = queueScopes.flatMap((scope) => [
      scope.shopId,
      scope.barberId,
    ]);
    const ownIds = ownRows.map((row) => row.id);
    const ownSql = ownIds.map(() => "?").join(",");

    rows = await findBookings(
      `b.status='accepted' AND b.queue_status <> 'Prebooked' AND (
        b.id IN (${ownSql})
        OR (
          b.queue_status IN ('Waiting','Your Turn','In Service','Scheduled')
          AND (${scopeSql})
        )
      )`,
      [...ownIds, ...scopeParams],
      "ORDER BY COALESCE(b.skipped_at, b.accepted_at) ASC, b.accepted_at ASC, b.id ASC LIMIT 500",
    );

    await Promise.all(
      rows.map(async (row) => {
        const [positionRows] = await pool.query(
          `SELECT COUNT(*) + 1 AS queue_position
           FROM payment_bookings x
           WHERE x.shop_id=? AND x.barber_id=? AND x.status='accepted'
             AND x.queue_status IN ('Waiting', 'Your Turn', 'Scheduled')
             AND (
               COALESCE(x.skipped_at, x.accepted_at) < COALESCE(?, ?)
               OR (
                 COALESCE(x.skipped_at, x.accepted_at) = COALESCE(?, ?)
                 AND x.id <= ?
               )
             )`,
          [
            row.shop_id,
            row.barber_id,
            row.skipped_at,
            row.accepted_at,
            row.skipped_at,
            row.accepted_at,
            row.id,
          ],
        );
        row.queue_position = positionRows[0]?.queue_position;
      }),
    );
  } else {
    const { sql, params } = scope(req);
    rows = await findBookings(
      `b.status='accepted' AND b.queue_status <> 'Prebooked' AND ${sql}`,
      params,
      "ORDER BY COALESCE(b.skipped_at, b.accepted_at) ASC, b.accepted_at ASC, b.id ASC LIMIT 500",
    );
  }

  res.json(await hydrateBookings(rows));
}

export async function setQueueStatus(req, res) {
  const action = String(req.body?.action || "");
  if (
    action &&
    ![
      "swap",
      "requeue",
      "remove",
      "closure_wait",
      "closure_refund",
      "rejoin",
      "refund_complete",
    ].includes(action)
  )
    return res.status(400).json({ message: "Invalid queue action." });

  const status = String(req.body?.status || "");

  if (!action && !QUEUE_STATUSES.includes(status))
    return res.status(400).json({ message: "Invalid queue status." });

  const isCustomer = req.user.role === "customer";

  const booking = isCustomer
    ? (
        await hydrateBookings(
          await findBookings(
            "b.id=? AND b.customer_id=?",
            [req.params.id, req.user.sub],
            "LIMIT 1",
          ),
        )
      )[0]
    : await loadOwned(req);
  if (!booking || booking.status !== "accepted")
    return res.status(404).json({ message: "Queue entry not found." });

  const current = booking.queueStatus || "Waiting";
  if (action || status !== current) {
    let pendingEdits;
    try {
      [pendingEdits] = await pool.query(
        "SELECT id FROM booking_service_edits WHERE booking_id=? AND status IN ('payment_review','refund_review') LIMIT 1",
        [booking.id],
      );
    } catch (error) {
      if (error.code !== "ER_NO_SUCH_TABLE") throw error;
      pendingEdits = [];
    }
    const callerStillWaiting =
      !action &&
      status === "Your Turn" &&
      ["Waiting", "Your Turn"].includes(current);
    if (pendingEdits.length && !callerStillWaiting)
      return res.status(409).json({
        message:
          "Resolve the pending service payment or refund before changing this queue entry.",
      });
  }

  if (action) {
    if (["closure_wait", "closure_refund"].includes(action)) {
      if (current !== "Emergency Closed")
        return res.status(409).json({
          message:
            "This booking is not waiting for an emergency closure decision.",
        });
      const choice = action === "closure_wait" ? "wait" : "refund";
      await pool.query(
        `UPDATE payment_bookings
         SET closure_choice=?, queue_status=?, refund_status=?
         WHERE id=? AND status='accepted' AND queue_status='Emergency Closed'`,
        [
          choice,
          action === "closure_wait" ? "Emergency Closed" : "Cancelled",
          action === "closure_refund" ? "requested" : booking.refundStatus,
          booking.id,
        ],
      );
      const [fresh] = await hydrateBookings(
        await findBookings("b.id=?", [booking.id], "LIMIT 1"),
      );
      return res.json({ booking: fresh, action });
    }
    if (action === "rejoin" || action === "refund_complete") {
      if (isCustomer)
        return res.status(403).json({ message: "Owner action required." });
      if (
        action === "rejoin" &&
        (current !== "Emergency Closed" || booking.closureChoice !== "wait")
      )
        return res.status(409).json({
          message: "This customer is not waiting for the shop to reopen.",
        });
      if (action === "refund_complete" && booking.refundStatus !== "requested")
        return res.status(409).json({
          message: "This booking does not have a pending refund request.",
        });

      if (action === "rejoin") {
        await pool.query(
          `UPDATE payment_bookings
           SET queue_status='Waiting', closure_choice='wait',
               refund_status=NULL, skipped_at=NOW()
           WHERE id=? AND status='accepted' AND queue_status='Emergency Closed'`,
          [booking.id],
        );
        await addNotification({
          shopId: booking.shopId,
          userId: booking.customerId,
          tone: "success",
          text: "The shop has rejoined you to the queue after reopening.",
          refId: booking.id,
        });
      } else {
        await pool.query(
          `UPDATE payment_bookings
           SET queue_status='Cancelled', refund_status='completed',
               refund_id=?
           WHERE id=? AND status='accepted' AND refund_status='requested'`,
          [`REF-${crypto.randomUUID()}`, booking.id],
        );
        await addNotification({
          shopId: booking.shopId,
          userId: booking.customerId,
          tone: "success",
          text: "Your emergency-closure refund has been completed.",
          refId: booking.id,
        });
      }
      const [fresh] = await hydrateBookings(
        await findBookings("b.id=?", [booking.id], "LIMIT 1"),
      );
      return res.json({ booking: fresh, action });
    }
    if (action === "requeue" && current !== "Your Turn")
      return res.status(409).json({
        message: "These actions are available only when it is your turn.",
      });
    if (
      action === "remove" &&
      !["Waiting", "Your Turn", "Scheduled"].includes(current)
    )
      return res.status(409).json({
        message: "Only an active or scheduled queue ticket can be removed.",
      });

    if (req.user.role === "customer" && booking.customerId !== req.user.sub)
      return res
        .status(403)
        .json({ message: "You can only manage your own turn." });

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      if (action === "swap") {
        const requestedPosition = Number(req.body?.targetPosition);
        const [waitingRows] = await connection.query(
          `SELECT id
           FROM payment_bookings
           WHERE barber_id=? AND shop_id=? AND status='accepted'
             AND queue_status IN ('Waiting', 'Your Turn')
           ORDER BY COALESCE(skipped_at, accepted_at), accepted_at, id
           FOR UPDATE`,
          [booking.barberId, booking.shopId],
        );
        const currentIndex = waitingRows.findIndex(
          (row) => row.id === booking.id,
        );
        const targetIndex = Number.isInteger(requestedPosition)
          ? requestedPosition - 1
          : -1;

        if (
          currentIndex !== 0 ||
          targetIndex < 0 ||
          targetIndex >= waitingRows.length
        ) {
          await connection.rollback();
          return res
            .status(409)
            .json({ message: "Choose a valid position in the active queue." });
        }

        if (targetIndex === currentIndex) {
          await connection.rollback();
          return res
            .status(409)
            .json({ message: "Choose a different queue position." });
        }

        const orderedIds = waitingRows.map((row) => row.id);
        orderedIds.splice(currentIndex, 1);
        orderedIds.splice(targetIndex, 0, booking.id);
        for (let index = 0; index < orderedIds.length; index += 1) {
          const id = orderedIds[index];
          await connection.query(
            `UPDATE payment_bookings
             SET queue_status=?, skipped_at=DATE_ADD(NOW(), INTERVAL ? SECOND)
             WHERE id=?`,
            [index === 0 ? "Your Turn" : "Waiting", index, id],
          );
        }

        await connection.query(
          "UPDATE payment_bookings SET skip_count=skip_count+1 WHERE id=?",
          [booking.id],
        );
      } else if (action === "requeue") {
        await connection.query(
          "UPDATE payment_bookings SET queue_status='Waiting', skipped_at=NOW(), skip_count=skip_count+1 WHERE id=?",
          [booking.id],
        );
      } else {
        await connection.query(
          "UPDATE payment_bookings SET queue_status='Cancelled' WHERE id=?",
          [booking.id],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    requestScheduledQueueRecalculation({
      shopId: booking.shopId,
      barberId: booking.barberId,
    });
    const [fresh] = await hydrateBookings(
      await findBookings("b.id=?", [booking.id], "LIMIT 1"),
    );
    return res.json({ booking: fresh, action });
  }

  // Emergency closure is a terminal decision point until the customer chooses
  // to wait or request a refund. Do not allow a stale owner action (for
  // example, an in-flight "Complete" click) to overwrite it.
  if (current === "Emergency Closed") {
    return res.status(409).json({
      message:
        "This booking is paused because the shop closed due to an emergency.",
    });
  }

  if (["Completed", "Cancelled", "No Show"].includes(current))
    return res.json({ booking, unchanged: true });

  if (isCustomer && (status !== "Cancelled" || current === "In Service"))
    return res
      .status(403)
      .json({ message: "You can only cancel a ticket that has not started." });

  if (status === "Skipped") {
    await pool.query(
      "UPDATE payment_bookings SET queue_status='Waiting', skipped_at=NOW(), skip_count=skip_count+1 WHERE id=?",
      [booking.id],
    );
  } else if (status === "Completed") {
    await pool.query(
      "UPDATE payment_bookings SET queue_status='Completed', completed_at=NOW() WHERE id=?",
      [booking.id],
    );
  } else {
    await pool.query("UPDATE payment_bookings SET queue_status=? WHERE id=?", [
      status,
      booking.id,
    ]);
  }
  requestScheduledQueueRecalculation({
    shopId: booking.shopId,
    barberId: booking.barberId,
  });
  const text = {
    "Your Turn": `It is your turn at ${booking.shopName}. Token #${booking.token}.`,
    "In Service": `Your service has started at ${booking.shopName}.`,
    Completed: `Your visit at ${booking.shopName} is complete. You can now leave a review.`,
    Skipped: `Your token #${booking.token} was moved to the end of the queue.`,
    "No Show": `Your token #${booking.token} was marked as a no-show.`,
    Cancelled: `Token #${booking.token} at ${booking.shopName} was cancelled.`,
  }[status];
  if (text && !isCustomer)
    await addNotification({
      userId: booking.customerId,
      tone:
        status === "Completed"
          ? "ok"
          : ["No Show", "Cancelled"].includes(status)
            ? "alert"
            : "info",
      refId: booking.id,
      text,
    });
  const [fresh] = await hydrateBookings(
    await findBookings("b.id=?", [booking.id], "LIMIT 1"),
  );
  res.json({ booking: fresh });
}
