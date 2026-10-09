import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { pool } from "../config/db.js";

const parseJson = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

/**
 * Bulk insert helper.
 * - `sql` must end with `VALUES ?` (mysql2 expands the nested array into
 *   multiple row tuples). This only works with `.query()`, NOT `.execute()`.
 * - Rows are sent in chunks so one huge payload can never exceed
 *   `max_allowed_packet`. For normal shops it is a single round-trip.
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
  "INSERT INTO barbers(id,shop_id,name,gender,experience_years,specialization,status,photo_url) VALUES ?";
const BARBER_SERVICE_INSERT =
  "INSERT INTO barber_services(barber_id,service_id) VALUES ?";

/**
 * Single-statement replacement for the old
 * `for (sid of services) INSERT IGNORE ... SELECT ?,id FROM services WHERE id=? AND shop_id=?`
 * Still validates that every service belongs to the given shop and still
 * silently skips unknown / foreign ids and duplicates (INSERT IGNORE).
 */
async function linkBarberServices(conn, barberId, shopId, serviceIds) {
  if (!Array.isArray(serviceIds) || !serviceIds.length) return;
  await conn.query(
    "INSERT IGNORE INTO barber_services(barber_id,service_id) SELECT ?,id FROM services WHERE shop_id=? AND id IN (?)",
    [barberId, shopId, serviceIds],
  );
}

async function hydrateShop(row) {
  const [photos] = await pool.query(
    "SELECT id,url,is_primary FROM shop_photos WHERE shop_id=? ORDER BY is_primary DESC, created_at ASC",
    [row.id],
  );

  const [services] = await pool.query(
    "SELECT id,name,price,duration_minutes,enabled FROM services WHERE shop_id=? ORDER BY id ASC",
    [row.id],
  );

  const [barbers] = await pool.query(
    "SELECT id,name,gender,experience_years,specialization,rating,status,photo_url FROM barbers WHERE shop_id=? ORDER BY id ASC",
    [row.id],
  );

  let reviewsList = [];
  try {
    const [revs] = await pool.query(
      "SELECT r.id,r.queue_id,r.customer_id,r.rating,r.text,r.created_at,u.name AS customer_name FROM booking_reviews r JOIN users u ON u.id=r.customer_id WHERE r.shop_id=? ORDER BY r.created_at DESC",
      [row.id],
    );
    reviewsList = revs.map((r) => ({
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
    }));
  } catch {
    /* table is created on server start; ignore if it is not there yet */
  }
  const barberIds = barbers.map((b) => b.id);

  let mappings = [];

  if (barberIds.length) {
    const [mapRows] = await pool.query(
      `SELECT barber_id,service_id FROM barber_services WHERE barber_id IN (${barberIds.map(() => "?").join(",")})`,
      barberIds,
    );
    mappings = mapRows;
  }

  // Group once (O(n)) instead of filtering the full list per barber (O(n*m)).
  const servicesByBarber = {};
  for (const id of barberIds) servicesByBarber[id] = [];
  for (const m of mappings) {
    if (servicesByBarber[m.barber_id]) {
      servicesByBarber[m.barber_id].push(m.service_id);
    }
  }

  return {
    ...row,
    reviewsList,
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
    availability: parseJson(row.availability_json),
    policy: parseJson(row.policies_json),
    upiQrUrl: row.upi_qr_url || "",
    photos: photos.map((p) => ({
      id: p.id,
      url: p.url,
      primary: Boolean(p.is_primary),
    })),
    services: services.map((x) => ({
      id: x.id,
      shopId: row.id,
      name: x.name,
      price: Number(x.price),
      duration: Number(x.duration_minutes),
      enabled: Boolean(x.enabled),
    })),
    barbers: barbers.map((b) => ({
      id: b.id,
      shopId: row.id,
      name: b.name,
      gender: b.gender || "",
      experience: b.experience_years || 0,
      specialization: b.specialization || "",
      rating: Number(b.rating),
      status: b.status,
      photo: b.photo_url || "",
      services: servicesByBarber[b.id] || [],
    })),
  };
}

export async function listApproved(_req, res) {
  const [rows] = await pool.query(
    "SELECT * FROM shops WHERE status='approved' AND active=1 ORDER BY created_at DESC",
  );
  res.json(await Promise.all(rows.map(hydrateShop)));
}

export async function listMine(req, res) {
  const [rows] = await pool.query(
    "SELECT * FROM shops WHERE owner_id=? ORDER BY created_at DESC",
    [req.user.sub],
  );
  res.json(await Promise.all(rows.map(hydrateShop)));
}

export async function createShop(req, res) {
  const b = req.body;
  if (!b.name?.trim() || !b.contact?.trim() || !b.address?.trim())
    return res
      .status(400)
      .json({ message: "Shop name, contact and address are required." });

  const id = crypto.randomUUID();

  // Legacy schema keeps these columns NOT NULL; credentials are generated internally and are not shown to owners.
  const internalLoginEmail = `shop-${id}@internal.invalid`;
  const hash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
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

    // ---- photos (1 bulk insert) ----
    const photoRows = (b.photos || [])
      .filter((photo) => photo?.url)
      .map((photo) => [
        crypto.randomUUID(),
        id,
        photo.url,
        photo.primary ? 1 : 0,
      ]);
    await bulkInsert(connection, SHOP_PHOTO_INSERT, photoRows);

    // ---- services (1 bulk insert) ----
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

    // ---- barbers + barber_services (2 bulk inserts total) ----
    const barberCount = Math.max(1, Number(b.barberCount || b.barbers || 1));
    const barbers = Array.isArray(b.barbers)
      ? b.barbers
      : Array.from({ length: barberCount }, (_, i) => ({
          name: `Barber ${i + 1}`,
          services: serviceIds,
        }));

    const barberRows = [];
    const barberServiceRows = [];
    for (let i = 0; i < barbers.length; i += 1) {
      const barber = barbers[i] || {};
      const bid = crypto.randomUUID();
      barberRows.push([
        bid,
        id,
        barber.name?.trim() || `Barber ${i + 1}`,
        String(barber.gender || "Prefer not to say"),
        Math.max(0, Number(barber.experience) || 0),
        String(barber.specialization || ""),
        barber.status || "Available",
        barber.photo || null,
      ]);

      const requestedServices = Array.isArray(barber.services)
        ? barber.services
        : [];
      const barberServiceIds = requestedServices
        .map((sid) => serviceIdMap.get(String(sid)))
        .filter(Boolean);
      const idsToUse = barberServiceIds.length ? barberServiceIds : serviceIds;
      for (const sid of idsToUse) barberServiceRows.push([bid, sid]);
    }
    // barbers first, then mappings (FK order preserved)
    await bulkInsert(connection, BARBER_INSERT, barberRows);
    await bulkInsert(connection, BARBER_SERVICE_INSERT, barberServiceRows);

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

  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND owner_id=? LIMIT 1",
    [shopId, req.user.sub],
  );

  if (!owned.length)
    return res
      .status(404)
      .json({ message: "Shop not found or not owned by this account." });

  const fields = [];
  const values = [];

  const add = (column, value) => {
    fields.push(`${column}=?`);
    values.push(value);
  };

  if (b.name !== undefined) add("name", String(b.name).trim());

  if (b.description !== undefined)
    add("description", String(b.description || ""));

  if (b.contact !== undefined) add("contact", String(b.contact).trim());

  if (b.address !== undefined) add("address", String(b.address).trim());

  if (b.location !== undefined) {
    add("latitude", b.location?.lat ?? null);
    add("longitude", b.location?.lng ?? null);
  }

  if (b.hours !== undefined) {
    add("hours_open", b.hours?.open || "09:00");
    add("hours_close", b.hours?.close || "21:00");
  }

  if (b.availability !== undefined)
    add("availability_json", JSON.stringify(b.availability || {}));

  if (b.policy !== undefined)
    add("policies_json", JSON.stringify(b.policy || {}));

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    if (fields.length) {
      values.push(shopId);
      await connection.query(
        `UPDATE shops SET ${fields.join(", ")} WHERE id=? AND owner_id=?`,
        [...values, req.user.sub],
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
  res.json(await hydrateShop(rows[0]));
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
  if (!result.affectedRows)
    return res
      .status(404)
      .json({ message: "Shop not found or not owned by this account." });
  res.json({ ok: true });
}

export async function listAdmin(_req, res) {
  const [rows] = await pool.query(
    "SELECT * FROM shops ORDER BY created_at DESC",
  );
  res.json(await Promise.all(rows.map(hydrateShop)));
}

export async function createService(req, res) {
  const { id: shopId } = req.params;
  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND owner_id=? LIMIT 1",
    [shopId, req.user.sub],
  );
  if (!owned.length)
    return res
      .status(404)
      .json({ message: "Shop not found or not owned by this account." });
  const name = String(req.body?.name || "").trim();
  const price = Number(req.body?.price);
  const duration = Number(req.body?.duration);
  if (
    !name ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return res.status(400).json({
      message: "Enter a service name, positive price and positive duration.",
    });
  }
  const [existing] = await pool.query(
    "SELECT id,name,price,duration_minutes,enabled FROM services WHERE shop_id=? AND LOWER(name)=LOWER(?) LIMIT 1",
    [shopId, name],
  );
  if (existing.length) {
    return res.json({
      existing: true,
      service: {
        id: existing[0].id,
        shopId,
        name: existing[0].name,
        price: Number(existing[0].price),
        duration: Number(existing[0].duration_minutes),
        enabled: Boolean(existing[0].enabled),
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

export async function createBarber(req, res) {
  const { id: shopId } = req.params;

  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND (owner_id=? OR id=?) LIMIT 1",
    [shopId, req.user.sub, req.user.role === "shop" ? shopId : "__no_shop__"],
  );

  if (!owned.length)
    return res
      .status(404)
      .json({ message: "Shop not found or not owned by this account." });

  const b = req.body || {};
  if (!String(b.name || "").trim())
    return res.status(400).json({ message: "Barber name is required." });

  const id = crypto.randomUUID();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO barbers(id,shop_id,name,gender,experience_years,specialization,status,photo_url) VALUES (?,?,?,?,?,?,?,?)",
      [
        id,
        shopId,
        String(b.name).trim(),
        String(b.gender || "Prefer not to say"),
        Math.max(0, Number(b.experience) || 0),
        String(b.specialization || ""),
        ["Available", "On Break", "Unavailable"].includes(b.status)
          ? b.status
          : "Available",
        b.photo ? String(b.photo) : null,
      ],
    );
    // one statement instead of one INSERT per service
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
    "SELECT id,shop_id,name,gender,experience_years,specialization,rating,status,photo_url FROM barbers WHERE id=?",
    [id],
  );
  res.status(201).json({ barber: rows[0] });
}

export async function updateBarber(req, res) {
  const { id: shopId, barberId } = req.params;
  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND (owner_id=? OR id=?) LIMIT 1",
    [shopId, req.user.sub, req.user.role === "shop" ? shopId : "__no_shop__"],
  );
  if (!owned.length)
    return res
      .status(404)
      .json({ message: "Shop not found or not owned by this account." });
  const fields = [];
  const values = [];
  const add = (k, v) => {
    fields.push(`${k}=?`);
    values.push(v);
  };
  const b = req.body || {};
  if (b.name !== undefined) add("name", String(b.name).trim());
  if (b.gender !== undefined) add("gender", String(b.gender || ""));
  if (b.experience !== undefined)
    add("experience_years", Math.max(0, Number(b.experience) || 0));
  if (b.specialization !== undefined)
    add("specialization", String(b.specialization || ""));
  if (
    b.status !== undefined &&
    ["Available", "On Break", "Unavailable"].includes(b.status)
  )
    add("status", b.status);
  if (b.photo !== undefined) add("photo_url", b.photo ? String(b.photo) : null);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (fields.length) {
      values.push(barberId, shopId);
      const [result] = await connection.query(
        `UPDATE barbers SET ${fields.join(", ")} WHERE id=? AND shop_id=?`,
        values,
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
      // one statement instead of one INSERT per service
      await linkBarberServices(connection, barberId, shopId, b.services);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const [rows] = await pool.query(
    "SELECT id,shop_id,name,gender,experience_years,specialization,rating,status,photo_url FROM barbers WHERE id=?",
    [barberId],
  );
  const [maps] = await pool.query(
    "SELECT service_id FROM barber_services WHERE barber_id=?",
    [barberId],
  );
  res.json({ barber: { ...rows[0], services: maps.map((x) => x.service_id) } });
}
