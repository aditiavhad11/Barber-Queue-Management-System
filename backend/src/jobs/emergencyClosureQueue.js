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

async function insertNotifications(bookings, shopId) {
  if (bookings.length === 0) return;

  const placeholders = bookings.map(() => "(UUID(), ?, ?, ?, ?, ?)").join(", ");

  const values = bookings.flatMap((booking) => [
    booking.customer_id,
    shopId,
    "alert",
    `${booking.shop_name} closed unexpectedly. Choose whether to wait for reopening or request a refund for token #${booking.token}.`,
    booking.id,
  ]);

  // One bulk INSERT instead of one INSERT per booking.
  // Duplicate prevention is enforced by the database unique index below.
  await pool.query(
    `INSERT IGNORE INTO notifications
       (id, user_id, shop_id, tone, text, ref_id)
     VALUES ${placeholders}`,
    values,
  );
}

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
         AND b.queue_status = 'Emergency Closed'`,
      [shopId],
    );

    if (bookings.length === 0) return;

    // Phase 1: persist all in-app notifications in one DB operation.
    await insertNotifications(bookings, shopId);

    // Phase 2: send emails with bounded concurrency.
    await sendEmailsInBatches(bookings, closure);

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
