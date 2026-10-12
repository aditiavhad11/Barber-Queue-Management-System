import { pool } from "../config/db.js";
import crypto from "node:crypto";
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
  let rows = [];

  if (isCustomer) {
    const ownRows = await findBookings(
      "b.status='accepted' AND b.customer_id=?",
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
      `b.status='accepted' AND (
        b.id IN (${ownSql})
        OR (
          b.queue_status IN ('Waiting','Your Turn','In Service')
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
             AND x.queue_status IN ('Waiting', 'Your Turn')
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
      `b.status='accepted' AND ${sql}`,
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

  if (action) {
    if (["closure_wait", "closure_refund"].includes(action)) {
      if (current !== "Emergency Closed")
        return res.status(409).json({
          message: "This booking is not waiting for an emergency closure decision.",
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
    if (
      action === "requeue" &&
      current !== "Your Turn"
    )
      return res.status(409).json({
        message: "These actions are available only when it is your turn.",
      });
    if (
      action === "remove" &&
      !["Waiting", "Your Turn"].includes(current)
    )
      return res.status(409).json({
        message: "Only an active queue ticket can be removed.",
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
        const currentIndex = waitingRows.findIndex((row) => row.id === booking.id);
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
    const [fresh] = await hydrateBookings(
      await findBookings("b.id=?", [booking.id], "LIMIT 1"),
    );
    return res.json({ booking: fresh, action });
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
