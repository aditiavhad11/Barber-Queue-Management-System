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
  const servicesByBarber = Object.fromEntries(
    barberIds.map((id) => [
      id,
      mappings.filter((m) => m.barber_id === id).map((m) => m.service_id),
    ]),
  );
  let coOwners = [];
  try {
    const [coRows] = await pool.query(
      "SELECT id,shop_id,name,email,phone,title,permissions_json,status,created_at,updated_at FROM shop_co_owners WHERE shop_id=? ORDER BY created_at ASC",
      [row.id],
    );
    coOwners = coRows.map((c) => ({
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
    }));
  } catch {
    /* table is created on server start; ignore if it is not there yet */
  }
  return {
    ...row,
    reviewsList,
    coOwners,
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

    for (const photo of b.photos || []) {
      if (!photo?.url) continue;
      await connection.query(
        "INSERT INTO shop_photos(id,shop_id,url,is_primary) VALUES (?,?,?,?)",
        [crypto.randomUUID(), id, photo.url, photo.primary ? 1 : 0],
      );
    }

    const services = (b.services || []).filter(
      (x) => x?.name && Number(x.price) > 0 && Number(x.duration) > 0,
    );
    const serviceIds = [];
    const serviceIdMap = new Map();
    for (const service of services) {
      const sid = crypto.randomUUID();
      serviceIds.push(sid);
      if (service.id) serviceIdMap.set(String(service.id), sid);
      await connection.query(
        "INSERT INTO services(id,shop_id,name,price,duration_minutes,enabled) VALUES (?,?,?,?,?,1)",
        [
          sid,
          id,
          service.name.trim(),
          Number(service.price),
          Number(service.duration),
        ],
      );
    }

    const barberCount = Math.max(1, Number(b.barberCount || b.barbers || 1));
    const barbers = Array.isArray(b.barbers)
      ? b.barbers
      : Array.from({ length: barberCount }, (_, i) => ({
          name: `Barber ${i + 1}`,
          services: serviceIds,
        }));
    for (let i = 0; i < barbers.length; i += 1) {
      const barber = barbers[i] || {};
      const bid = crypto.randomUUID();
      await connection.query(
        "INSERT INTO barbers(id,shop_id,name,gender,experience_years,specialization,status,photo_url) VALUES (?,?,?,?,?,?,?,?)",
        [
          bid,
          id,
          barber.name?.trim() || `Barber ${i + 1}`,
          String(barber.gender || "Prefer not to say"),
          Math.max(0, Number(barber.experience) || 0),
          String(barber.specialization || ""),
          barber.status || "Available",
          barber.photo || null,
        ],
      );
      const requestedServices = Array.isArray(barber.services)
        ? barber.services
        : [];
      const barberServiceIds = requestedServices
        .map((sid) => serviceIdMap.get(String(sid)))
        .filter(Boolean);
      const idsToUse = barberServiceIds.length ? barberServiceIds : serviceIds;
      for (const sid of idsToUse)
        await connection.query(
          "INSERT INTO barber_services(barber_id,service_id) VALUES (?,?)",
          [bid, sid],
        );
    }

    const coOwners = Array.isArray(b.coOwners)
      ? b.coOwners
      : b.coOwner
        ? [b.coOwner]
        : [];
    for (const co of coOwners) {
      if (!co?.name?.trim() || !co?.email?.trim()) continue;
      const coId = crypto.randomUUID();
      const coHash = await bcrypt.hash(
        String(co.password || "barber1234"),
        10,
      );
      await connection.query(
        "INSERT INTO shop_co_owners(id,shop_id,name,email,phone,title,password_hash,permissions_json,status) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          coId,
          id,
          String(co.name).trim(),
          String(co.email).trim().toLowerCase(),
          String(co.phone || "").trim(),
          String(co.title || "Co-Owner").trim(),
          coHash,
          JSON.stringify(co.permissions || {}),
          co.status || "active",
        ],
      );
    }

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
      for (const photo of b.photos) {
        if (!photo?.url) continue;
        await connection.query(
          "INSERT INTO shop_photos(id,shop_id,url,is_primary) VALUES (?,?,?,?)",
          [crypto.randomUUID(), shopId, photo.url, photo.primary ? 1 : 0],
        );
      }
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
  const isShopOrCoOwner =
    req.user.role === "shop" || req.user.role === "co_owner";
  const shopIdFromUser = req.user.shopId || req.user.sub;
  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND (owner_id=? OR id=?) LIMIT 1",
    [shopId, req.user.sub, isShopOrCoOwner ? shopIdFromUser : "__no_shop__"],
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
    return res
      .status(400)
      .json({
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
  res
    .status(201)
    .json({
      existing: false,
      service: { id, shopId, name, price, duration, enabled: true },
    });
}

export async function createBarber(req, res) {
  const { id: shopId } = req.params;
  const isShopOrCoOwner =
    req.user.role === "shop" || req.user.role === "co_owner";
  const shopIdFromUser = req.user.shopId || req.user.sub;
  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND (owner_id=? OR id=?) LIMIT 1",
    [shopId, req.user.sub, isShopOrCoOwner ? shopIdFromUser : "__no_shop__"],
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
    for (const sid of Array.isArray(b.services) ? b.services : [])
      await connection.query(
        "INSERT IGNORE INTO barber_services(barber_id,service_id) SELECT ?,id FROM services WHERE id=? AND shop_id=?",
        [id, sid, shopId],
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
  const isShopOrCoOwner =
    req.user.role === "shop" || req.user.role === "co_owner";
  const shopIdFromUser = req.user.shopId || req.user.sub;
  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND (owner_id=? OR id=?) LIMIT 1",
    [shopId, req.user.sub, isShopOrCoOwner ? shopIdFromUser : "__no_shop__"],
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
      for (const sid of b.services)
        await connection.query(
          "INSERT IGNORE INTO barber_services(barber_id,service_id) SELECT ?,id FROM services WHERE id=? AND shop_id=?",
          [barberId, sid, shopId],
        );
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

export async function listCoOwners(req, res) {
  const { id: shopId } = req.params;
  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND owner_id=? LIMIT 1",
    [shopId, req.user.sub],
  );
  if (!owned.length) {
    return res
      .status(404)
      .json({ message: "Shop not found or not owned by this account." });
  }
  const [rows] = await pool.query(
    "SELECT id, shop_id, name, email, phone, title, permissions_json, status, created_at, updated_at FROM shop_co_owners WHERE shop_id=? ORDER BY created_at ASC",
    [shopId],
  );
  res.json(
    rows.map((c) => ({
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
    })),
  );
}

export async function createCoOwner(req, res) {
  const { id: shopId } = req.params;
  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND owner_id=? LIMIT 1",
    [shopId, req.user.sub],
  );
  if (!owned.length) {
    return res
      .status(404)
      .json({ message: "Shop not found or not owned by this account." });
  }

  const b = req.body || {};
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const phone = String(b.phone || "").trim();
  const title = String(b.title || "Co-Owner").trim();
  const password = String(b.password || "");
  const permissions =
    typeof b.permissions === "object" && b.permissions !== null
      ? b.permissions
      : {};

  if (!name || !email || !phone) {
    return res
      .status(400)
      .json({ message: "Co-Owner name, email, and phone are required." });
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
      phone,
      title,
      passwordHash,
      JSON.stringify(permissions),
    ],
  );

  const [rows] = await pool.query(
    "SELECT id, shop_id, name, email, phone, title, permissions_json, status, created_at, updated_at FROM shop_co_owners WHERE id=? LIMIT 1",
    [id],
  );
  res.status(201).json({
    coOwner: {
      id: rows[0].id,
      shopId: rows[0].shop_id,
      name: rows[0].name,
      email: rows[0].email,
      phone: rows[0].phone || "",
      title: rows[0].title || "Co-Owner",
      permissions: parseJson(rows[0].permissions_json, {}),
      status: rows[0].status,
      createdAt: rows[0].created_at,
      updatedAt: rows[0].updated_at,
    },
  });
}

export async function updateCoOwner(req, res) {
  const { id: shopId, coOwnerId } = req.params;
  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND owner_id=? LIMIT 1",
    [shopId, req.user.sub],
  );
  if (!owned.length) {
    return res
      .status(404)
      .json({ message: "Shop not found or not owned by this account." });
  }

  const b = req.body || {};
  const fields = [];
  const values = [];
  if (b.name !== undefined) {
    fields.push("name=?");
    values.push(String(b.name).trim());
  }
  if (b.email !== undefined) {
    fields.push("email=?");
    values.push(String(b.email).trim().toLowerCase());
  }
  if (b.phone !== undefined) {
    fields.push("phone=?");
    values.push(String(b.phone).trim());
  }
  if (b.title !== undefined) {
    fields.push("title=?");
    values.push(String(b.title).trim());
  }
  if (b.status !== undefined && ["active", "inactive"].includes(b.status)) {
    fields.push("status=?");
    values.push(b.status);
  }
  if (b.permissions !== undefined) {
    fields.push("permissions_json=?");
    values.push(JSON.stringify(b.permissions));
  }
  if (b.password) {
    const hash = await bcrypt.hash(String(b.password), 10);
    fields.push("password_hash=?");
    values.push(hash);
  }

  if (fields.length) {
    values.push(coOwnerId, shopId);
    await pool.query(
      `UPDATE shop_co_owners SET ${fields.join(", ")} WHERE id=? AND shop_id=?`,
      values,
    );
  }

  const [rows] = await pool.query(
    "SELECT id, shop_id, name, email, phone, title, permissions_json, status, created_at, updated_at FROM shop_co_owners WHERE id=? LIMIT 1",
    [coOwnerId],
  );
  if (!rows.length) {
    return res.status(404).json({ message: "Co-owner not found." });
  }

  res.json({
    coOwner: {
      id: rows[0].id,
      shopId: rows[0].shop_id,
      name: rows[0].name,
      email: rows[0].email,
      phone: rows[0].phone || "",
      title: rows[0].title || "Co-Owner",
      permissions: parseJson(rows[0].permissions_json, {}),
      status: rows[0].status,
      createdAt: rows[0].created_at,
      updatedAt: rows[0].updated_at,
    },
  });
}

export async function deleteCoOwner(req, res) {
  const { id: shopId, coOwnerId } = req.params;
  const [owned] = await pool.query(
    "SELECT id FROM shops WHERE id=? AND owner_id=? LIMIT 1",
    [shopId, req.user.sub],
  );
  if (!owned.length) {
    return res
      .status(404)
      .json({ message: "Shop not found or not owned by this account." });
  }

  const [result] = await pool.query(
    "DELETE FROM shop_co_owners WHERE id=? AND shop_id=?",
    [coOwnerId, shopId],
  );
  if (!result.affectedRows) {
    return res.status(404).json({ message: "Co-owner not found." });
  }
  res.json({ ok: true });
}
