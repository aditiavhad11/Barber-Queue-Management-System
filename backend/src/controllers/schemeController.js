import crypto from "node:crypto";
import { pool } from "../config/db.js";
import { findBogoServiceOverlap } from "../utils/bogoOffer.js";
import { effectiveOfferStatus, hasActiveNewCustomerOfferReservation, hasSuccessfulCompletedBooking, NEW_CUSTOMER_RESERVATION_MINUTES } from "../utils/offerEligibility.js";
import { WEEKDAY_CODES } from "../utils/happyHour.js";

const parseIds = (value) => {
  if (Array.isArray(value)) return value.map(String);
  try { return JSON.parse(value || "[]").map(String); } catch { return []; }
};
const parseObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
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
    offerType: row.offer_type || "discount",
    buyQuantity: row.buy_quantity == null ? null : Number(row.buy_quantity),
    freeQuantity: row.free_quantity == null ? null : Number(row.free_quantity),
    requiredQuantities: parseObject(row.required_service_quantities_json),
    rewardServiceId: row.reward_service_id || "",
    rewardServiceIds: parseIds(row.reward_service_ids_json).length
      ? parseIds(row.reward_service_ids_json)
      : row.reward_service_id ? [String(row.reward_service_id)] : [],
    rewardSelectionEnabled: parseIds(row.reward_service_ids_json).length > 0,
    maxRewardCount: Number(row.max_reward_count || row.free_quantity || 1),
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
    newCustomerOnly: bool(row.new_customer_only),
    happyHourEnabled: row.happy_hour_start_time != null && row.happy_hour_end_time != null,
    happyHourStartTime: row.happy_hour_start_time || "",
    happyHourEndTime: row.happy_hour_end_time || "",
    happyHourDays: parseIds(row.happy_hour_days_json),
    status: effectiveOfferStatus({ status: row.status, startsAt: row.starts_at_utc, endsAt: row.ends_at_utc, serverNow: row.server_now_utc }),
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

function validateInput(body, partial = false, isNewOffer = false) {
  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  const discountType = String(body.discountType ?? "percentage");
  const offerType = String(body.offerType ?? "discount");
  const discountValue = Number(body.discountValue);
  const buyQuantity = body.buyQuantity == null || body.buyQuantity === "" ? null : Number(body.buyQuantity);
  const freeQuantity = body.freeQuantity == null || body.freeQuantity === "" ? null : Number(body.freeQuantity);
  const rewardServiceId = String(body.rewardServiceId ?? "");
  const rewardServiceIds = [...new Set((Array.isArray(body.rewardServiceIds) ? body.rewardServiceIds : rewardServiceId ? [rewardServiceId] : []).map(String))];
  const rewardSelectionEnabled = offerType === "bogo" && body.rewardSelectionEnabled !== false;
  const maxRewardCount = body.maxRewardCount == null || body.maxRewardCount === "" ? Number(body.freeQuantity || 1) : Number(body.maxRewardCount);
  const status = String(body.status ?? "draft");
  const promoCode = String(body.promoCode ?? "").trim().toUpperCase();
  const newCustomerOnly = body.newCustomerOnly === true || body.newCustomerOnly === 1 || body.newCustomerOnly === "1";
  const happyHourEnabled = body.happyHourEnabled === true || body.happyHourEnabled === 1 || body.happyHourEnabled === "1";
  const happyHourStartTime = String(body.happyHourStartTime || "").trim();
  const happyHourEndTime = String(body.happyHourEndTime || "").trim();
  const happyHourDays = [...new Set((Array.isArray(body.happyHourDays) ? body.happyHourDays : []).map(String))];
  const startsAt = body.startsAt ? new Date(body.startsAt) : null;
  const endsAt = body.endsAt ? new Date(body.endsAt) : null;
  const allServices = body.allServices !== false;
  const allBarbers = body.allBarbers !== false;
  const serviceIds = [...new Set((Array.isArray(body.serviceIds) ? body.serviceIds : []).map(String))];
  const requiredQuantities = body.requiredQuantities && typeof body.requiredQuantities === "object" ? body.requiredQuantities : {};
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
  if (!partial || body.offerType !== undefined || body.discountType !== undefined || body.discountValue !== undefined || body.buyQuantity !== undefined || body.freeQuantity !== undefined) {
    if (!["discount", "bogo"].includes(offerType)) throw invalid("Choose a valid offer type.");
    if (offerType === "bogo") {
      if (!Number.isInteger(freeQuantity) || freeQuantity < 1 || freeQuantity > 100) throw invalid("Legacy free quantity must be a whole number from 1 to 100.");
      if (!Number.isInteger(maxRewardCount) || maxRewardCount < 1 || maxRewardCount > 100) throw invalid("Maximum free rewards must be a whole number from 1 to 100.");
      if (!serviceIds.length || allServices || !rewardServiceIds.length) throw invalid("Choose the required paid services and at least one free reward service for this BOGO offer.");
      if (findBogoServiceOverlap(serviceIds, [...rewardServiceIds, ...(rewardServiceId ? [rewardServiceId] : [])])) throw invalid("A service cannot be configured as both a required paid service and a free reward.");
      if (Object.keys(requiredQuantities).length !== serviceIds.length || Object.keys(requiredQuantities).some((id) => !serviceIds.includes(String(id)))) throw invalid("Required service quantities must match the selected qualifying services.");
      if (serviceIds.some((id) => !Number.isInteger(Number(requiredQuantities[id])) || Number(requiredQuantities[id]) < 1 || Number(requiredQuantities[id]) > 20)) throw invalid("Set a required quantity from 1 to 20 for every qualifying service.");
    } else
    if (!["percentage", "fixed"].includes(discountType) || !Number.isFinite(discountValue) || discountValue <= 0 || (discountType === "percentage" && discountValue > 100))
      throw invalid("Enter a valid percentage (up to 100%) or fixed discount amount.");
  }
  if (!Number.isFinite(minimumAmount) || minimumAmount < 0 || (maximumDiscount !== null && (!Number.isFinite(maximumDiscount) || maximumDiscount < 0)))
    throw invalid("Minimum amount and maximum discount must be zero or greater.");
  for (const limit of [usageLimit, perCustomerLimit])
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw invalid("Usage limits must be positive whole numbers.");
  if (promoCode && !/^[A-Z0-9_-]{3,32}$/.test(promoCode)) throw invalid("Promo codes must be 3 to 32 letters, numbers, hyphens, or underscores.");
  if (happyHourEnabled) {
    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(happyHourStartTime) || !timePattern.test(happyHourEndTime)) throw invalid("Enter valid Happy-Hour start and end times.");
    if (happyHourStartTime === happyHourEndTime) throw invalid("Happy-Hour end time must differ from its start time.");
    if (happyHourDays.some((day) => !WEEKDAY_CODES.includes(day))) throw invalid("Select valid days for the Happy-Hour offer.");
  }
  if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) throw invalid("Enter valid offer start and end times.");
  if (startsAt && endsAt && startsAt >= endsAt) throw invalid("End date must be later than start date.");
  const now = new Date();
  now.setSeconds(0, 0);
  if (isNewOffer && startsAt && startsAt < now) throw invalid("Start date cannot be in the past for a new offer.");
  if (isNewOffer && endsAt && endsAt < now) throw invalid("End date cannot be in the past for a new offer.");
  if (status !== "draft" && (!startsAt || !endsAt || startsAt >= endsAt)) throw invalid("Active or paused offers need an end time later than their start time.");
  return {
    title, description, terms: String(body.terms ?? "").trim().slice(0, 4000),
    imageUrl: String(body.imageUrl ?? "").trim().slice(0, 1000),
    offerType, buyQuantity: offerType === "bogo" ? null : buyQuantity, freeQuantity, requiredQuantities, rewardServiceId: rewardServiceIds[0] || rewardServiceId, rewardServiceIds, rewardSelectionEnabled, maxRewardCount,
    discountType, discountValue: Number.isFinite(discountValue) ? discountValue : 0,
    startsAt: startsAt ? startsAt.toISOString().slice(0, 19).replace("T", " ") : null,
    endsAt: endsAt ? endsAt.toISOString().slice(0, 19).replace("T", " ") : null,
    allServices, serviceIds, allBarbers, barberIds, minimumAmount,
    maximumDiscount, usageLimit, perCustomerLimit, promoCode: promoCode || null, newCustomerOnly,
    happyHourEnabled, happyHourStartTime, happyHourEndTime, happyHourDays, status,
  };
}

async function validateScope(connection, shopId, form) {
  if (!form.allServices || form.offerType === "bogo") {
    if (!form.serviceIds.length) throw Object.assign(new Error("Select at least one service or choose all services."), { status: 400 });
    const [rows] = await connection.query(
      `SELECT id FROM services WHERE shop_id=? ${form.offerType === "bogo" ? "AND enabled=1 " : ""}AND id IN (${form.serviceIds.map(() => "?").join(",")})`,
      [shopId, ...form.serviceIds],
    );
    if (rows.length !== form.serviceIds.length) throw Object.assign(new Error("One or more services do not belong to this shop."), { status: 400 });
  }
  if (form.offerType === "bogo") {
    const [rewards] = await connection.query(`SELECT id FROM services WHERE shop_id=? AND enabled=1 AND id IN (${form.rewardServiceIds.map(() => "?").join(",")})`, [shopId, ...form.rewardServiceIds]);
    if (rewards.length !== form.rewardServiceIds.length) throw Object.assign(new Error("Every free reward must be an enabled service in this shop."), { status: 400 });
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
  DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%sZ') AS server_now_utc FROM schemes`;

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
  const [rows] = await pool.query(`${SELECT_SCHEME} WHERE shop_id=? AND status='active'
    AND starts_at<=UTC_TIMESTAMP() AND ends_at>=UTC_TIMESTAMP() ORDER BY starts_at DESC`, [shopId]);
  const [history] = await pool.query(
    `SELECT status,queue_status FROM payment_bookings
     WHERE customer_id=? AND status IN ('accepted','paid') AND queue_status='Completed' LIMIT 1`,
    [req.user.sub],
  );
  const hasCompletedBooking = hasSuccessfulCompletedBooking(history);
  let hasOfferReservation = false;
  if (!hasCompletedBooking) {
    const [reservations] = await pool.query(
      `SELECT status,queue_status FROM payment_bookings
       WHERE customer_id=? AND (
         (status='payment_submitted' AND created_at > (NOW() - INTERVAL ${NEW_CUSTOMER_RESERVATION_MINUTES} MINUTE))
         OR (status IN ('accepted','paid') AND COALESCE(queue_status,'') NOT IN ('Cancelled','No Show'))
       )
         AND scheme_id IN (SELECT id FROM schemes WHERE new_customer_only=1) LIMIT 1`,
      [req.user.sub],
    );
    hasOfferReservation = hasActiveNewCustomerOfferReservation(reservations);
  }
  const eligible = !hasCompletedBooking && !hasOfferReservation;
  res.json(rows.map(mapScheme).map((scheme) => ({
    ...scheme,
    customerEligible: !scheme.newCustomerOnly || eligible,
    eligibilityMessage: scheme.newCustomerOnly && hasCompletedBooking
      ? "This offer is only available before your first completed booking."
      : scheme.newCustomerOnly && hasOfferReservation
        ? "A pending booking already reserves a new-customer offer."
      : scheme.newCustomerOnly ? "Eligible: you have no completed bookings." : "",
  })));
}

export async function createScheme(req, res) {
  const shopId = String(req.params.shopId || "");
  if (!(await ownerShop(req, shopId))) return res.status(404).json({ message: "Shop not found or not owned by this account." });
  const form = validateInput(req.body || {}, false, true);
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
      `INSERT INTO schemes (id,shop_id,title,description,image_url,terms,offer_type,buy_quantity,free_quantity,required_service_quantities_json,reward_service_id,reward_service_ids_json,max_reward_count,discount_type,discount_value,starts_at,ends_at,
       all_services,service_ids_json,all_barbers,barber_ids_json,minimum_amount,maximum_discount,usage_limit,per_customer_limit,promo_code,new_customer_only,happy_hour_start_time,happy_hour_end_time,happy_hour_days_json,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, shopId, form.title, form.description, form.imageUrl || null, form.terms || null, form.offerType, form.buyQuantity, form.freeQuantity, JSON.stringify(form.requiredQuantities), form.rewardServiceId || null, form.rewardSelectionEnabled ? JSON.stringify(form.rewardServiceIds) : null, form.rewardSelectionEnabled ? form.maxRewardCount : null, form.discountType, form.discountValue,
        form.startsAt, form.endsAt, form.allServices ? 1 : 0, JSON.stringify(form.serviceIds), form.allBarbers ? 1 : 0,
        JSON.stringify(form.barberIds), form.minimumAmount, form.maximumDiscount, form.usageLimit, form.perCustomerLimit, form.promoCode, form.newCustomerOnly ? 1 : 0,
        form.happyHourEnabled ? `${form.happyHourStartTime}:00` : null, form.happyHourEnabled ? `${form.happyHourEndTime}:00` : null,
        form.happyHourEnabled && form.happyHourDays.length ? JSON.stringify(form.happyHourDays) : null, form.status],
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
      `UPDATE schemes SET title=?,description=?,image_url=?,terms=?,offer_type=?,buy_quantity=?,free_quantity=?,required_service_quantities_json=?,reward_service_id=?,reward_service_ids_json=?,max_reward_count=?,discount_type=?,discount_value=?,starts_at=?,ends_at=?,
       all_services=?,service_ids_json=?,all_barbers=?,barber_ids_json=?,minimum_amount=?,maximum_discount=?,usage_limit=?,per_customer_limit=?,promo_code=?,new_customer_only=?,happy_hour_start_time=?,happy_hour_end_time=?,happy_hour_days_json=?,status=? WHERE id=? AND shop_id=?`,
      [form.title, form.description, form.imageUrl || null, form.terms || null, form.offerType, form.buyQuantity, form.freeQuantity, JSON.stringify(form.requiredQuantities), form.rewardServiceId || null, form.rewardSelectionEnabled ? JSON.stringify(form.rewardServiceIds) : null, form.rewardSelectionEnabled ? form.maxRewardCount : null, form.discountType, form.discountValue, form.startsAt,
        form.endsAt, form.allServices ? 1 : 0, JSON.stringify(form.serviceIds), form.allBarbers ? 1 : 0, JSON.stringify(form.barberIds),
        form.minimumAmount, form.maximumDiscount, form.usageLimit, form.perCustomerLimit, form.promoCode, form.newCustomerOnly ? 1 : 0,
        form.happyHourEnabled ? `${form.happyHourStartTime}:00` : null, form.happyHourEnabled ? `${form.happyHourEndTime}:00` : null,
        form.happyHourEnabled && form.happyHourDays.length ? JSON.stringify(form.happyHourDays) : null, form.status, schemeId, shopId],
    );
    await connection.commit();
    const [rows] = await pool.query(`${SELECT_SCHEME} WHERE id=?`, [schemeId]);
    res.json({ scheme: mapScheme(rows[0]) });
  } catch (error) {
    await connection.rollback().catch(() => {});
    res.status(error.status || (error.code === "ER_DUP_ENTRY" ? 409 : 500)).json({ message: error.message || "Could not update the offer." });
  } finally { connection.release(); }
}
