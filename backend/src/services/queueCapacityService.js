import { AppError } from "../utils/AppError.js";
import { localDateKey } from "../utils/time.js";

export const QUEUE_ERRORS = Object.freeze({
  FULL: {
    code: "QUEUE_FULL",
    message: "This barber's queue is full. Please choose another time or barber.",
  },
  CAPACITY_NOT_CONFIGURED: {
    code: "QUEUE_CAPACITY_NOT_CONFIGURED",
    message: "This barber has no valid queue capacity configured.",
  },
  APPOINTMENT_OVERLAP: {
    code: "APPOINTMENT_OVERLAP",
    message: "This booking would overlap a scheduled appointment.",
  },
});

export function hasQueueCapacity({ queueLimit, committedCount, reservedCount = 0 }) {
  const limit = Number(queueLimit);
  return (
    Number.isInteger(limit) &&
    limit > 0 &&
    Number(committedCount || 0) + Number(reservedCount || 0) < limit
  );
}

export async function validateQueueCapacity(
  connection,
  {
    shopId,
    barberId,
    bookingDate = localDateKey(),
    excludeBookingId = null,
    lock = true,
  },
) {
  const [barbers] = await connection.query(
    `SELECT id,queue_limit FROM barbers
     WHERE id=? AND shop_id=?${lock ? " FOR UPDATE" : ""}`,
    [barberId, shopId],
  );
  const barber = barbers[0];
  if (!barber)
    throw AppError.notFound("Selected barber was not found in this shop.", "BARBER_NOT_FOUND");

  const limit = Number(barber.queue_limit || 0);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw AppError.conflict(
      QUEUE_ERRORS.CAPACITY_NOT_CONFIGURED.message,
      QUEUE_ERRORS.CAPACITY_NOT_CONFIGURED.code,
    );
  }
  if (String(bookingDate) !== localDateKey())
    return { applicable: false, capacity: limit, count: 0, barber };

  const excluded = excludeBookingId ? "AND id<>?" : "";
  const params = [shopId, barberId, bookingDate];
  if (excludeBookingId) params.push(excludeBookingId);
  const [rows] = await connection.query(
    `SELECT
       SUM(CASE WHEN status='accepted' AND queue_status IN
         ('Waiting','Your Turn','In Service','Scheduled') THEN 1 ELSE 0 END) AS committed_count,
       SUM(CASE WHEN status='payment_submitted' THEN 1 ELSE 0 END) AS reserved_count
     FROM payment_bookings
     WHERE shop_id=? AND barber_id=? AND booking_date=? ${excluded}`,
    params,
  );
  const committedCount = Number(rows[0]?.committed_count || 0);
  const reservedCount = Number(rows[0]?.reserved_count || 0);
  const count = committedCount + reservedCount;
  if (!hasQueueCapacity({ queueLimit: limit, committedCount, reservedCount })) {
    throw AppError.conflict(QUEUE_ERRORS.FULL.message, QUEUE_ERRORS.FULL.code, {
      capacity: limit,
      count,
    });
  }
  return {
    applicable: true,
    capacity: limit,
    count,
    committedCount,
    reservedCount,
    barber,
  };
}
