import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { pool } from "../config/db.js";
import { enqueueEmergencyClosureNotifications } from "../jobs/emergencyClosureQueue.js";
import {
  isValidEmail,
  isValidPhone,
  isValidName,
  isValidShopName,
  isValidServiceName,
  isValidAge,
  isValidExperience,
  isValidPrice,
  isValidDuration,
  isValidTime,
  normalizePhone,
} from "../utils/validators.js";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const parseJson = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const IST_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const localDateKey = (date = new Date()) => {
  const parts = IST_DATE_FORMAT.formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
};

/** True only for a real calendar date in YYYY-MM-DD form. */
const isValidDateKey = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
};

const notOwned = (res) =>
  res
    .status(404)
    .json({ message: "Shop not found or not owned by this account." });

const toUtcDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
};

const dateAfter = (value) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const closurePeriod = (closure) => {
  const start = closure?.startAt || `${closure?.startDate || ""}T00:00:00+05:30`;
  const end =
    closure?.endAt ||
    (closure?.endDate
      ? `${dateAfter(closure.endDate)}T00:00:00+05:30`
      : null);
  return { start: toUtcDateTime(start), end: end ? toUtcDateTime(end) : null };
};

/** Validates the per-day weekly shifts in availability.schedule.
 *  Returns an error string or "" if valid.
 */
function validateShifts(availability = {}) {
  const schedule = availability?.schedule;
  if (!schedule || typeof schedule !== "object") return "";

  const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const TIME_RE = /^\d{2}:\d{2}$/;

  for (const day of ALL_DAYS) {
    const dayObj = schedule[day];
    if (!dayObj || dayObj.closed) continue;

    const shifts =
      Array.isArray(dayObj.shifts) && dayObj.shifts.length
        ? dayObj.shifts
        : [{ open: dayObj.open || "09:00", close: dayObj.close || "21:00" }];

    for (let i = 0; i < shifts.length; i++) {
      const s = shifts[i];
      const open = String(s.open || "").slice(0, 5);
      const close = String(s.close || "").slice(0, 5);

      if (!TIME_RE.test(open) || !TIME_RE.test(close)) {
        return `${day} Shift ${i + 1}: Enter valid times in HH:MM format.`;
      }
      if (close <= open) {
        return `${day} Shift ${i + 1}: Closing time must be after opening time.`;
      }
      // No overnight shifts
      if (close < open) {
        return `${day} Shift ${i + 1}: Overnight shifts (crossing midnight) are not supported.`;
      }
    }

    // Check overlaps
    for (let i = 0; i < shifts.length; i++) {
      for (let j = i + 1; j < shifts.length; j++) {
        const a = shifts[i];
        const b = shifts[j];
        if (a.open < b.close && b.open < a.close) {
          return `${day}: Shift ${i + 1} (${a.open}–${a.close}) overlaps with Shift ${j + 1} (${b.open}–${b.close}). Please select a different time.`;
        }
      }
    }
  }
  return "";
}

function validateAnnualSchedules(availability = {}) {
  const schedules =
    availability?.annualSchedules &&
    typeof availability.annualSchedules === "object"
      ? availability.annualSchedules
      : {};
  const today = localDateKey();
  for (const [date, item] of Object.entries(schedules)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return "Annual schedule dates must use YYYY-MM-DD.";
    }
    if (date < today) return "Past dates cannot be scheduled or modified.";
    if (!["closed", "half_day", "special_hours"].includes(item?.type)) {
      return "Choose Closed, Half Day, or Special Hours for each scheduled date.";
    }
    if (item.type !== "closed") {
      const open = String(item.open || "").slice(0, 5);
      const close = String(item.close || "").slice(0, 5);
      if (
        !/^\d{2}:\d{2}$/.test(open) ||
        !/^\d{2}:\d{2}$/.test(close) ||
        close <= open
      ) {
        return "Scheduled hours must have a valid opening time before closing time.";
      }
    }
  }
  return "";
}

/** Group rows into Map<key, row[]> keeping the original row order. */
const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
};

const mapCoOwner = (c) => ({
  id: c.id,
  shopId: c.shop_id,
  name: c.name,
  email: c.email,
  phone: c.phone || "",
  title: c.title || "Co-Owner",
  permissions: parseJson(c.permissions_json, {}),
  status: c.status || "active",
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});

const CO_OWNER_COLUMNS =
  "id, shop_id, name, email, phone, title, permissions_json, status, created_at, updated_at";
const BARBER_COLUMNS =
  "id,shop_id,name,gender,age,phone,email,experience_years,specialization,working_days_json,queue_limit,rating,status,photo_url";

/* ------------------------------------------------------------------ */
/* Access helpers                                                      */
/* ------------------------------------------------------------------ */

/** Owner-only access (owner_id match). */
async function ownsShop(req, shopId) {
  const [rows] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND owner_id=? LIMIT 1",
    [shopId, req.user.sub],
  );
  return rows.length > 0;
}

/** Owner OR the shop / co-owner login that belongs to this shop. */
async function canManageShop(req, shopId) {
  const isShopOrCoOwner =
    req.user.role === "shop" || req.user.role === "co_owner";
  const shopIdFromUser = req.user.shopId || req.user.sub;
  const [rows] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND (owner_id=? OR id=?) LIMIT 1",
    [shopId, req.user.sub, isShopOrCoOwner ? shopIdFromUser : "__no_shop__"],
  );
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Bulk insert                                                         */
/* ------------------------------------------------------------------ */

/**
 * - `sql` must end with `VALUES ?` (mysql2 expands the nested array).
 *   Works with `.query()` only, NOT `.execute()`.
 * - Rows are chunked so one payload never exceeds `max_allowed_packet`.
 */
const BULK_CHUNK_SIZE = 500;
async function bulkInsert(conn, sql, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += BULK_CHUNK_SIZE) {
    await conn.query(sql, [rows.slice(i, i + BULK_CHUNK_SIZE)]);
  }
}

const SHOP_PHOTO_INSERT =
  "INSERT INTO shop_photos(id,shop_id,url,is_primary) VALUES ?";
const SERVICE_INSERT =
  "INSERT INTO services(id,shop_id,name,price,duration_minutes,enabled) VALUES ?";
const BARBER_INSERT =
  "INSERT INTO barbers(id,shop_id,name,gender,age,phone,email,experience_years,specialization,working_days_json,queue_limit,status,photo_url) VALUES ?";
const BARBER_SERVICE_INSERT =
  "INSERT INTO barber_services(barber_id,service_id) VALUES ?";
const CO_OWNER_INSERT =
  "INSERT INTO shop_co_owners(id,shop_id,name,email,phone,title,password_hash,permissions_json,status) VALUES ?";

/**
 * Links a barber to services in one statement. Only services that belong to
 * `shopId` are linked; unknown / foreign ids and duplicates are skipped.
 */
async function linkBarberServices(conn, barberId, shopId, serviceIds) {
  if (!Array.isArray(serviceIds) || !serviceIds.length) return;
  await conn.query(
    "INSERT IGNORE INTO barber_services(barber_id,service_id) SELECT ?,id FROM services WHERE shop_id=? AND id IN (?)",
    [barberId, shopId, serviceIds],
  );
}

/* ------------------------------------------------------------------ */
/* Hydration (batched: ~6 queries total regardless of shop count)      */
/* ------------------------------------------------------------------ */

async function hydrateShops(shopRows) {
  if (!shopRows.length) return [];
  const shopIds = shopRows.map((r) => r.id);

  const [[photoRows], [serviceRows], [barberRows], coOwnerRows, reviewRows] =
    await Promise.all([
      pool.query(
        "SELECT id,shop_id,url,is_primary FROM shop_photos WHERE shop_id IN (?) ORDER BY is_primary DESC, created_at ASC",
        [shopIds],
      ),
      pool.query(
        "SELECT id,shop_id,name,price,duration_minutes,enabled FROM services WHERE shop_id IN (?) ORDER BY id ASC",
        [shopIds],
      ),
      pool.query(
        `SELECT ${BARBER_COLUMNS} FROM barbers WHERE shop_id IN (?) ORDER BY id ASC`,
        [shopIds],
      ),
      pool
        .query(
          `SELECT ${CO_OWNER_COLUMNS} FROM shop_co_owners WHERE shop_id IN (?) ORDER BY created_at ASC`,
          [shopIds],
        )
        .then(([rows]) => rows)
        .catch((error) => {
          if (error.code === "ER_NO_SUCH_TABLE") return [];
          throw error;
        }),
      pool
        .query(
          "SELECT r.id,r.shop_id,r.queue_id,r.customer_id,r.rating,r.text,r.created_at,u.name AS customer_name FROM booking_reviews r JOIN users u ON u.id=r.customer_id WHERE r.shop_id IN (?) ORDER BY r.created_at DESC",
          [shopIds],
        )
        .then(([rows]) => rows)
        // table is created on server start; ignore if it is not there yet
        .catch(() => []),
    ]);

  // barber -> services mapping
  const servicesByBarber = new Map();
  if (barberRows.length) {
    const [mapRows] = await pool.query(
      "SELECT barber_id,service_id FROM barber_services WHERE barber_id IN (?)",
      [barberRows.map((b) => b.id)],
    );
    for (const m of mapRows) {
      const list = servicesByBarber.get(m.barber_id);
      if (list) list.push(m.service_id);
      else servicesByBarber.set(m.barber_id, [m.service_id]);
    }
  }

  const photosByShop = groupBy(photoRows, "shop_id");
  const servicesByShop = groupBy(serviceRows, "shop_id");
  const barbersByShop = groupBy(barberRows, "shop_id");
  const coOwnersByShop = groupBy(coOwnerRows, "shop_id");
  const reviewsByShop = groupBy(reviewRows, "shop_id");

  return shopRows.map((row) => ({
    ...row,
    reviewsList: (reviewsByShop.get(row.id) || []).map((r) => ({
      id: r.id,
      queueId: r.queue_id,
      customerId: r.customer_id,
      customer: r.customer_name,
      rating: Number(r.rating),
      text: r.text,
      date: new Date(r.created_at).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      shopId: row.id,
    })),
    coOwners: (coOwnersByShop.get(row.id) || []).map(mapCoOwner),
    ownerId: row.owner_id,
    loginEmail: row.login_email,
    rejection: row.rejection_reason || "",
    hours: {
      open: String(row.hours_open || "09:00").slice(0, 5),
      close: String(row.hours_close || "21:00").slice(0, 5),
    },
    location:
      row.latitude == null
        ? null
        : {
            lat: Number(row.latitude),
            lng: Number(row.longitude),
            confirmed: true,
          },
    availability: (() => {
      const availability = parseJson(row.availability_json);
      const end = availability.temporaryClosure?.endAt;
      if (
        availability.emergencyClosed &&
        end &&
        new Date(end) <= new Date()
      ) {
        availability.isOpen = true;
      }
      return availability;
    })(),
    policy: parseJson(row.policies_json),
    upiQrUrl: row.upi_qr_url || "",
    photos: (photosByShop.get(row.id) || []).map((p) => ({
      id: p.id,
      url: p.url,
      primary: Boolean(p.is_primary),
    })),
    services: (servicesByShop.get(row.id) || []).map((x) => ({
      id: x.id,
      shopId: row.id,
      name: x.name,
      price: Number(x.price),
      duration: Number(x.duration_minutes),
      enabled: Boolean(x.enabled),
    })),
    barbers: (barbersByShop.get(row.id) || []).map((b) => ({
      id: b.id,
      shopId: row.id,
      name: b.name,
      gender: b.gender || "",
      age: b.age != null ? Number(b.age) : null,
      phone: b.phone || "",
      email: b.email || "",
      experience: b.experience_years || 0,
      specialization: b.specialization || "",
      workingDays: parseJson(b.working_days_json, null),
      queueLimit: Number(b.queue_limit || 10),
      rating: Number(b.rating),
      status: b.status,
      photo: b.photo_url || "",
      services: servicesByBarber.get(b.id) || [],
    })),
  }));
}

const hydrateShop = async (row) => (await hydrateShops([row]))[0];

/* ------------------------------------------------------------------ */
/* Shops                                                               */
/* ------------------------------------------------------------------ */

export async function listApproved(_req, res) {
  const [rows] = await pool.query(
    "SELECT * FROM shops WHERE status='approved' AND active=1 ORDER BY created_at DESC",
  );
  res.json(await hydrateShops(rows));
}

export async function listMine(req, res) {
  const [rows] = await pool.query(
    "SELECT * FROM shops WHERE owner_id=? ORDER BY created_at DESC",
    [req.user.sub],
  );
  res.json(await hydrateShops(rows));
}

export async function listAdmin(_req, res) {
  const [rows] = await pool.query(
    "SELECT * FROM shops ORDER BY created_at DESC",
  );
  res.json(await hydrateShops(rows));
}

export async function createShop(req, res) {
  const b = req.body;
  if (!b.name?.trim() || !b.contact?.trim() || !b.address?.trim())
    return res
      .status(400)
      .json({ message: "Shop name, contact and address are required." });

  if (!isValidShopName(b.name))
    return res
      .status(400)
      .json({ message: "Enter a valid shop name (2 to 100 characters)." });

  if (!isValidPhone(b.contact))
    return res
      .status(400)
      .json({ message: "Enter a valid 10-digit Indian contact number." });

  if (b.hours?.open && !isValidTime(b.hours.open))
    return res.status(400).json({ message: "Invalid opening time format (HH:MM)." });

  if (b.hours?.close && !isValidTime(b.hours.close))
    return res.status(400).json({ message: "Invalid closing time format (HH:MM)." });

  const annualError = validateAnnualSchedules(b.availability || {});

  if (annualError) return res.status(400).json({ message: annualError });

  const shiftError = validateShifts(b.availability || {});

  if (shiftError) return res.status(400).json({ message: shiftError });
  if (
    !Array.isArray(b.barbers) ||
    !b.barbers.length ||
    b.barbers.some(
      (barber) =>
        !Number.isInteger(Number(barber?.queueLimit)) ||
        Number(barber.queueLimit) <= 0,
    )
  )
    return res.status(400).json({
      message: "Queue capacity must be a positive whole number for every barber.",
    });

  const id = crypto.randomUUID();

  // Legacy schema keeps these columns NOT NULL; credentials are generated
  // internally and are not shown to owners.

  const internalLoginEmail = `shop-${id}@internal.invalid`;

  // Co-owners to create (hash passwords up-front, in parallel, so the
  // transaction does not stay open while bcrypt runs).
  const coOwners = Array.isArray(b.coOwners)
    ? b.coOwners
    : b.coOwner
      ? [b.coOwner]
      : [];

  const [hash, coOwnerRows] = await Promise.all([
    bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12),
    Promise.all(
      coOwners
        .filter((co) => co?.name?.trim() && co?.email?.trim())
        .map(async (co) => [
          crypto.randomUUID(),
          id,
          String(co.name).trim(),
          String(co.email).trim().toLowerCase(),
          String(co.phone || "").trim(),
          String(co.title || "Co-Owner").trim(),
          await bcrypt.hash(String(co.password || "barber1234"), 10),
          JSON.stringify(co.permissions || {}),
          co.status || "active",
        ]),
    ),
  ]);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO shops(id,owner_id,name,description,contact,address,latitude,longitude,hours_open,hours_close,availability_json,policies_json,status,active,login_email,login_password_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        req.user.sub,
        b.name.trim(),
        b.description || "",
        b.contact.trim(),
        b.address.trim(),
        b.location?.lat ?? null,
        b.location?.lng ?? null,
        b.hours?.open || "09:00",
        b.hours?.close || "21:00",
        JSON.stringify(b.availability || {}),
        JSON.stringify(b.policy || {}),
        "pending",
        0,
        internalLoginEmail,
        hash,
      ],
    );

    // ---- photos ----
    const photoRows = (b.photos || [])
      .filter((photo) => photo?.url)
      .map((photo) => [
        crypto.randomUUID(),
        id,
        photo.url,
        photo.primary ? 1 : 0,
      ]);
    await bulkInsert(connection, SHOP_PHOTO_INSERT, photoRows);

    // ---- services ----
    const services = (b.services || []).filter(
      (x) => x?.name && Number(x.price) > 0 && Number(x.duration) > 0,
    );

    const serviceIds = [];
    const serviceIdMap = new Map();
    const serviceRows = services.map((service) => {
      const sid = crypto.randomUUID();
      serviceIds.push(sid);
      if (service.id) serviceIdMap.set(String(service.id), sid);
      return [
        sid,
        id,
        service.name.trim(),
        Number(service.price),
        Number(service.duration),
        1,
      ];
    });
    await bulkInsert(connection, SERVICE_INSERT, serviceRows);

    // ---- barbers + barber_services ----
    const barberCount = Math.max(1, Number(b.barberCount || b.barbers || 1));

    const barbers = Array.isArray(b.barbers)
      ? b.barbers
      : Array.from({ length: barberCount }, (_, i) => ({
          name: `Barber ${i + 1}`,
          services: serviceIds,
        }));

    const barberRows = [];
    const barberServiceRows = [];
    barbers.forEach((rawBarber, i) => {
      const barber = rawBarber || {};
      const bid = crypto.randomUUID();
      barberRows.push([
        bid,
        id,
        barber.name?.trim() || `Barber ${i + 1}`,
        String(barber.gender || "Prefer not to say"),
        barber.age != null && barber.age !== ""
          ? Math.max(0, Number(barber.age))
          : null,
        barber.phone
          ? String(barber.phone).replace(/\D/g, "").slice(0, 20)
          : null,
        barber.email ? String(barber.email).trim().toLowerCase() : null,
        Math.max(0, Number(barber.experience) || 0),
        String(barber.specialization || ""),
        barber.workingDays ? JSON.stringify(barber.workingDays) : null,
        Number(barber.queueLimit),
        barber.status || "Available",
        barber.photo || null,
      ]);

      const requestedServices = Array.isArray(barber.services)
        ? barber.services
        : [];
      const mapped = requestedServices
        .map((sid) => serviceIdMap.get(String(sid)))
        .filter(Boolean);
      const idsToUse = mapped.length ? mapped : serviceIds;
      for (const sid of idsToUse) barberServiceRows.push([bid, sid]);
    });

    // barbers first, then mappings (FK order)
    await bulkInsert(connection, BARBER_INSERT, barberRows);
    await bulkInsert(connection, BARBER_SERVICE_INSERT, barberServiceRows);

    // ---- co-owners ----
    await bulkInsert(connection, CO_OWNER_INSERT, coOwnerRows);

    await connection.commit();

    const [rows] = await pool.query("SELECT * FROM shops WHERE id=?", [id]);
    res.status(201).json(await hydrateShop(rows[0]));
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "This shop login email is already in use." });

    throw error;
  } finally {
    connection.release();
  }
}

export async function updateShop(req, res) {
  const b = req.body || {};
  const shopId = req.params.id;

  if (!(await ownsShop(req, shopId))) return notOwned(res);

  const [[currentShop]] = await pool.query(
    "SELECT availability_json FROM shops WHERE id=? AND owner_id=? LIMIT 1",
    [shopId, req.user.sub],
  );
  const currentAvailability = parseJson(
    currentShop?.availability_json,
    {},
  );
  let nextAvailability =
    b.availability !== undefined ? b.availability || {} : currentAvailability;
  const previousClosure = currentAvailability.temporaryClosure;
  const nextClosure = nextAvailability.temporaryClosure;
  let closureId = nextClosure?.id || null;
  const period = closurePeriod(nextClosure);
  if (nextClosure?.active) {
    if (!period.start || !period.end || new Date(period.end) <= new Date(period.start)) {
      return res.status(400).json({
        message: "Closure start and reopening time must be valid, and reopening must be after the start.",
      });
    }
    const [duplicates] = await pool.query(
      `SELECT id, closure_type, start_at, end_at, reason FROM emergency_closures
       WHERE shop_id=? AND start_at=? AND end_at=? AND status='active' LIMIT 1`,
      [shopId, period.start, period.end],
    );
    if (duplicates.length && duplicates[0].id !== closureId) {
      return res.status(409).json({ message: "An identical emergency closure is already active." });
    }
    closureId ||= crypto.randomUUID();
    nextAvailability.temporaryClosure = { ...nextClosure, id: closureId };
  }
  const closureStarted =
    nextClosure?.active &&
    new Date(period.start) <= new Date() &&
    !(previousClosure?.active && previousClosure.id === closureId);
  const closureEnded =
    previousClosure?.active && (!nextClosure || nextClosure.active !== true);
  let closureBookingIds = [];
  if (b.isOpen !== undefined) {
    nextAvailability = {
      ...nextAvailability,
      isOpen: Boolean(b.isOpen),
    };
  }
  if (closureStarted) {
    nextAvailability = {
      ...nextAvailability,
      isOpen: false,
      emergencyClosed: true,
    };
  } else if (closureEnded) {
    nextAvailability = {
      ...nextAvailability,
      isOpen: true,
      emergencyClosed: false,
    };
  } else if (nextClosure?.active) {
    nextAvailability = {
      ...nextAvailability,
      isOpen: currentAvailability.isOpen !== false,
    };
  }

  const fields = [];
  const values = [];
  const add = (column, value) => {
    fields.push(`${column}=?`);
    values.push(value);
  };

  if (b.name !== undefined) {
    if (!isValidShopName(b.name)) {
      return res.status(400).json({ message: "Enter a valid shop name (2 to 100 characters)." });
    }
    add("name", String(b.name).trim());
  }
  if (b.description !== undefined)
    add("description", String(b.description || ""));
  if (b.contact !== undefined) {
    if (!isValidPhone(b.contact)) {
      return res.status(400).json({ message: "Enter a valid 10-digit Indian contact number." });
    }
    add("contact", normalizePhone(b.contact));
  }
  if (b.address !== undefined) add("address", String(b.address).trim());

  if (b.location !== undefined) {
    add("latitude", b.location?.lat ?? null);
    add("longitude", b.location?.lng ?? null);
  }

  if (b.hours !== undefined) {
    if (b.hours?.open && !isValidTime(b.hours.open))
      return res.status(400).json({ message: "Invalid opening time format (HH:MM)." });
    if (b.hours?.close && !isValidTime(b.hours.close))
      return res.status(400).json({ message: "Invalid closing time format (HH:MM)." });
    add("hours_open", b.hours?.open || "09:00");
    add("hours_close", b.hours?.close || "21:00");
  }

  if (b.availability !== undefined) {
    const annualError = validateAnnualSchedules(b.availability || {});
    if (annualError) return res.status(400).json({ message: annualError });
    const shiftError = validateShifts(b.availability || {});
    if (shiftError) return res.status(400).json({ message: shiftError });
    add("availability_json", JSON.stringify(nextAvailability));
  }

  if (b.isOpen !== undefined && b.availability === undefined) {
    add(
      "availability_json",
      JSON.stringify({ ...currentAvailability, isOpen: Boolean(b.isOpen) }),
    );
  }

  if (b.policy !== undefined)
    add("policies_json", JSON.stringify(b.policy || {}));

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (nextClosure?.active) {
      await connection.query(
        `INSERT INTO emergency_closures
           (id, shop_id, closure_type, start_at, end_at, reason, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
         ON DUPLICATE KEY UPDATE reason=VALUES(reason), end_at=VALUES(end_at)`,
        [
          closureId,
          shopId,
          nextClosure.type === "hours" ? "hours" : "days",
          period.start,
          period.end,
          String(nextClosure.reason || "").trim() || null,
          req.user.sub,
        ],
      );
    }

    if (fields.length) {
      await connection.query(
        `UPDATE shops SET ${fields.join(", ")} WHERE id=? AND owner_id=?`,
        [...values, shopId, req.user.sub],
      );
    }

    if (Array.isArray(b.photos)) {
      await connection.query("DELETE FROM shop_photos WHERE shop_id=?", [
        shopId,
      ]);
      const photoRows = b.photos
        .filter((photo) => photo?.url)
        .map((photo) => [
          crypto.randomUUID(),
          shopId,
          photo.url,
          photo.primary ? 1 : 0,
        ]);
      await bulkInsert(connection, SHOP_PHOTO_INSERT, photoRows);
    }

    if (closureStarted) {
      console.info("[emergency-closure] marking active bookings", {
        shopId,
        startDate: nextClosure.startDate,
        endDate: nextClosure.endDate || null,
      });
      const startDate = nextClosure.startDate || localDateKey(new Date(period.start));
      const endDate = nextClosure.endDate || localDateKey(new Date(period.end));
      const [affectedBookings] = await connection.query(
        `SELECT id, customer_id, token
         FROM payment_bookings
         WHERE shop_id=? AND status='accepted'
           AND (
             queue_status IN ('Waiting','Your Turn','In Service','Prebooked')
             OR (booking_date BETWEEN ? AND ?)
           )
           AND (booking_date IS NULL OR booking_date BETWEEN ? AND ?)
         FOR UPDATE`,
        [shopId, startDate, endDate, startDate, endDate],
      );
      closureBookingIds = affectedBookings.map((booking) => booking.id);
      await connection.query(
        `UPDATE payment_bookings
         SET queue_status='Emergency Closed', closure_choice=NULL
         WHERE shop_id=? AND status='accepted'
           AND (
             queue_status IN ('Waiting','Your Turn','In Service','Prebooked')
             OR (booking_date BETWEEN ? AND ?)
           )
           AND (booking_date IS NULL OR booking_date BETWEEN ? AND ?)`,
        [shopId, startDate, endDate, startDate, endDate],
      );
      if (affectedBookings.length) {
        const notificationValues = affectedBookings.flatMap((booking) => [
          booking.customer_id,
          shopId,
          "alert",
          `Your turn (token #${booking.token}) was cancelled because the shop closed due to an emergency. You can wait for reopening or request a refund from your queue.`,
          booking.id,
        ]);
        await connection.query(
          `INSERT INTO notifications
             (id, user_id, shop_id, tone, text, ref_id)
           VALUES ${affectedBookings.map(() => "(UUID(), ?, ?, ?, ?, ?)").join(", ")}`,
          notificationValues,
        );
        if (closureBookingIds.length) {
          await connection.query(
            `INSERT IGNORE INTO emergency_closure_notifications (closure_id, booking_id)
             VALUES ${closureBookingIds.map(() => "(?, ?)").join(", ")}`,
            closureBookingIds.flatMap((bookingId) => [closureId, bookingId]),
          );
        }
      }
      await connection.query(
        `INSERT INTO audit_logs
           (actor_id, action, entity_type, entity_id, metadata_json)
         VALUES (?, 'emergency_closure_started', 'shop', ?, ?)`,
        [
          req.user.sub,
          shopId,
          JSON.stringify({
            startDate: nextClosure.startDate,
            endDate: nextClosure.endDate || null,
            reason: nextClosure.reason || "",
            bookingsCancelled: affectedBookings.length,
          }),
        ],
      );
      console.info("[emergency-closure] bookings marked and customers notified", {
        shopId,
        bookingsCancelled: affectedBookings.length,
      });
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [rows] = await pool.query("SELECT * FROM shops WHERE id=? LIMIT 1", [
    shopId,
  ]);
  if (closureStarted) {
    try {
      if (closureBookingIds.length) {
        const job = await enqueueEmergencyClosureNotifications(shopId, {
          ...nextClosure,
          id: closureId,
          bookingIds: closureBookingIds,
          startAt: period.start,
          endAt: period.end,
        });
        console.info("[emergency-closure] email job queued", {
          shopId,
          jobId: job.id,
          bookingsQueued: closureBookingIds.length,
        });
      } else {
        console.info("[emergency-closure] no active bookings required email", {
          shopId,
        });
      }
      if (closureEnded && previousClosure?.id) {
        await pool.query(
          "UPDATE emergency_closures SET status='ended', ended_at=NOW() WHERE id=? AND shop_id=? AND status='active'",
          [previousClosure.id, shopId],
        );
      }
    } catch (error) {
      console.error(
        "[emergency-closure] could not queue asynchronous emails:",
        error.message,
      );
    }
  }
  res.json(await hydrateShop(rows[0]));
}

export async function listEmergencyClosures(req, res) {
  if (!(await ownsShop(req, req.params.id))) return notOwned(res);
  const [rows] = await pool.query(
    `SELECT id, closure_type AS type, start_at AS startAt, end_at AS endAt,
            reason, status, created_at AS createdAt, ended_at AS endedAt
     FROM emergency_closures
     WHERE shop_id=?
     ORDER BY start_at DESC LIMIT 100`,
    [req.params.id],
  );
  res.json(rows);
}

export async function endEmergencyClosure(req, res) {
  if (!(await ownsShop(req, req.params.id))) return notOwned(res);
  const [result] = await pool.query(
    "UPDATE emergency_closures SET status='ended', ended_at=NOW() WHERE id=? AND shop_id=? AND status='active'",
    [req.params.closureId, req.params.id],
  );
  if (!result.affectedRows)
    return res.status(404).json({ message: "Active emergency closure not found." });
  const [[other]] = await pool.query(
    `SELECT id FROM emergency_closures
     WHERE shop_id=? AND status='active' AND id<>?
       AND start_at<=NOW() AND (end_at IS NULL OR end_at>NOW())
     LIMIT 1`,
    [req.params.id, req.params.closureId],
  );
  const [[shopRow]] = await pool.query(
    "SELECT availability_json FROM shops WHERE id=? AND owner_id=? LIMIT 1",
    [req.params.id, req.user.sub],
  );
  const availability = parseJson(shopRow?.availability_json, {});
  availability.temporaryClosure = other
    ? {
        id: other.id,
        active: true,
        type: other.closure_type,
        startAt: new Date(other.start_at).toISOString(),
        endAt: other.end_at ? new Date(other.end_at).toISOString() : null,
        reason: other.reason || "",
      }
    : null;
  availability.isOpen = Boolean(!other);
  availability.emergencyClosed = Boolean(other);
  await pool.query(
    "UPDATE shops SET availability_json=? WHERE id=? AND owner_id=?",
    [JSON.stringify(availability), req.params.id, req.user.sub],
  );
  res.json({ ok: true });
}

export async function updateStatus(req, res) {
  const allowed = ["approved", "rejected", "suspended", "reactivated"];
  if (!allowed.includes(req.body.status))
    return res.status(400).json({ message: "Invalid shop status." });
  const status =
    req.body.status === "reactivated" ? "approved" : req.body.status;
  if (status === "rejected" && !String(req.body.rejection || "").trim())
    return res.status(400).json({ message: "A rejection reason is required." });
  await pool.query(
    "UPDATE shops SET status=?,active=?,rejection_reason=? WHERE id=?",
    [
      status,
      status === "approved" ? 1 : 0,
      status === "rejected" ? String(req.body.rejection).trim() : null,
      req.params.id,
    ],
  );
  res.json({ ok: true, status });
}

export async function resubmit(req, res) {
  await pool.query(
    "UPDATE shops SET status='pending',active=0,rejection_reason=NULL WHERE id=? AND owner_id=?",
    [req.params.id, req.user.sub],
  );
  res.json({ ok: true, status: "pending" });
}

export async function deleteShop(req, res) {
  const [result] = await pool.query(
    "DELETE FROM shops WHERE id=? AND owner_id=?",
    [req.params.id, req.user.sub],
  );
  if (!result.affectedRows) return notOwned(res);
  res.json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

export async function createService(req, res) {
  const { id: shopId } = req.params;
  if (!(await canManageShop(req, shopId))) return notOwned(res);

  const name = String(req.body?.name || "").trim();
  const price = req.body?.price;
  const duration = req.body?.duration;

  if (!name || !isValidServiceName(name)) {
    return res.status(400).json({
      message: "Enter a valid service name (2 to 80 characters).",
    });
  }
  if (!isValidPrice(price)) {
    return res.status(400).json({
      message: "Price must be a valid positive number.",
    });
  }
  if (!isValidDuration(duration)) {
    return res.status(400).json({
      message: "Duration must be a positive integer in minutes.",
    });
  }

  const [existing] = await pool.query(
    "SELECT id,name,price,duration_minutes,enabled FROM services WHERE shop_id=? AND LOWER(name)=LOWER(?) LIMIT 1",
    [shopId, name],
  );
  if (existing.length) {
    const e = existing[0];
    return res.json({
      existing: true,
      service: {
        id: e.id,
        shopId,
        name: e.name,
        price: Number(e.price),
        duration: Number(e.duration_minutes),
        enabled: Boolean(e.enabled),
      },
    });
  }

  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO services(id,shop_id,name,price,duration_minutes,enabled) VALUES (?,?,?,?,?,1)",
    [id, shopId, name, price, duration],
  );

  res.status(201).json({
    existing: false,
    service: { id, shopId, name, price, duration, enabled: true },
  });
}

/* ------------------------------------------------------------------ */
/* Service unavailability                                              */
/* ------------------------------------------------------------------ */

// Date-specific restrictions are scoped to a service in the requested shop.
async function ownedService(req) {
  const { id: shopId, serviceId } = req.params;
  const isShopLogin = ["shop", "co_owner"].includes(req.user.role);
  const userShopId = req.user.shopId || req.user.sub;
  const [rows] = await pool.query(
    `SELECT s.id FROM services s JOIN shops sh ON sh.id=s.shop_id
     WHERE s.id=? AND s.shop_id=? AND (sh.owner_id=? OR sh.id=?) LIMIT 1`,
    [serviceId, shopId, req.user.sub, isShopLogin ? userShopId : "__no_shop__"],
  );
  return rows.length > 0;
}

const serviceNotFound = (res) =>
  res.status(404).json({ message: "Service not found for this shop." });

export async function listServiceUnavailability(req, res) {
  if (!(await ownedService(req))) return serviceNotFound(res);
  const [rows] = await pool.query(
    "SELECT id, DATE_FORMAT(unavailable_date, '%Y-%m-%d') AS date, reason FROM service_unavailability WHERE shop_id=? AND service_id=? ORDER BY unavailable_date ASC",
    [req.params.id, req.params.serviceId],
  );
  res.json(
    rows.map((row) => ({
      id: row.id,
      date: row.date,
      reason: row.reason || "",
    })),
  );
}

export async function listPublicServiceUnavailability(req, res) {
  const date = String(req.query?.date || "");
  if (!isValidDateKey(date))
    return res.status(400).json({ message: "Enter a valid booking date." });

  let rows;
  try {
    [rows] = await pool.query(
      `SELECT u.service_id, s.name, u.unavailable_date, u.reason
       FROM service_unavailability u
       JOIN services s ON s.id=u.service_id
       JOIN shops sh ON sh.id=u.shop_id AND sh.status='approved' AND sh.active=1
       WHERE u.shop_id=? AND u.unavailable_date=? AND s.enabled=1`,
      [req.params.id, date],
    );
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE")
      return res.status(503).json({
        message: "Service availability could not be checked right now.",
      });
    throw error;
  }

  res.json(
    rows.map((row) => ({
      serviceId: row.service_id,
      serviceName: row.name,
      date,
      reason: row.reason || "",
    })),
  );
}

export async function saveServiceUnavailability(req, res) {
  if (!(await ownedService(req))) return serviceNotFound(res);

  const date = String(req.body?.date || "");
  const reason =
    String(req.body?.reason || "")
      .trim()
      .slice(0, 255) || null;
  if (!isValidDateKey(date))
    return res.status(400).json({ message: "Enter a valid unavailable date." });

  try {
    await pool.query(
      `INSERT INTO service_unavailability (id, shop_id, service_id, unavailable_date, reason)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason=VALUES(reason)`,
      [crypto.randomUUID(), req.params.id, req.params.serviceId, date, reason],
    );
    const [rows] = await pool.query(
      "SELECT id, DATE_FORMAT(unavailable_date, '%Y-%m-%d') AS date, reason FROM service_unavailability WHERE shop_id=? AND service_id=? AND unavailable_date=? LIMIT 1",
      [req.params.id, req.params.serviceId, date],
    );
    res.json({
      restriction: {
        id: rows[0].id,
        date: rows[0].date,
        reason: rows[0].reason || "",
      },
      message: "Availability restriction saved.",
    });
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE")
      return res
        .status(503)
        .json({ message: "Availability migration must be applied first." });
    throw error;
  }
}

export async function removeServiceUnavailability(req, res) {
  if (!(await ownedService(req))) return serviceNotFound(res);
  const [result] = await pool.query(
    "DELETE FROM service_unavailability WHERE id=? AND shop_id=? AND service_id=?",
    [req.params.restrictionId, req.params.id, req.params.serviceId],
  );
  if (!result.affectedRows)
    return res
      .status(404)
      .json({ message: "Availability restriction not found." });
  res.json({ message: "Availability restriction removed." });
}

/* ------------------------------------------------------------------ */
/* Barbers                                                             */
/* ------------------------------------------------------------------ */

const BARBER_STATUSES = ["Available", "On Break", "Unavailable"];

export async function createBarber(req, res) {
  const { id: shopId } = req.params;
  if (!(await canManageShop(req, shopId))) return notOwned(res);

  const b = req.body || {};
  if (!String(b.name || "").trim() || !isValidName(b.name))
    return res
      .status(400)
      .json({ message: "Enter a valid barber name (2 to 60 alphabetic characters)." });

  // Phone validation with regex
  if (b.phone) {
    if (!isValidPhone(b.phone))
      return res
        .status(400)
        .json({ message: "Phone number must be a valid 10-digit mobile number." });
  }
  // Email validation with regex
  if (b.email) {
    if (!isValidEmail(b.email))
      return res
        .status(400)
        .json({ message: "Enter a valid email address." });
  }
  // Age validation with regex
  if (b.age !== undefined && b.age !== null && b.age !== "") {
    if (!isValidAge(b.age))
      return res
        .status(400)
        .json({ message: "Age must be between 18 and 70." });
  }
  // Experience validation with regex
  if (b.experience !== undefined && b.experience !== null && b.experience !== "") {
    if (!isValidExperience(b.experience))
      return res
        .status(400)
        .json({ message: "Experience must be between 0 and 60 years." });
  }

  const id = crypto.randomUUID();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO barbers(id,shop_id,name,gender,age,phone,email,experience_years,specialization,working_days_json,queue_limit,status,photo_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        shopId,
        String(b.name).trim(),
        String(b.gender || "Prefer not to say"),
        b.age !== undefined && b.age !== null && b.age !== ""
          ? Math.max(0, Number(b.age))
          : null,
        b.phone ? normalizePhone(b.phone) : null,
        b.email ? String(b.email).trim().toLowerCase() : null,
        Math.max(0, Number(b.experience) || 0),
        String(b.specialization || ""),
        b.workingDays ? JSON.stringify(b.workingDays) : null,
        Number.isInteger(Number(b.queueLimit)) && Number(b.queueLimit) > 0
          ? Number(b.queueLimit)
          : 10,
        BARBER_STATUSES.includes(b.status) ? b.status : "Available",
        b.photo ? String(b.photo) : null,
      ],
    );
    await linkBarberServices(
      connection,
      id,
      shopId,
      Array.isArray(b.services) ? b.services : [],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [rows] = await pool.query(
    `SELECT ${BARBER_COLUMNS} FROM barbers WHERE id=?`,
    [id],
  );
  const row = rows[0];
  res.status(201).json({
    barber: {
      id: row.id,
      shopId: row.shop_id,
      name: row.name,
      gender: row.gender || "",
      age: row.age != null ? Number(row.age) : null,
      phone: row.phone || "",
      email: row.email || "",
      experience: row.experience_years || 0,
      specialization: row.specialization || "",
      workingDays: parseJson(row.working_days_json, null),
      queueLimit: Number(row.queue_limit || 10),
      rating: Number(row.rating),
      status: row.status,
      photo: row.photo_url || "",
    },
  });
}

export async function updateBarber(req, res) {
  const { id: shopId, barberId } = req.params;
  if (!(await canManageShop(req, shopId))) return notOwned(res);

  const fields = [];
  const values = [];
  const add = (k, v) => {
    fields.push(`${k}=?`);
    values.push(v);
  };
  const b = req.body || {};

  // Name validation
  if (b.name !== undefined) {
    if (!String(b.name).trim() || !isValidName(b.name))
      return res
        .status(400)
        .json({ message: "Enter a valid barber name (2 to 60 alphabetic characters)." });
    add("name", String(b.name).trim());
  }
  // Phone validation
  if (b.phone !== undefined && b.phone !== null && b.phone !== "") {
    if (!isValidPhone(b.phone))
      return res
        .status(400)
        .json({ message: "Phone number must be a valid 10-digit mobile number." });
    add("phone", normalizePhone(b.phone));
  } else if (b.phone === null || b.phone === "") {
    add("phone", null);
  }
  // Email validation
  if (b.email !== undefined && b.email !== null && b.email !== "") {
    if (!isValidEmail(b.email))
      return res
        .status(400)
        .json({ message: "Enter a valid email address." });
    add("email", String(b.email).trim().toLowerCase());
  } else if (b.email === null || b.email === "") {
    add("email", null);
  }
  // Age validation
  if (b.age !== undefined && b.age !== null && b.age !== "") {
    if (!isValidAge(b.age))
      return res
        .status(400)
        .json({ message: "Age must be between 18 and 70." });
    add("age", Number(b.age));
  } else if (b.age === null || b.age === "") {
    add("age", null);
  }
  // Experience validation
  if (b.experience !== undefined && b.experience !== null && b.experience !== "") {
    if (!isValidExperience(b.experience))
      return res
        .status(400)
        .json({ message: "Experience must be between 0 and 60 years." });
    add("experience_years", Number(b.experience));
  }
  if (b.specialization !== undefined)
    add("specialization", String(b.specialization || ""));
  if (b.queueLimit !== undefined) {
    if (!Number.isInteger(Number(b.queueLimit)) || Number(b.queueLimit) <= 0)
      return res.status(400).json({ message: "Queue capacity must be a positive whole number." });
    add("queue_limit", Number(b.queueLimit));
  }
  if (b.workingDays !== undefined)
    add(
      "working_days_json",
      b.workingDays ? JSON.stringify(b.workingDays) : null,
    );
  if (b.status !== undefined && BARBER_STATUSES.includes(b.status))
    add("status", b.status);
  if (b.photo !== undefined) add("photo_url", b.photo ? String(b.photo) : null);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (fields.length) {
      const [result] = await connection.query(
        `UPDATE barbers SET ${fields.join(", ")} WHERE id=? AND shop_id=?`,
        [...values, barberId, shopId],
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return res
          .status(404)
          .json({ message: "Barber not found in this shop." });
      }
    }

    if (Array.isArray(b.services)) {
      await connection.query("DELETE FROM barber_services WHERE barber_id=?", [
        barberId,
      ]);
      await linkBarberServices(connection, barberId, shopId, b.services);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [[rows], [maps]] = await Promise.all([
    pool.query(`SELECT ${BARBER_COLUMNS} FROM barbers WHERE id=?`, [barberId]),
    pool.query("SELECT service_id FROM barber_services WHERE barber_id=?", [
      barberId,
    ]),
  ]);
  const row = rows[0];
  res.json({
    barber: {
      id: row.id,
      shopId: row.shop_id,
      name: row.name,
      gender: row.gender || "",
      age: row.age != null ? Number(row.age) : null,
      phone: row.phone || "",
      email: row.email || "",
      experience: row.experience_years || 0,
      specialization: row.specialization || "",
      workingDays: parseJson(row.working_days_json, null),
      queueLimit: Number(row.queue_limit || 10),
      rating: Number(row.rating),
      status: row.status,
      photo: row.photo_url || "",
      services: maps.map((x) => x.service_id),
    },
  });
}

/* ------------------------------------------------------------------ */
/* Co-owners                                                           */
/* ------------------------------------------------------------------ */

async function fetchCoOwner(id) {
  const [rows] = await pool.query(
    `SELECT ${CO_OWNER_COLUMNS} FROM shop_co_owners WHERE id=? LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function listCoOwners(req, res) {
  const { id: shopId } = req.params;
  if (!(await ownsShop(req, shopId))) return notOwned(res);

  const [rows] = await pool.query(
    `SELECT ${CO_OWNER_COLUMNS} FROM shop_co_owners WHERE shop_id=? ORDER BY created_at ASC`,
    [shopId],
  );
  res.json(rows.map(mapCoOwner));
}

export async function createCoOwner(req, res) {
  const { id: shopId } = req.params;
  if (!(await ownsShop(req, shopId))) return notOwned(res);

  const b = req.body || {};
  const name = String(b.name || "").trim();
  const email = String(b.email || "")
    .trim()
    .toLowerCase();
  const phone = String(b.phone || "").trim();
  const title = String(b.title || "Co-Owner").trim();
  const password = String(b.password || "");
  const permissions =
    typeof b.permissions === "object" && b.permissions !== null
      ? b.permissions
      : {};

  if (!name || !isValidName(name)) {
    return res
      .status(400)
      .json({ message: "Enter a valid co-owner full name (2 to 60 alphabetic characters)." });
  }
  if (!email || !isValidEmail(email)) {
    return res
      .status(400)
      .json({ message: "Enter a valid co-owner email address." });
  }
  if (!phone || !isValidPhone(phone)) {
    return res
      .status(400)
      .json({ message: "Enter a valid 10-digit mobile number for the co-owner." });
  }
  if (!password || password.length < 6) {
    return res
      .status(400)
      .json({ message: "Password must be at least 6 characters." });
  }

  const [existing] = await pool.query(
    "SELECT id FROM shop_co_owners WHERE shop_id=? AND LOWER(email)=? LIMIT 1",
    [shopId, email],
  );
  if (existing.length) {
    return res.status(409).json({
      message: "A co-owner with this email is already assigned to this shop.",
    });
  }

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    "INSERT INTO shop_co_owners(id, shop_id, name, email, phone, title, password_hash, permissions_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')",
    [
      id,
      shopId,
      name,
      email,
      normalizePhone(phone),
      title,
      passwordHash,
      JSON.stringify(permissions),
    ],
  );

  res.status(201).json({ coOwner: mapCoOwner(await fetchCoOwner(id)) });
}

export async function updateCoOwner(req, res) {
  const { id: shopId, coOwnerId } = req.params;
  if (!(await ownsShop(req, shopId))) return notOwned(res);

  const b = req.body || {};
  const fields = [];
  const values = [];
  const add = (column, value) => {
    fields.push(`${column}=?`);
    values.push(value);
  };

  if (b.name !== undefined) {
    if (!isValidName(b.name)) {
      return res.status(400).json({ message: "Enter a valid co-owner full name (2 to 60 alphabetic characters)." });
    }
    add("name", String(b.name).trim());
  }
  if (b.email !== undefined) {
    if (!isValidEmail(b.email)) {
      return res.status(400).json({ message: "Enter a valid co-owner email address." });
    }
    add("email", String(b.email).trim().toLowerCase());
  }
  if (b.phone !== undefined) {
    if (!isValidPhone(b.phone)) {
      return res.status(400).json({ message: "Enter a valid 10-digit mobile number for the co-owner." });
    }
    add("phone", normalizePhone(b.phone));
  }
  if (b.title !== undefined) add("title", String(b.title).trim());
  if (b.status !== undefined && ["active", "inactive"].includes(b.status))
    add("status", b.status);
  if (b.permissions !== undefined)
    add("permissions_json", JSON.stringify(b.permissions));
  if (b.password) {
    if (String(b.password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }
    add("password_hash", await bcrypt.hash(String(b.password), 10));
  }

  if (fields.length) {
    await pool.query(
      `UPDATE shop_co_owners SET ${fields.join(", ")} WHERE id=? AND shop_id=?`,
      [...values, coOwnerId, shopId],
    );
  }

  const row = await fetchCoOwner(coOwnerId);
  if (!row) return res.status(404).json({ message: "Co-owner not found." });

  res.json({ coOwner: mapCoOwner(row) });
}

export async function deleteCoOwner(req, res) {
  const { id: shopId, coOwnerId } = req.params;
  if (!(await ownsShop(req, shopId))) return notOwned(res);

  const [result] = await pool.query(
    "DELETE FROM shop_co_owners WHERE id=? AND shop_id=?",
    [coOwnerId, shopId],
  );
  if (!result.affectedRows)
    return res.status(404).json({ message: "Co-owner not found." });
  res.json({ ok: true });
}
