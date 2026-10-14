import crypto from "node:crypto";
import { pool } from "../config/db.js";

const parseIds = (value) => {
  if (Array.isArray(value)) return value.map(String);
  try { return JSON.parse(value || "[]").map(String); } catch { return []; }
};
const bool = (value) => value === true || value === 1 || value === "1";
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function mapScheme(row) {
  return {
    id: row.id,
    shopId: row.shop_id,
    title: row.title,
    description: row.description || "",
    imageUrl: row.image_url || "",
    terms: row.terms || "",
    discountType: row.discount_type,
    discountValue: Number(row.discount_value || 0),
    startsAt: row.starts_at_utc || row.starts_at || null,
    endsAt: row.ends_at_utc || row.ends_at || null,
    allServices: bool(row.all_services),
    serviceIds: parseIds(row.service_ids_json),
    allBarbers: bool(row.all_barbers),
    barberIds: parseIds(row.barber_ids_json),
    minimumAmount: Number(row.minimum_amount || 0),
    maximumDiscount: row.maximum_discount == null ? null : Number(row.maximum_discount),
    usageLimit: row.usage_limit == null ? null : Number(row.usage_limit),
    perCustomerLimit: row.per_customer_limit == null ? null : Number(row.per_customer_limit),
    promoCode: row.promo_code || "",
    status: row.effective_status || row.status,
    storedStatus: row.status,
  };
}

async function ownerShop(req, shopId) {
  const [rows] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND owner_id=? LIMIT 1",
    [shopId, req.user.sub],
  );
  return rows.length > 0;
}

function validateInput(body, partial = false) {
  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  const discountType = String(body.discountType ?? "percentage");
  const discountValue = Number(body.discountValue);
  const status = String(body.status ?? "draft");
  const promoCode = String(body.promoCode ?? "").trim().toUpperCase();
  const startsAt = body.startsAt ? new Date(body.startsAt) : null;
  const endsAt = body.endsAt ? new Date(body.endsAt) : null;
  const allServices = body.allServices !== false;
  const allBarbers = body.allBarbers !== false;
  const serviceIds = [...new Set((Array.isArray(body.serviceIds) ? body.serviceIds : []).map(String))];
  const barberIds = [...new Set((Array.isArray(body.barberIds) ? body.barberIds : []).map(String))];
  const minimumAmount = Number(body.minimumAmount ?? 0);
  const maximumDiscount = body.maximumDiscount === "" || body.maximumDiscount == null ? null : Number(body.maximumDiscount);
  const usageLimit = body.usageLimit === "" || body.usageLimit == null ? null : Number(body.usageLimit);
  const perCustomerLimit = body.perCustomerLimit === "" || body.perCustomerLimit == null ? null : Number(body.perCustomerLimit);
  const invalid = (message) => Object.assign(new Error(message), { status: 400 });

  if (!partial || body.title !== undefined) {
    if (!title || title.length > 120) throw invalid("Enter an offer title up to 120 characters.");
  }
  if (!partial || body.description !== undefined) {
    if (!description || description.length > 2000) throw invalid("Enter an offer description up to 2,000 characters.");
  }
  if (!partial || body.status !== undefined) {
    if (!["draft", "active", "paused"].includes(status)) throw invalid("Choose Draft, Active, or Paused.");
  }
  if (!partial || body.discountType !== undefined || body.discountValue !== undefined) {
    if (!["percentage", "fixed"].includes(discountType) || !Number.isFinite(discountValue) || discountValue <= 0 || (discountType === "percentage" && discountValue > 100))
      throw invalid("Enter a valid percentage (up to 100%) or fixed discount amount.");
  }
  if (!Number.isFinite(minimumAmount) || minimumAmount < 0 || (maximumDiscount !== null && (!Number.isFinite(maximumDiscount) || maximumDiscount < 0)))
    throw invalid("Minimum amount and maximum discount must be zero or greater.");
  for (const limit of [usageLimit, perCustomerLimit])
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw invalid("Usage limits must be positive whole numbers.");
  if (promoCode && !/^[A-Z0-9_-]{3,32}$/.test(promoCode)) throw invalid("Promo codes must be 3 to 32 letters, numbers, hyphens, or underscores.");
  if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) throw invalid("Enter valid offer start and end times.");
  if (status !== "draft" && (!startsAt || !endsAt || startsAt >= endsAt)) throw invalid("Active or paused offers need an end time later than their start time.");
  return {
    title, description, terms: String(body.terms ?? "").trim().slice(0, 4000),
    imageUrl: String(body.imageUrl ?? "").trim().slice(0, 1000),
    discountType, discountValue: Number.isFinite(discountValue) ? discountValue : 0,
    startsAt: startsAt ? startsAt.toISOString().slice(0, 19).replace("T", " ") : null,
    endsAt: endsAt ? endsAt.toISOString().slice(0, 19).replace("T", " ") : null,
    allServices, serviceIds, allBarbers, barberIds, minimumAmount,
    maximumDiscount, usageLimit, perCustomerLimit, promoCode: promoCode || null, status,
  };
}

async function validateScope(connection, shopId, form) {
  if (!form.allServices) {
    if (!form.serviceIds.length) throw Object.assign(new Error("Select at least one service or choose all services."), { status: 400 });
    const [rows] = await connection.query(
      `SELECT id FROM services WHERE shop_id=? AND id IN (${form.serviceIds.map(() => "?").join(",")})`,
      [shopId, ...form.serviceIds],
    );
    if (rows.length !== form.serviceIds.length) throw Object.assign(new Error("One or more services do not belong to this shop."), { status: 400 });
  }
  if (!form.allBarbers) {
    if (!form.barberIds.length) throw Object.assign(new Error("Select at least one barber or choose all barbers."), { status: 400 });
    const [rows] = await connection.query(
      `SELECT id FROM barbers WHERE shop_id=? AND id IN (${form.barberIds.map(() => "?").join(",")})`,
      [shopId, ...form.barberIds],
    );
    if (rows.length !== form.barberIds.length) throw Object.assign(new Error("One or more barbers do not belong to this shop."), { status: 400 });
  }
}

const SELECT_SCHEME = `SELECT *,
  DATE_FORMAT(starts_at,'%Y-%m-%dT%H:%i:%sZ') AS starts_at_utc,
  DATE_FORMAT(ends_at,'%Y-%m-%dT%H:%i:%sZ') AS ends_at_utc,
  CASE
  WHEN status='draft' THEN 'draft'
  WHEN status='paused' THEN 'paused'
  WHEN starts_at>UTC_TIMESTAMP() THEN 'scheduled'
  WHEN ends_at<UTC_TIMESTAMP() THEN 'expired'
  ELSE 'active' END AS effective_status FROM schemes`;

export async function listManagedSchemes(req, res) {
  const shopId = String(req.params.shopId || "");
  if (!(await ownerShop(req, shopId))) return res.status(404).json({ message: "Shop not found or not owned by this account." });
  const [rows] = await pool.query(`${SELECT_SCHEME} WHERE shop_id=? ORDER BY updated_at DESC`, [shopId]);
  res.json(rows.map(mapScheme));
}

export async function listShopSchemes(req, res) {
  const shopId = String(req.params.shopId || "");
  const [shops] = await pool.query("SELECT id FROM shops WHERE id=? AND status='approved' AND active=1 LIMIT 1", [shopId]);
  if (!shops.length) return res.status(404).json({ message: "Shop not found." });
  const [rows] = await pool.query(`${SELECT_SCHEME} WHERE shop_id=? AND status IN ('active','paused') ORDER BY starts_at DESC`, [shopId]);
  res.json(rows.map(mapScheme));
}

export async function createScheme(req, res) {
  const shopId = String(req.params.shopId || "");
  if (!(await ownerShop(req, shopId))) return res.status(404).json({ message: "Shop not found or not owned by this account." });
  const form = validateInput(req.body || {});
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await validateScope(connection, shopId, form);
    if (form.promoCode) {
      const [dupes] = await connection.query("SELECT id FROM schemes WHERE shop_id=? AND promo_code=? LIMIT 1", [shopId, form.promoCode]);
      if (dupes.length) throw Object.assign(new Error("That promo code is already used by this shop."), { status: 409 });
    }
    const id = crypto.randomUUID();
    await connection.query(
      `INSERT INTO schemes (id,shop_id,title,description,image_url,terms,discount_type,discount_value,starts_at,ends_at,
       all_services,service_ids_json,all_barbers,barber_ids_json,minimum_amount,maximum_discount,usage_limit,per_customer_limit,promo_code,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, shopId, form.title, form.description, form.imageUrl || null, form.terms || null, form.discountType, form.discountValue,
        form.startsAt, form.endsAt, form.allServices ? 1 : 0, JSON.stringify(form.serviceIds), form.allBarbers ? 1 : 0,
        JSON.stringify(form.barberIds), form.minimumAmount, form.maximumDiscount, form.usageLimit, form.perCustomerLimit, form.promoCode, form.status],
    );
    await connection.commit();
    const [rows] = await pool.query(`${SELECT_SCHEME} WHERE id=?`, [id]);
    res.status(201).json({ scheme: mapScheme(rows[0]) });
  } catch (error) {
    await connection.rollback().catch(() => {});
    res.status(error.status || (error.code === "ER_DUP_ENTRY" ? 409 : 500)).json({ message: error.message || "Could not save the offer." });
  } finally { connection.release(); }
}

export async function updateScheme(req, res) {
  const shopId = String(req.params.shopId || "");
  const schemeId = String(req.params.schemeId || "");
  if (!(await ownerShop(req, shopId))) return res.status(404).json({ message: "Shop not found or not owned by this account." });
  const form = validateInput(req.body || {});
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query("SELECT id FROM schemes WHERE id=? AND shop_id=? FOR UPDATE", [schemeId, shopId]);
    if (!existing.length) throw Object.assign(new Error("Offer not found."), { status: 404 });
    await validateScope(connection, shopId, form);
    if (form.promoCode) {
      const [dupes] = await connection.query("SELECT id FROM schemes WHERE shop_id=? AND promo_code=? AND id<>? LIMIT 1", [shopId, form.promoCode, schemeId]);
      if (dupes.length) throw Object.assign(new Error("That promo code is already used by this shop."), { status: 409 });
    }
    await connection.query(
      `UPDATE schemes SET title=?,description=?,image_url=?,terms=?,discount_type=?,discount_value=?,starts_at=?,ends_at=?,
       all_services=?,service_ids_json=?,all_barbers=?,barber_ids_json=?,minimum_amount=?,maximum_discount=?,usage_limit=?,per_customer_limit=?,promo_code=?,status=? WHERE id=? AND shop_id=?`,
      [form.title, form.description, form.imageUrl || null, form.terms || null, form.discountType, form.discountValue, form.startsAt,
        form.endsAt, form.allServices ? 1 : 0, JSON.stringify(form.serviceIds), form.allBarbers ? 1 : 0, JSON.stringify(form.barberIds),
        form.minimumAmount, form.maximumDiscount, form.usageLimit, form.perCustomerLimit, form.promoCode, form.status, schemeId, shopId],
    );
    await connection.commit();
    const [rows] = await pool.query(`${SELECT_SCHEME} WHERE id=?`, [schemeId]);
    res.json({ scheme: mapScheme(rows[0]) });
  } catch (error) {
    await connection.rollback().catch(() => {});
    res.status(error.status || (error.code === "ER_DUP_ENTRY" ? 409 : 500)).json({ message: error.message || "Could not update the offer." });
  } finally { connection.release(); }
}
