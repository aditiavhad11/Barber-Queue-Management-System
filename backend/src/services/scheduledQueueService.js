import { pool } from "../config/db.js";
import { recordBookingTransition } from "./bookingStateMachine.js";
import {
  scheduledQueueDate,
  minutesUntilAppointment,
} from "../utils/time.js";
import { hasQueueCapacity } from "./queueCapacityService.js";

const ACTIVE_QUEUE_STATUSES = ["Waiting", "Your Turn", "In Service"];
const EXCLUDED_STATUSES = [
  "Cancelled",
  "Completed",
  "No Show",
  "Emergency Closed",
];

export { scheduledQueueDate, minutesUntilAppointment };

export function shouldInsertScheduledBooking({
  remainingQueueMinutes,
  durationMinutes,
  minutesUntil,
}) {
  return minutesUntil <= remainingQueueMinutes + durationMinutes;
}

export function scheduledInsertionPlan({
  activeBookings,
  scheduledBookings,
  queueLimit,
  bookingDate,
  now = new Date(),
}) {
  let remainingQueueMinutes = activeBookings.reduce(
    (sum, booking) => sum + Number(booking.duration_minutes || 0),
    0,
  );
  let activeCount = activeBookings.length;
  const plan = [];
  const ordered = [...scheduledBookings].sort((a, b) => {
    const timeDifference = String(a.scheduled_time).localeCompare(
      String(b.scheduled_time),
    );
    return timeDifference || String(a.id).localeCompare(String(b.id));
  });

  for (const booking of ordered) {
    const durationMinutes = Number(booking.duration_minutes || 0);
    if (
      !hasQueueCapacity({ queueLimit, committedCount: activeCount }) ||
      !shouldInsertScheduledBooking({
        remainingQueueMinutes,
        durationMinutes,
        minutesUntil: minutesUntilAppointment(
          bookingDate,
          booking.scheduled_time,
          now,
        ),
      })
    )
      continue;
    plan.push(booking.id);
    activeCount += 1;
    remainingQueueMinutes += durationMinutes;
  }
  return plan;
}

async function processBarber(connection, barberId, bookingDate, now) {
  const [barbers] = await connection.query(
    "SELECT id,shop_id,queue_limit FROM barbers WHERE id=? FOR UPDATE",
    [barberId],
  );
  if (!barbers.length) return 0;

  const barber = barbers[0];
  const [bookings] = await connection.query(
    `SELECT id,queue_status,scheduled_time,duration_minutes,accepted_at,skipped_at
     FROM payment_bookings
     WHERE shop_id=? AND barber_id=? AND status='accepted'
       AND booking_date=? AND queue_status NOT IN (${EXCLUDED_STATUSES.map(() => "?").join(",")})
     ORDER BY CASE WHEN queue_status='Scheduled' THEN 1 ELSE 0 END,
              COALESCE(skipped_at,accepted_at), accepted_at, id
     FOR UPDATE`,
    [barber.shop_id, barberId, bookingDate, ...EXCLUDED_STATUSES],
  );

  const activeBookings = bookings.filter((booking) =>
    ACTIVE_QUEUE_STATUSES.includes(booking.queue_status),
  );
  let inserted = 0;
  const scheduled = bookings.filter(
    (booking) => booking.queue_status === "Scheduled",
  );
  const plan = scheduledInsertionPlan({
    activeBookings,
    scheduledBookings: scheduled,
    queueLimit: barber.queue_limit,
    bookingDate,
    now,
  });
  for (const bookingId of plan) {
    const booking = scheduled.find((item) => item.id === bookingId);
    await recordBookingTransition(connection, {
      bookingId,
      toQueueStatus: "Waiting",
      actorRole: "system",
      action: "scheduled_booking_added_to_queue",
      current: { status: "accepted", queue_status: booking.queue_status },
    });
    const [result] = await connection.query(
      `UPDATE payment_bookings
       SET queue_status='Waiting', skipped_at=COALESCE(skipped_at,NOW())
       WHERE id=? AND status='accepted' AND queue_status='Scheduled'`,
      [bookingId],
    );
    if (result.affectedRows) {
      inserted += 1;
    }
  }

  return inserted;
}

export async function recalculateScheduledBookings({
  shopId = null,
  barberId = null,
  date = scheduledQueueDate(),
  now = new Date(),
} = {}) {
  const filters = [
    "b.status='accepted'",
    "b.queue_status='Scheduled'",
    "b.booking_date=?",
  ];
  const params = [date];
  if (shopId) {
    filters.push("b.shop_id=?");
    params.push(shopId);
  }
  if (barberId) {
    filters.push("b.barber_id=?");
    params.push(barberId);
  }

  const [rows] = await pool.query(
    `SELECT DISTINCT b.barber_id
     FROM payment_bookings b
     WHERE ${filters.join(" AND ")}`,
    params,
  );
  let inserted = 0;

  for (const row of rows) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      inserted += await processBarber(connection, row.barber_id, date, now);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  return inserted;
}

export function requestScheduledQueueRecalculation(options = {}) {
  return recalculateScheduledBookings(options).catch((error) => {
    console.error("[scheduled-queue] recalculation failed:", error.message);
  });
}

let scheduledQueueTimer = null;

export function startScheduledQueueWorker({
  intervalMs = Number(process.env.SCHEDULED_QUEUE_INTERVAL_MS || 20000),
} = {}) {
  if (scheduledQueueTimer) return scheduledQueueTimer;
  const interval = Math.min(30000, Math.max(15000, intervalMs));
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await recalculateScheduledBookings();
    } catch (error) {
      console.error("[scheduled-queue] worker failed:", error.message);
    } finally {
      running = false;
    }
  };

  run();
  scheduledQueueTimer = setInterval(run, interval);
  scheduledQueueTimer.unref?.();
  return scheduledQueueTimer;
}

export function stopScheduledQueueWorker() {
  if (scheduledQueueTimer) {
    clearInterval(scheduledQueueTimer);
    scheduledQueueTimer = null;
  }
}
