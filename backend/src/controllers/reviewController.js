import crypto from "node:crypto";
import { pool } from "../config/db.js";

// A review belongs to a COMPLETED queue entry (an accepted booking) of the signed-in customer.
export async function createReview(req, res) {
  const { shopId, queueId } = req.body || {};
  const rating = Number(req.body?.rating);
  const text = String(req.body?.text || "")
    .trim()
    .slice(0, 2000);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return res.status(400).json({ message: "Choose a rating from 1 to 5." });
  const [rows] = await pool.query(
    "SELECT id, queue_status FROM payment_bookings WHERE queue_id=? AND shop_id=? AND customer_id=? AND status='accepted' LIMIT 1",
    [queueId, shopId, req.user.sub],
  );
  if (!rows.length || rows[0].queue_status !== "Completed")
    return res
      .status(400)
      .json({ message: "A completed service is required before reviewing." });
  try {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO booking_reviews(id,shop_id,customer_id,queue_id,rating,text) VALUES (?,?,?,?,?,?)",
      [id, shopId, req.user.sub, queueId, rating, text],
    );
    res.status(201).json({ ok: true, id });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "You already reviewed this visit." });
    throw error;
  }
}
