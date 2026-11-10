import { AppError } from "../utils/AppError.js";
import { localDateKey, minutesUntilAppointment } from "../utils/time.js";
import { QUEUE_ERRORS, validateQueueCapacity } from "./queueCapacityService.js";
import { recordBookingTransition } from "./bookingStateMachine.js";

/**
 * Core business logic for accepting a booking into the queue.
 *
 * Runs inside the caller's transaction (connection must already have
 * beginTransaction() called before this function is invoked).
 *
 * @param {import('mysql2/promise').Connection} connection  - Transactional DB connection
 * @param {object}  booking      - Hydrated booking object (from hydrateBookings)
 * @param {string}  [overrideToken]  - Optional manual token (e.g. req.body.token)
 * @returns {Promise<{ token: string }>}
 */
export async function acceptBookingCore(connection, booking, overrideToken = "", actor = {}) {
  // Lock the barber and count accepted entries plus recent payment reservations.
  await validateQueueCapacity(connection, {
    shopId: booking.shopId,
    barberId: booking.barberId,
    bookingDate: booking.bookingDate,
    excludeBookingId: booking.id,
  });

  // 3. Walk-in appointment overlap check (only for today's walk-ins)
  if (booking.bookingDate === localDateKey() && !booking.scheduledTime) {
    const [scheduled] = await connection.query(
      `SELECT scheduled_time,duration_minutes FROM payment_bookings
       WHERE shop_id=? AND barber_id=? AND booking_date=? AND scheduled_time IS NOT NULL
         AND (
           status IN ('payment_submitted','accepted')
           AND COALESCE(queue_status, '') NOT IN
             ('Cancelled','Completed','No Show')
         )
         AND scheduled_time > TIME(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))
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
        const available = minutesUntilAppointment(
          booking.bookingDate,
          appointment.scheduled_time,
          now,
        );
        return (
          walkInWorkload + Number(appointment.duration_minutes || 0) >
          available
        );
      });
      if (blockingAppointment)
        throw AppError.conflict(
          QUEUE_ERRORS.APPOINTMENT_OVERLAP.message,
          QUEUE_ERRORS.APPOINTMENT_OVERLAP.code,
        );
    }
  }

  // 4. Token generation helper
  const nextFree = async () => {
    const [[row]] = await connection.query(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(token,2) AS UNSIGNED)),0) AS n FROM payment_bookings WHERE shop_id=? AND token REGEXP '^A[0-9]+$'",
      [booking.shopId],
    );
    return `A${String(Number(row.n) + 1).padStart(3, "0")}`;
  };

  let token = String(overrideToken || "")
    .trim()
    .toUpperCase();
  if (!/^A\d{3,6}$/.test(token)) token = await nextFree();

  const nextQueueStatus =
    booking.bookingDate !== localDateKey()
      ? "Prebooked"
      : booking.scheduledTime
        ? "Scheduled"
        : "Waiting";
  await recordBookingTransition(connection, {
    bookingId: booking.id,
    toBookingStatus: "accepted",
    toQueueStatus: nextQueueStatus,
    actorId: actor.sub,
    actorRole: actor.role || "system",
    action: "booking_accepted",
    metadata: { shopId: booking.shopId, barberId: booking.barberId },
  });

  // 5. UPDATE with dup-entry retry (up to 3 attempts)
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
        // UPDATE matched nothing — booking was already handled concurrently
        return { token: tokenToUse, accepted: false, affectedRows: 0 };
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

  if (!accepted) {
    return { token: tokenToUse, accepted: false, affectedRows: -1 };
  }

  return { token, accepted: true };
}

export async function executeBookingAcceptance(
  connection,
  booking,
  overrideToken = "",
  accept = acceptBookingCore,
  actor = {},
) {
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const result = await accept(connection, booking, overrideToken, actor);
    await connection.commit();
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

