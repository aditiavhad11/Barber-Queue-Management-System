import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

export async function auth(req, res, next) {
  let claims;
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) throw new Error();
    claims = jwt.verify(h.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    let active = false;
    if (["customer", "owner", "admin"].includes(claims.role)) {
      const [rows] = await pool.query(
        "SELECT id,role,status FROM users WHERE id=? LIMIT 1",
        [claims.sub],
      );
      active =
        rows.length > 0 &&
        rows[0].role === claims.role &&
        rows[0].status === "active";
    } else if (claims.role === "shop") {
      const [rows] = await pool.query(
        "SELECT status,active FROM shops WHERE id=? LIMIT 1",
        [claims.sub],
      );
      active = rows.length > 0 && rows[0].status === "approved" && Boolean(rows[0].active);
    } else if (claims.role === "co_owner") {
      const [rows] = await pool.query(
        `SELECT c.status AS co_status,s.status AS shop_status,s.active AS shop_active
         FROM shop_co_owners c JOIN shops s ON s.id=c.shop_id
         WHERE c.id=? LIMIT 1`,
        [claims.sub],
      );
      active =
        rows.length > 0 &&
        rows[0].co_status === "active" &&
        rows[0].shop_status === "approved" &&
        Boolean(rows[0].shop_active);
    }

    if (!active)
      return res.status(401).json({ message: "Authentication required." });
    req.user = claims;
    next();
  } catch (error) {
    next(error);
  }
}
export const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : res.status(403).json({ message: "Not allowed." });

const parsePermissions = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
};

export function permissionGranted(permissions, permissionKey) {
  const parsed = parsePermissions(permissions);
  if (parsed.all === true) return true;
  if (Array.isArray(parsed))
    return parsed.includes(permissionKey) || parsed.includes("*");
  return parsed[permissionKey] === true || parsed["*"] === true;
}

async function requestedShopId(req, resource, coOwnerShopId) {
  if (resource === "booking") {
    const [rows] = await pool.query(
      "SELECT shop_id FROM payment_bookings WHERE id=? LIMIT 1",
      [req.params.id],
    );
    return rows[0]?.shop_id || null;
  }
  if (resource === "serviceEdit") {
    const [rows] = await pool.query(
      "SELECT shop_id FROM booking_service_edits WHERE id=? LIMIT 1",
      [req.params.editId],
    );
    return rows[0]?.shop_id || null;
  }
  if (resource === "upload") {
    const folders = Array.isArray(req.body?.folders)
      ? req.body.folders
      : [req.body?.folders];
    const shopFolder = folders
      .map((folder) => /^barber-queue\/shops\/([^/]+)/.exec(String(folder || "")))
      .find(Boolean);
    return shopFolder?.[1] || coOwnerShopId;
  }
  return (
    req.params.shopId ||
    req.params.id ||
    req.body?.shopId ||
    req.query?.shopId ||
    coOwnerShopId
  );
}

export function requirePermission(permissionKey, { resource, anyOf = false } = {}) {
  return async (req, res, next) => {
    if (["owner", "shop", "admin", "customer"].includes(req.user?.role))
      return next();
    if (req.user?.role !== "co_owner")
      return res.status(403).json({ message: "Not allowed." });

    try {
      const [rows] = await pool.query(
        "SELECT shop_id, permissions_json, status FROM shop_co_owners WHERE id=? LIMIT 1",
        [req.user.sub],
      );
      const coOwner = rows[0];
      if (!coOwner || coOwner.status !== "active")
        return res.status(403).json({ message: "Not allowed." });

      const shopId = await requestedShopId(req, resource, coOwner.shop_id);
      if (resource === "upload") {
        const folders = Array.isArray(req.body?.folders)
          ? req.body.folders
          : [req.body?.folders];
        const foreignShopFolder = folders.some((folder) => {
          const match = /^barber-queue\/shops\/([^/]+)/.exec(
            String(folder || ""),
          );
          return match && String(match[1]) !== String(coOwner.shop_id);
        });
        if (foreignShopFolder)
          return res.status(403).json({ message: "Not allowed." });
      }
      if (
        !shopId ||
        String(shopId) !== String(coOwner.shop_id) ||
        (req.user.shopId && String(req.user.shopId) !== String(coOwner.shop_id))
      ) {
        return res.status(403).json({ message: "Not allowed." });
      }

      const requiredKeys =
        typeof permissionKey === "function"
          ? permissionKey(req)
          : permissionKey;
      const keys = Array.isArray(requiredKeys)
        ? requiredKeys
        : [requiredKeys];
      const grants = keys.map((key) =>
        permissionGranted(coOwner.permissions_json, key),
      );
      if (!(anyOf ? grants.some(Boolean) : grants.every(Boolean))) {
        return res.status(403).json({ message: "Not allowed." });
      }

      req.permissionShopId = coOwner.shop_id;
      req.coOwnerPermissions = parsePermissions(coOwner.permissions_json);
      next();
    } catch (error) {
      next(error);
    }
  };
}
