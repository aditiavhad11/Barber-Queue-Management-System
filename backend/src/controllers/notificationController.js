import { pool } from "../config/db.js";
import {
  sendCustomerContactEmail,
  sendBookingNotificationEmail,
  emailConfigured,
} from "../config/mail.js";

export async function contactCustomer(req, res) {
  const {
    customerId,
    recipientEmail,
    recipientName,
    shopName,
    token,
    barber,
    services,
    status,
    message,
  } = req.body || {};
  if (!customerId || !String(message || "").trim())
    return res
      .status(400)
      .json({ message: "Customer and message are required." });
  const [rows] = await pool.query(
    "SELECT name,email FROM users WHERE id=? AND role='customer' LIMIT 1",
    [customerId],
  );
  if (!rows.length)
    return res.status(404).json({ message: "Customer account not found." });
  const customer = rows[0];
  await pool.query(
    "INSERT INTO notifications(id,user_id,tone,text) VALUES (UUID(),?,?,?)",
    [customerId, "info", String(message).trim()],
  );
  if (emailConfigured) {
    await sendCustomerContactEmail(recipientEmail || customer.email, {
      customerName: recipientName || customer.name,
      shopName,
      token,
      barber,
      services,
      status,
      message,
    });
  }
  res.json({ ok: true, emailSent: emailConfigured });
}

export async function bookingNotification(req, res) {
  const {
    recipientEmail,
    recipientName,
    bookedBy,
    shopName,
    token,
    barber,
    services,
    amount,
    forSomeoneElse,
  } = req.body || {};

  if (!recipientEmail || !String(recipientEmail).includes("@"))
    return res
      .status(400)
      .json({ message: "A valid recipient email is required." });

  const subjectText = forSomeoneElse
    ? `${bookedBy || "A customer"} booked a slot for you at ${shopName || "Barber Queue"}.`
    : `Your booking #${token || ""} is confirmed.`;

  if (emailConfigured)
    await sendBookingNotificationEmail(recipientEmail, {
      recipientName,
      bookedBy,
      shopName,
      token,
      barber,
      services,
      amount,
      forSomeoneElse,
    });

  res.json({ ok: true, emailSent: emailConfigured, message: subjectText });
}

// Payment and booking notifications saved in MySQL (ref_id is the booking id). Scoped by role.
export async function listMyNotifications(req, res) {
  const { role, sub } = req.user;
  let sql;
  let params;

  if (role === "customer") {
    sql =
      "SELECT id,shop_id,tone,text,created_at FROM notifications WHERE user_id=? AND ref_id IS NOT NULL ORDER BY created_at DESC LIMIT 50";
    params = [sub];
  } else if (role === "shop") {
    sql =
      "SELECT id,shop_id,tone,text,created_at FROM notifications WHERE shop_id=? AND ref_id IS NOT NULL ORDER BY created_at DESC LIMIT 50";
    params = [sub];
  } else if (role === "owner") {
    sql =
      "SELECT n.id,n.shop_id,n.tone,n.text,n.created_at FROM notifications n JOIN shops s ON s.id=n.shop_id WHERE s.owner_id=? AND n.ref_id IS NOT NULL ORDER BY n.created_at DESC LIMIT 50";
    params = [sub];
  } else return res.json([]);
  const [rows] = await pool.query(sql, params);
  res.json(
    rows.map((r) => ({
      id: r.id,
      shopId: r.shop_id,
      tone: r.tone,
      text: r.text,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  );
}
