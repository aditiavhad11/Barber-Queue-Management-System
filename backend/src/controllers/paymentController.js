import crypto from "node:crypto";
import { pool } from "../config/db.js";
import { addNotification, findBookings, hydrateBookings, rupees } from "../models/bookingModel.js";

const REBOOK_BLOCK_MINUTES = 30;
const AMOUNT_WINDOW_MINUTES = 15;

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const signQuote = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET || "missing-secret").update(body).digest("hex");
  return `${body}.${signature}`;
};
const verifyQuote = (token) => {
  try {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature) return null;
    const expected = crypto.createHmac("sha256", process.env.JWT_SECRET || "missing-secret").update(body).digest("hex");
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

function beneficiaryFrom(body, customer) {
  const raw = body?.beneficiary || {};
  if (raw.isSelf === false) {
    const person = {
      isSelf: false,
      name: String(raw.name || "").trim(),
      mobile: String(raw.mobile || "").trim(),
      email: String(raw.email || "").trim().toLowerCase(),
    };
    if (!person.name) return { error: "Enter the name of the person being booked for." };
    return { person, key: `beneficiary:${person.name.toLowerCase()}|${person.mobile || person.email || ""}` };
  }
  return {
    person: {
      isSelf: true,
      name: customer.name,
      mobile: String(raw.mobile || "").trim(),
      email: customer.email,
    },
    key: `user:${customer.id}`,
  };
}

async function validateSelection(connection, { shopId, barberId, serviceIds, customerId }) {
  const [shops] = await connection.query(
    "SELECT id,name,upi_qr_url FROM shops WHERE id=? AND status='approved' AND active=1 LIMIT 1",
    [shopId],
  );
  if (!shops.length) throw Object.assign(new Error("This shop is not accepting bookings right now."), { status: 404 });
  if (!shops[0].upi_qr_url) throw Object.assign(new Error("This shop can't take bookings yet."), { status: 409 });

  const [barbers] = await connection.query(
    "SELECT id,status FROM barbers WHERE id=? AND shop_id=? LIMIT 1",
    [barberId, shopId],
  );
  if (!barbers.length) throw Object.assign(new Error("Selected barber was not found in this shop."), { status: 404 });
  if (barbers[0].status !== "Available") throw Object.assign(new Error("This barber is not available right now."), { status: 409 });

  const marks = serviceIds.map(() => "?").join(",");
  const [services] = await connection.query(
    `SELECT id,name,price,duration_minutes FROM services WHERE shop_id=? AND enabled=1 AND id IN (${marks})`,
    [shopId, ...serviceIds],
  );
  if (services.length !== serviceIds.length) throw Object.assign(new Error("One or more selected services are not available."), { status: 400 });

  const [offered] = await connection.query(
    `SELECT service_id FROM barber_services WHERE barber_id=? AND service_id IN (${marks})`,
    [barberId, ...serviceIds],
  );
  if (offered.length !== serviceIds.length) throw Object.assign(new Error("This barber does not offer all selected services."), { status: 400 });

  const [users] = await connection.query(
    "SELECT id,name,email FROM users WHERE id=? AND role='customer' AND status='active' LIMIT 1",
    [customerId],
  );
  if (!users.length) throw Object.assign(new Error("Customer account not found."), { status: 403 });

  const amount = services.reduce((sum, x) => sum + Number(x.price), 0);
  const duration = services.reduce((sum, x) => sum + Number(x.duration_minutes), 0);
  if (!(amount > 0)) throw Object.assign(new Error("A valid payment amount is required."), { status: 400 });

  return { shop: shops[0], services, customer: users[0], amount, duration };
}

async function chooseAmount(connection, shopId, baseAmount) {
  const [rows] = await connection.query(
    `SELECT amount FROM payment_bookings
     WHERE shop_id=? AND status='payment_submitted'
       AND created_at > (NOW() - INTERVAL ${AMOUNT_WINDOW_MINUTES} MINUTE)`,
    [shopId],
  );

  const used = new Set(rows.map((r) => Number(r.amount).toFixed(2)));
  let amount = Math.round(Number(baseAmount) * 100) / 100;
  while (used.has(amount.toFixed(2))) amount = Math.round((amount + 0.01) * 100) / 100;
  return amount;
}

async function expireStalePending(connection, customerId, beneficiaryKey) {
  await connection.query(
    `UPDATE payment_bookings
     SET status='cancelled', decline_reason='Confirmation window expired'
     WHERE customer_id=? AND beneficiary_key=? AND status='payment_submitted'
       AND created_at <= (NOW() - INTERVAL 15 MINUTE)`,
    [customerId, beneficiaryKey],
  );
}

function responsePayload(booking, shop, services) {
  return {
    bookingId: booking.id,
    amount: Number(booking.amount),
    currency: "INR",
    qrUrl: shop.upi_qr_url,
    shopName: shop.name,
    description: services.map((x) => x.name).join(", "),
  };
}

// Read-only quote used by the pay screen. The actual submit endpoint recalculates everything again.
export async function paymentQuote(req, res) {
  const connection = await pool.getConnection();
  try {
    const customerId = req.user.sub;
    const shopId = String(req.body?.shopId || "");
    const barberId = String(req.body?.barberId || "");
    const serviceIds = [...new Set((Array.isArray(req.body?.serviceIds) ? req.body.serviceIds : []).map(String))].sort();
    if (!shopId || !barberId || !serviceIds.length) return res.status(400).json({ message: "Shop, barber and at least one service are required." });

    const { shop, services, customer, amount } = await validateSelection(connection, { shopId, barberId, serviceIds, customerId });
    const who = beneficiaryFrom(req.body, customer);
    if (who.error) return res.status(400).json({ message: who.error });

    await expireStalePending(connection, customerId, who.key);

    const [pending] = await connection.query(
      "SELECT id FROM payment_bookings WHERE customer_id=? AND beneficiary_key=? AND status='payment_submitted' LIMIT 1",
      [customerId, who.key],
    );
    if (pending.length) return res.status(409).json({ message: "You already have a payment waiting for this booking.", bookingId: pending[0].id });

    const [blocked] = await connection.query(
      "SELECT id FROM payment_bookings WHERE shop_id=? AND customer_id=? AND status='rejected' AND declined_until > NOW() ORDER BY declined_until DESC LIMIT 1",
      [shopId, customerId],
    );
    if (blocked.length) return res.status(429).json({ message: "This booking cannot be retried for 30 minutes after a declined payment.", bookingId: blocked[0].id });

    const finalAmount = await chooseAmount(connection, shopId, amount);
    const quotePayload = {
      customerId,
      shopId,
      barberId,
      serviceIds,
      beneficiaryKey: who.key,
      amount: finalAmount,
      qrUrl: shop.upi_qr_url,
      exp: Date.now() + (AMOUNT_WINDOW_MINUTES * 60 * 1000),
    };
    res.json({
      ...responsePayload({ id: null, amount: finalAmount }, shop, services),
      quoteToken: signQuote(quotePayload),
    });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || "Could not prepare payment." });
  } finally {
    connection.release();
  }
}

// The customer only reaches this endpoint after paying the exact amount shown on the pay screen.
// The server recalculates prices, beneficiary rules, duplicate rules and the amount before creating the booking.
export async function submitPayment(req, res) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const customerId = req.user.sub;
    const shopId = String(req.body?.shopId || "");
    const barberId = String(req.body?.barberId || "");
    const serviceIds = [...new Set((Array.isArray(req.body?.serviceIds) ? req.body.serviceIds : []).map(String))].sort();
    if (!shopId || !barberId || !serviceIds.length) throw Object.assign(new Error("Shop, barber and at least one service are required."), { status: 400 });

    // Serialize submissions for the same customer so a double-click cannot create two pending bookings.
    const [customerRows] = await connection.query("SELECT id FROM users WHERE id=? AND role='customer' AND status='active' FOR UPDATE", [customerId]);
    if (!customerRows.length) throw Object.assign(new Error("Customer account not found."), { status: 403 });

    const { shop, services, customer, amount: baseAmount, duration } = await validateSelection(connection, { shopId, barberId, serviceIds, customerId });
    const who = beneficiaryFrom(req.body, customer);
    if (who.error) throw Object.assign(new Error(who.error), { status: 400 });

    await expireStalePending(connection, customerId, who.key);

    const [pending] = await connection.query(
      "SELECT id FROM payment_bookings WHERE customer_id=? AND beneficiary_key=? AND status='payment_submitted' LIMIT 1",
      [customerId, who.key],
    );
    if (pending.length) throw Object.assign(new Error("You already have a payment waiting for the shop."), { status: 409, bookingId: pending[0].id });

    const [blocked] = await connection.query(
      "SELECT id FROM payment_bookings WHERE shop_id=? AND customer_id=? AND status='rejected' AND declined_until > NOW() ORDER BY declined_until DESC LIMIT 1",
      [shopId, customerId],
    );
    if (blocked.length) throw Object.assign(new Error("This booking cannot be retried for 30 minutes after a declined payment."), { status: 429, bookingId: blocked[0].id });

    const quote = verifyQuote(req.body?.quoteToken);
    const selectionMatches = quote
      && quote.customerId === customerId
      && quote.shopId === shopId
      && quote.barberId === barberId
      && quote.beneficiaryKey === who.key
      && quote.qrUrl === shop.upi_qr_url
      && JSON.stringify(quote.serviceIds) === JSON.stringify(serviceIds);
    if (!selectionMatches) throw Object.assign(new Error("Payment amount could not be verified. Reopen the payment screen and try again."), { status: 400 });

    const finalAmount = Number(quote.amount);
    if (!Number.isFinite(finalAmount) || finalAmount <= 0) throw Object.assign(new Error("Invalid payment amount."), { status: 400 });

    const bookingId = crypto.randomUUID();
    const requestHash = sha256([shopId, barberId, serviceIds.join(","), who.key, finalAmount.toFixed(2)].join("|"));

    const [recentSame] = await connection.query(
      `SELECT id FROM payment_bookings
       WHERE customer_id=? AND request_hash=? AND status='payment_submitted'
         AND created_at > (NOW() - INTERVAL ${REBOOK_BLOCK_MINUTES} MINUTE)
       LIMIT 1`,
      [customerId, requestHash],
    );
    if (recentSame.length) throw Object.assign(new Error("This payment submission is already being checked by the shop."), { status: 409, bookingId: recentSame[0].id });

    await connection.query(
      `INSERT INTO payment_bookings
       (id,shop_id,barber_id,customer_id,service_ids_json,amount,duration_minutes,beneficiary_json,beneficiary_key,request_hash,payment_method,status,payer_name,payment_submitted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'upi_qr','payment_submitted',?,NOW())`,
      [
        bookingId, shopId, barberId, customerId, JSON.stringify(serviceIds), finalAmount, duration,
        JSON.stringify(who.person), who.key, requestHash, String(req.body?.payerName || "").trim().slice(0, 120) || customer.name,
      ],
    );

    await connection.commit();

    const rows = await findBookings("b.id=?", [bookingId], "LIMIT 1");
    const hydrated = await hydrateBookings(rows);
    const booking = hydrated[0];

    if (!booking) {
      throw Object.assign(new Error("Booking was created but could not be loaded."), { status: 500 });
    }
    const payer = booking.payerName || booking.customerName;
    const bookedFor = booking.beneficiary?.isSelf === false ? `for ${booking.beneficiary.name}, booked by ${booking.customerName}` : booking.customerName;

    await addNotification({
      shopId,
      tone: "info",
      refId: bookingId,
      text: `New payment submitted: ${rupees(booking.amount)} by ${payer} for ${bookedFor}. ${booking.services.map((x) => x.name).join(" + ")} with ${booking.barberName}.`,
    });

    await addNotification({
      userId: customerId,
      tone: "info",
      refId: bookingId,
      text: `Payment submitted for ${rupees(booking.amount)} at ${booking.shopName}. The shop is checking your payment.`,
    });

    res.status(201).json({ booking });
  } catch (error) {
    await connection.rollback().catch(() => {});
    res.status(error.status || 500).json({ message: error.message || "Could not submit the payment.", bookingId: error.bookingId, amount: error.amount });
  } finally {
    connection.release();
  }
}
