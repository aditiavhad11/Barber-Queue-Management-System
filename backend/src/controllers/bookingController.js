import { pool } from "../config/db.js";
import {
  addNotification,
  findBookings,
  hydrateBookings,
  rupees,
} from "../models/bookingModel.js";

// Owners see bookings of shops they own. A shop or co-owner login only sees their own shop.
const scope = (req) =>
  req.user.role === "shop" || req.user.role === "co_owner"
    ? { sql: "s.id=?", params: [req.user.shopId || req.user.sub] }
    : { sql: "s.owner_id=?", params: [req.user.sub] };

export async function listMine(req, res) {
  const rows = await findBookings(
    "b.customer_id=? AND b.status IN ('payment_submitted','accepted','rejected')",
    [req.user.sub],
    "ORDER BY b.created_at DESC LIMIT 30",
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

  const nextFree = async () => {
    const [[row]] = await pool.query(
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
      const [result] = await pool.query(
        `UPDATE payment_bookings
         SET status='accepted', queue_status='Waiting', token=?, queue_id=?, payment_reference=?, accepted_at=NOW()
         WHERE id=? AND status='payment_submitted'`,
        [tokenToUse, `q-${booking.id}`, `PAY-${booking.id}`, booking.id],
      );

      if (!result.affectedRows) {
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
      throw error;
    }
  }

  if (!accepted)
    return res
      .status(409)
      .json({ message: "Could not allocate a queue token. Please try again." });

  await addNotification({
    userId: booking.customerId,
    tone: "ok",
    refId: booking.id,
    text: `${booking.shopName} accepted your payment. You are in the queue, token #${token}.`,
  });

  const [fresh] = await hydrateBookings(
    await findBookings("b.id=?", [booking.id], "LIMIT 1"),
  );
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
  const { sql, params } = isCustomer
    ? { sql: "b.customer_id=?", params: [req.user.sub] }
    : scope(req);
  const rows = await findBookings(
    `b.status='accepted' AND ${sql}`,
    params,
    "ORDER BY COALESCE(b.skipped_at, b.accepted_at) ASC LIMIT 500",
  );
  res.json(await hydrateBookings(rows));
}

export async function setQueueStatus(req, res) {
  const status = String(req.body?.status || "");
  if (!QUEUE_STATUSES.includes(status))
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
