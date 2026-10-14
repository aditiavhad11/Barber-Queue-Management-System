import { Queue, Worker } from "bullmq";
import { pool } from "../config/db.js";
import { sendEmergencyClosureEmail } from "../config/mail.js";

const QUEUE_NAME = "emergency-closure";
const EMAIL_BATCH_SIZE = 5;

function createRedisConnection() {
  const redisUrl = process.env.REDIS_URL
    ? new URL(process.env.REDIS_URL)
    : null;

  const password = redisUrl
    ? decodeURIComponent(redisUrl.password)
    : process.env.REDIS_PASSWORD;

  return {
    host: redisUrl?.hostname || process.env.REDIS_HOST || "127.0.0.1",
    port: Number(redisUrl?.port || process.env.REDIS_PORT || 6379),
    ...(password ? { password } : {}),
    ...(redisUrl?.username
      ? { username: decodeURIComponent(redisUrl.username) }
      : {}),
    ...(redisUrl?.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

const connection = createRedisConnection();

export const emergencyClosureQueue = new Queue(QUEUE_NAME, {
  connection,
});

const publicUrl = (path) =>
  `${(process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "")}${path}`;

export const enqueueEmergencyClosureNotifications = (shopId, closure) => {
  // Prefer a persistent closure ID when one is available.
  const closureKey =
    closure.id ?? `${closure.startDate}-${closure.endDate ?? "open-ended"}`;

  return emergencyClosureQueue.add(
    "notify-customers",
    { shopId, closure },
    {
      jobId: `shop-${shopId}-closure-${closureKey}`,
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
};

async function sendEmailsInBatches(bookings, closure) {
  for (let i = 0; i < bookings.length; i += EMAIL_BATCH_SIZE) {
    const batch = bookings
      .slice(i, i + EMAIL_BATCH_SIZE)
      .filter((booking) => booking.email);

    const results = await Promise.allSettled(
      batch.map((booking) =>
        sendEmergencyClosureEmail(booking.email, {
          customerName: booking.customer_name,
          shopName: booking.shop_name,
          token: booking.token,
          barber: booking.barber_name,
          waitUrl: publicUrl(
            `/app/queue?closure=${encodeURIComponent(booking.id)}&choice=wait`,
          ),
          refundUrl: publicUrl(
            `/app/queue?closure=${encodeURIComponent(booking.id)}&choice=refund`,
          ),
          reason: closure.reason,
          startAt: closure.startAt,
          endAt: closure.endAt,
        }),
      ),
    );

    const failures = results.filter((result) => result.status === "rejected");

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} emergency closure email(s) failed in batch ` +
          `${Math.floor(i / EMAIL_BATCH_SIZE) + 1}: ` +
          failures
            .map((result) => result.reason?.message || "Unknown error")
            .join("; "),
      );
    }
  }
}

export const emergencyClosureWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shopId, closure } = job.data;


    console.info("[emergency-closure] email worker started", {
      jobId: job.id,
      shopId,
    });

    const bookingIds = Array.isArray(closure.bookingIds)
      ? closure.bookingIds.filter(Boolean)
      : [];

    // The closure transaction records the exact affected bookings. Never fall
    // back to all emergency-closed bookings: that can send an old closure's
    // email to a customer from a later closure.
    if (!bookingIds.length) {
      console.info("[emergency-closure] no bookings recorded for job", {
        jobId: job.id,
        shopId,
      });
      return { shopId, bookingsProcessed: 0, emailsAttempted: 0 };
    }

    const [bookings] = await pool.query(
      `SELECT
         b.id,
         b.token,
         u.id AS customer_id,
         u.name AS customer_name,
         u.email,
         s.name AS shop_name,
         bar.name AS barber_name
       FROM payment_bookings b
       JOIN users u ON u.id = b.customer_id
       JOIN shops s ON s.id = b.shop_id
       JOIN barbers bar ON bar.id = b.barber_id
       WHERE b.shop_id = ?
         AND b.status = 'accepted'
         AND (b.queue_status = 'Emergency Closed'
              OR (b.queue_status = 'Cancelled' AND b.closure_choice = 'refund'))
         AND b.id IN (${bookingIds.map(() => "?").join(",")})`,
      [shopId, ...bookingIds],
    );

    if (bookings.length === 0) return;

    // In-app notifications are written transactionally when the closure starts.
    // This job is intentionally responsible only for asynchronous email delivery.

    await sendEmailsInBatches(bookings, closure);

    console.info("[emergency-closure] email worker completed", {
      jobId: job.id,
      shopId,
      bookingsProcessed: bookings.length,
    });
    return {
      shopId,
      bookingsProcessed: bookings.length,
      emailsAttempted: bookings.filter((booking) => booking.email).length,
    };
  },
  {
    connection,
    concurrency: 5,
  },
);

emergencyClosureWorker.on("failed", (job, error) => {
  console.error(
    `Emergency closure notification job failed${job ? ` (${job.id})` : ""}:`,
    error.message,
  );
});
