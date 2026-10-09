import { pool } from "../config/db.js";

const parse = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
const iso = (value) => (value ? new Date(value).toISOString() : null);

export const rupees = (amount) => `Rs. ${Number(amount).toLocaleString("en-IN")}`;

const SELECT_BOOKING = `SELECT b.*, s.name AS shop_name, s.upi_qr_url AS shop_upi_qr_url, bar.name AS barber_name, u.name AS customer_name
  FROM payment_bookings b
  JOIN shops s ON s.id = b.shop_id
  JOIN barbers bar ON bar.id = b.barber_id
  JOIN users u ON u.id = b.customer_id`;

export async function findBookings(where, params = [], tail = "ORDER BY b.created_at DESC") {
  const [rows] = await pool.query(`${SELECT_BOOKING} WHERE ${where} ${tail}`, params);
  return rows;
}

export async function hydrateBookings(rows) {
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((row) => parse(row.service_ids_json, [])))];
  let byId = new Map();
  if (ids.length) {
    const [services] = await pool.query(`SELECT id,name,price,duration_minutes FROM services WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    byId = new Map(services.map((x) => [x.id, x]));
  }
  return rows.map((row) => {
    const serviceIds = parse(row.service_ids_json, []);
    return {
      id: row.id,
      shopId: row.shop_id,
      shopName: row.shop_name || "",
      barberId: row.barber_id,
      barberName: row.barber_name || "",
      customerId: row.customer_id,
      customerName: row.customer_name || "",
      serviceIds,
      services: serviceIds.map((id) => byId.get(id)).filter(Boolean).map((x) => ({ id: x.id, name: x.name, price: Number(x.price), duration: Number(x.duration_minutes) })),
      amount: Number(row.amount),
      durationMinutes: Number(row.duration_minutes),
      beneficiary: parse(row.beneficiary_json, {}),
      status: row.status,
      paymentMethod: "UPI QR",
      paymentReference: row.payment_reference || null,
      payerName: row.payer_name || row.customer_name || "",
      paymentSubmittedAt: iso(row.payment_submitted_at),
      qrUrl: row.shop_upi_qr_url || null,
      orderId: null,
      paymentId: row.payment_reference || null,
      token: row.token || null,
      queueId: row.queue_id || null,
      failureReason: row.failure_reason || "",
      refundStatus: row.refund_status || null,
      declineReason: row.decline_reason || "",
      createdAt: iso(row.created_at),
      paidAt: iso(row.paid_at),
      acceptedAt: iso(row.accepted_at),
      queueStatus: row.queue_status || (row.status === "accepted" ? "Waiting" : null),
      skippedAt: iso(row.skipped_at),
      skipCount: Number(row.skip_count || 0),
      completedAt: iso(row.completed_at),
    };
  });
}

// Notifications are stored in MySQL so they survive refreshes and reach the right panel.
// ref_id links a notification to the booking that caused it.
export async function addNotification({ shopId = null, userId = null, tone = "info", text, refId }) {
  try {
    await pool.query("INSERT INTO notifications(id,user_id,shop_id,tone,text,ref_id) VALUES (UUID(),?,?,?,?,?)", [userId, shopId, tone, text, refId]);
  } catch (error) {
    console.error("Could not save notification:", error.message);
  }
}
