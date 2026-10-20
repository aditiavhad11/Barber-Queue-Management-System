import { pool } from "../config/db.js";

const parse = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const iso = (value) => (value ? new Date(value).toISOString() : null);

export const rupees = (amount) =>
  `Rs. ${Number(amount).toLocaleString("en-IN")}`;

const SELECT_BOOKING = `SELECT b.*, DATE_FORMAT(b.booking_date, '%Y-%m-%d') AS booking_date_string, s.name AS shop_name, s.upi_qr_url AS shop_upi_qr_url, bar.name AS barber_name, u.name AS customer_name
  FROM payment_bookings b
  JOIN shops s ON s.id = b.shop_id
  JOIN barbers bar ON bar.id = b.barber_id
  JOIN users u ON u.id = b.customer_id`;

export async function findBookings(
  where,
  params = [],
  tail = "ORDER BY b.created_at DESC",
) {
  const [rows] = await pool.query(
    `${SELECT_BOOKING} WHERE ${where} ${tail}`,
    params,
  );
  return rows;
}

export async function hydrateBookings(rows) {
  if (!rows.length) return [];
  const ids = [
    ...new Set(rows.flatMap((row) => [...parse(row.service_ids_json, []), ...Object.keys(parse(row.free_service_quantities_json, {}))])),
  ];
  let byId = new Map();
  let adjustmentsByBooking = new Map();
  if (ids.length) {
    const [services] = await pool.query(
      `SELECT id,name,price,duration_minutes FROM services WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    byId = new Map(services.map((x) => [x.id, x]));
  }
  try {
    const [adjustments] = await pool.query(
      `SELECT booking_id,SUM(amount_delta) AS amount_delta
       FROM booking_service_edits WHERE status='applied' AND booking_id IN (${rows.map(() => "?").join(",")})
       GROUP BY booking_id`,
      rows.map((row) => row.id),
    );
    adjustmentsByBooking = new Map(adjustments.map((row) => [row.booking_id, Number(row.amount_delta || 0)]));
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") throw error;
  }
  return rows.map((row) => {
    const serviceIds = parse(row.service_ids_json, []);
    const quantities = parse(row.service_quantities_json, {});
    const freeQuantities = parse(row.free_service_quantities_json, {});
    return {
      id: row.id,
      shopId: row.shop_id,
      shopName: row.shop_name || "",
      barberId: row.barber_id,
      barberName: row.barber_name || "",
      customerId: row.customer_id,
      bookingDate: row.booking_date_string || iso(row.created_at)?.slice(0, 10),
      scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : null,
      isSameDayScheduled: Boolean(row.scheduled_time && row.booking_date_string === new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
      }).format(new Date())),
      customerName: row.customer_name || "",
      serviceIds,
      services: serviceIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((x) => ({
          id: x.id,
          name: x.name,
          price: Number(x.price),
          duration: Number(x.duration_minutes),
          quantity: Number(quantities[String(x.id)] || 1),
        })),
      freeServices: Object.entries(freeQuantities).map(([id, quantity]) => byId.get(id)).filter(Boolean).map((x) => ({ id: x.id, name: x.name, price: 0, retailPrice: Number(x.price), duration: Number(x.duration_minutes), quantity: Number(freeQuantities[String(x.id)] || 0) })),
      serviceQuantities: quantities,
      freeServiceQuantities: freeQuantities,
      amount: Number(row.amount),
      originalAmount: Number(row.original_amount ?? row.amount),
      discountAmount: Number(row.discount_amount || 0),
      schemeId: row.scheme_id || null,
      totalAmount: Number(row.amount) + (adjustmentsByBooking.get(row.id) || 0),
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
      queuePosition: Number(row.queue_position || 0) || null,
      failureReason: row.failure_reason || "",
      refundStatus: row.refund_status || null,
      closureChoice: row.closure_choice || null,
      declineReason: row.decline_reason || "",
      createdAt: iso(row.created_at),
      paidAt: iso(row.paid_at),
      acceptedAt: iso(row.accepted_at),
      queueStatus:
        row.queue_status || (row.status === "accepted" ? "Waiting" : null),
      isPrebooking:
        row.status === "accepted" &&
        row.booking_date_string &&
        row.booking_date_string !== new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
        }).format(new Date()),
      skippedAt: iso(row.skipped_at),
      skipCount: Number(row.skip_count || 0),
      completedAt: iso(row.completed_at),
    };
  });
}

// Notifications are stored in MySQL so they survive refreshes and reach the right panel.
// ref_id links a notification to the booking that caused it.
export async function addNotification({
  shopId = null,
  userId = null,
  tone = "info",
  text,
  refId,
}) {
  try {
    await pool.query(
      "INSERT INTO notifications(id,user_id,shop_id,tone,text,ref_id) VALUES (UUID(),?,?,?,?,?)",
      [userId, shopId, tone, text, refId],
    );
  } catch (error) {
    console.error("Could not save notification:", error.message);
  }
}
