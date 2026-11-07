import crypto from "node:crypto";
import { pool } from "../config/db.js";
import { AppError } from "../utils/AppError.js";

// A review belongs to a COMPLETED queue entry (an accepted booking) of the signed-in customer.
export async function createReview(req, res) {
  const { shopId, queueId, rating, text = "" } = req.body;

  const [rows] = await pool.query(
    "SELECT id, queue_status FROM payment_bookings WHERE queue_id=? AND shop_id=? AND customer_id=? AND status='accepted' LIMIT 1",
    [queueId, shopId, req.user.sub],
  );

  if (!rows.length || rows[0].queue_status !== "Completed") {
    throw AppError.badRequest(
      "A completed service is required before reviewing.",
      "SERVICE_NOT_COMPLETED",
    );
  }

  try {
    const id = crypto.randomUUID();

    await pool.query(
      "INSERT INTO booking_reviews(id,shop_id,customer_id,queue_id,rating,text) VALUES (?,?,?,?,?,?)",
      [id, shopId, req.user.sub, queueId, rating, text],
    );

    res.status(201).json({ ok: true, id });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw AppError.conflict(
        "You already reviewed this visit.",
        "ALREADY_REVIEWED",
      );
    }
    throw error;
  }
}
