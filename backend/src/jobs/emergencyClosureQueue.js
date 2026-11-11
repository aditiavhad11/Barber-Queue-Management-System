import { Queue, Worker } from "bullmq";
import { pool } from "../config/db.js";
import { sendEmergencyClosureEmail } from "../config/mail.js";

const QUEUE_NAME = "emergency-closure";

export function createRedisConnectionOptions(env = process.env) {
  const redisUrl = env.REDIS_URL
    ? new URL(env.REDIS_URL)
    : null;

  const password = redisUrl
    ? decodeURIComponent(redisUrl.password)
    : env.REDIS_PASSWORD;

  return {
    host: redisUrl?.hostname || env.REDIS_HOST || "127.0.0.1",
    port: Number(redisUrl?.port || env.REDIS_PORT || 6379),
    ...(password ? { password } : {}),
    ...(redisUrl?.username
      ? { username: decodeURIComponent(redisUrl.username) }
      : {}),
    ...(redisUrl?.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    retryStrategy: (times) => {
      if (env.NODE_ENV === "test") return null;
      return Math.min(times * 1000, 30000);
    },
  };
}

const connection = createRedisConnectionOptions();

export const emergencyClosureQueue = new Queue(QUEUE_NAME, {
  connection,
});

emergencyClosureQueue.on("error", (error) => {
  console.error("[emergency-closure-queue] Error:", error.message);
});

const publicUrl = (path) =>
  `${(process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "")}${path}`;

export function emergencyClosureJobId(shopId, closureId) {
  return `shop-${shopId}-closure-${closureId}`;
}

export const enqueueEmergencyClosureNotifications = (shopId, closure) => {
  // Prefer a persistent closure ID when one is available.
  const closureKey =
    closure.id ?? `${closure.startDate}-${closure.endDate ?? "open-ended"}`;

  return emergencyClosureQueue.add(
    "notify-customers",
    { shopId, closure },
    {
      jobId: emergencyClosureJobId(shopId, closureKey),
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 1000 },
    },
  );
};

const outboxSelect = `SELECT n.booking_id AS id,b.token,u.name AS customer_name,u.email,
       s.name AS shop_name,bar.name AS barber_name
     FROM emergency_closure_notifications n
     JOIN payment_bookings b ON b.id=n.booking_id
     JOIN users u ON u.id=b.customer_id
     JOIN shops s ON s.id=b.shop_id
     JOIN barbers bar ON bar.id=b.barber_id
     WHERE n.closure_id=? AND n.email_sent_at IS NULL`;

export async function processEmergencyClosureNotificationJob(
  { shopId, closure },
  { query = pool.query.bind(pool), sendEmail = sendEmergencyClosureEmail } = {},
) {
  const [bookings] = await query(outboxSelect, [closure.id]);
  let processed = 0;
  for (const booking of bookings) {
    const sent = await sendEmail(booking.email, {
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
    });
    if (sent === false)
      throw new Error("Emergency closure email was not accepted by the mail transport.");

    const [result] = await query(
      `UPDATE emergency_closure_notifications
       SET email_sent_at=NOW()
       WHERE closure_id=? AND booking_id=? AND email_sent_at IS NULL`,
      [closure.id, booking.id],
    );
    if (result.affectedRows) processed += 1;
  }
  return { shopId, bookingsProcessed: processed, emailsAttempted: processed };
}

export async function enqueuePendingEmergencyClosureNotifications({
  query = pool.query.bind(pool),
  queue = emergencyClosureQueue,
} = {}) {
  const [closures] = await query(
    `SELECT DISTINCT c.id,c.shop_id,c.reason,c.start_at,c.end_at
     FROM emergency_closures c
     JOIN emergency_closure_notifications n ON n.closure_id=c.id
     WHERE n.email_sent_at IS NULL`,
  );
  let enqueued = 0;
  for (const row of closures) {
    const closure = {
      id: row.id,
      reason: row.reason,
      startAt: row.start_at,
      endAt: row.end_at,
    };
    const jobId = emergencyClosureJobId(row.shop_id, row.id);
    const existing = await queue.getJob(jobId);
    if (existing) {
      if ((await existing.getState()) === "failed") {
        await existing.retry("failed");
        enqueued += 1;
      }
      continue;
    }
    await queue.add(
      "notify-customers",
      { shopId: row.shop_id, closure },
      {
        jobId,
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 1000 },
      },
    );
    enqueued += 1;
  }
  return enqueued;
}

export let emergencyClosureWorker = null;
let recoveryTimer = null;

export function startEmergencyClosureWorker() {
  if (emergencyClosureWorker) return emergencyClosureWorker;

  emergencyClosureWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.info("[emergency-closure] email worker started", {
        jobId: job.id,
      });
      const result = await processEmergencyClosureNotificationJob(job.data);
      console.info("[emergency-closure] email worker completed", {
        jobId: job.id,
        shopId: job.data.shopId,
        bookingsProcessed: result.bookingsProcessed,
      });
      return result;
    },
    {
      connection,
      concurrency: 1,
    },
  );

  emergencyClosureWorker.on("failed", (job, error) => {
    console.error(
      `Emergency closure notification job failed${job ? ` (${job.id})` : ""}:`,
      error.message,
    );
  });

  emergencyClosureWorker.on("error", (error) => {
    console.error("[emergency-closure-worker] Error:", error.message);
  });

  const reconcile = () =>
    enqueuePendingEmergencyClosureNotifications().catch((error) => {
      console.error(
        "[emergency-closure] pending notification reconciliation failed:",
        error.message,
      );
    });
  reconcile();
  recoveryTimer = setInterval(reconcile, 30000);
  recoveryTimer.unref?.();

  return emergencyClosureWorker;
}

export async function stopEmergencyClosureWorker() {
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
  if (emergencyClosureWorker) {
    try {
      await emergencyClosureWorker.close();
    } catch (e) {
      console.error("[emergency-closure-worker] Error closing worker:", e.message);
    }
    emergencyClosureWorker = null;
  }
  if (emergencyClosureQueue) {
    try {
      await emergencyClosureQueue.close();
    } catch (e) {
      console.error("[emergency-closure-queue] Error closing queue:", e.message);
    }
  }
}
