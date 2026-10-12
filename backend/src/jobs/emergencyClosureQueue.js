import { Queue, Worker } from "bullmq";
import { pool } from "../config/db.js";
import { sendEmergencyClosureEmail } from "../config/mail.js";

const redisUrl = process.env.REDIS_URL
  ? new URL(process.env.REDIS_URL)
  : null;
const connection = {
  host: redisUrl?.hostname || process.env.REDIS_HOST || "127.0.0.1",
  port: Number(redisUrl?.port || process.env.REDIS_PORT || 6379),
  ...(redisUrl?.password || process.env.REDIS_PASSWORD
    ? { password: decodeURIComponent(redisUrl?.password || process.env.REDIS_PASSWORD) }
    : {}),
  maxRetriesPerRequest: null,
};

export const emergencyClosureQueue = new Queue("emergency-closure", {
  connection,
});

const publicUrl = (path) =>
  `${String(process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "")}${path}`;

export const enqueueEmergencyClosureNotifications = (shopId, closure) =>
  emergencyClosureQueue.add(
    "notify-customers",
    { shopId, closure },
    {
      jobId: `shop-${shopId}-${closure.startDate}-${Date.now()}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );

export const emergencyClosureWorker = new Worker(
  "emergency-closure",
  async (job) => {
    const { shopId, closure } = job.data;
    const [rows] = await pool.query(
      `SELECT b.id,b.token,b.amount,u.id AS customer_id,u.name AS customer_name,u.email,
              s.name AS shop_name,bar.name AS barber_name,
              b.service_ids_json
       FROM payment_bookings b
       JOIN users u ON u.id=b.customer_id
       JOIN shops s ON s.id=b.shop_id
       JOIN barbers bar ON bar.id=b.barber_id
       WHERE b.shop_id=? AND b.status='accepted'
         AND b.queue_status='Emergency Closed'`,
      [shopId],
    );

    for (const booking of rows) {
      await pool.query(
        `INSERT INTO notifications(id,user_id,shop_id,tone,text,ref_id)
         SELECT UUID(),?,?,?,?,?
         WHERE NOT EXISTS (
           SELECT 1 FROM notifications
           WHERE user_id=? AND ref_id=? AND tone='alert'
         )`,
        [
          booking.customer_id,
          shopId,
          "alert",
          `${booking.shop_name} closed unexpectedly. Choose whether to wait for reopening or request a refund for token #${booking.token}.`,
          booking.id,
          booking.customer_id,
          booking.id,
        ],
      );

      if (booking.email) {
        await sendEmergencyClosureEmail(booking.email, {
          customerName: booking.customer_name,
          shopName: booking.shop_name,
          token: booking.token,
          barber: booking.barber_name,
          waitUrl: publicUrl(`/app/queue?closure=${booking.id}&choice=wait`),
          refundUrl: publicUrl(`/app/queue?closure=${booking.id}&choice=refund`),
          reason: closure.reason,
        });
      }
    }
  },
  { connection, concurrency: 5 },
);

emergencyClosureWorker.on("failed", (job, error) => {
  console.error(
    `Emergency closure notification job failed${job ? ` (${job.id})` : ""}:`,
    error.message,
  );
});
