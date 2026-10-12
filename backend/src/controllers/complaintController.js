import crypto from "node:crypto";
import { pool } from "../config/db.js";

const complaintSelect = `SELECT c.id, c.customer_id, c.shop_id, c.issue, s.name AS shop_name,
  c.target_type, c.target_barber_id, b.name AS target_barber_name,
  u.name AS customer_name, c.issue_type, c.subject, c.description, c.status,
  c.created_at, c.resolved_at
  FROM complaints c
  JOIN shops s ON s.id=c.shop_id
  JOIN users u ON u.id=c.customer_id
  LEFT JOIN barbers b ON b.id=c.target_barber_id`;

const mapComplaint = (row) => ({
  id: row.id,
  customerId: row.customer_id,
  customerName: row.customer_name,
  shopId: row.shop_id,
  shop: row.shop_name,
  targetType: row.target_type || "owner",
  targetBarberId: row.target_barber_id || null,
  targetName: row.target_type === "staff" ? row.target_barber_name : "Shop owner",
  issueType: row.issue_type || "Other",
  subject: row.subject || row.issue || "",
  description: row.description || row.issue || row.subject || "",
  status: ({ open: "Open", investigating: "In Progress", resolved: "Resolved", closed: "Closed" })[row.status] || row.status,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
});

export async function createComplaint(req, res) {
  const shopId = String(req.body?.shopId || "");
  const targetType = String(req.body?.targetType || "").toLowerCase();
  const targetBarberId = req.body?.targetBarberId ? String(req.body.targetBarberId) : null;
  const issueType = String(req.body?.issueType || "Other").trim().slice(0, 80);
  const subject = String(req.body?.subject || "").trim().slice(0, 190);
  const description = String(req.body?.description || "").trim().slice(0, 5000);
  if (!shopId || !subject || !description)
    return res.status(400).json({ message: "Shop, subject and description are required." });
  if (!/^[\w\s.,?!'"()\-]{3,190}$/.test(subject))
    return res.status(400).json({ message: "Subject must be between 3 and 190 characters." });
  if (description.length < 5)
    return res.status(400).json({ message: "Description must be at least 5 characters long." });
  if (!/^(staff|owner)$/.test(targetType))
    return res.status(400).json({ message: "Choose whether the complaint is about staff or the shop owner." });
  if ((targetType === "staff") !== Boolean(targetBarberId))
    return res.status(400).json({ message: "Choose a staff member for staff complaints only." });
  const [shops] = await pool.query("SELECT id FROM shops WHERE id=? AND status='approved' LIMIT 1", [shopId]);
  if (!shops.length) return res.status(404).json({ message: "The selected shop was not found." });
  if (targetType === "staff") {
    const [barbers] = await pool.query("SELECT id FROM barbers WHERE id=? AND shop_id=? LIMIT 1", [targetBarberId, shopId]);
    if (!barbers.length) return res.status(400).json({ message: "That staff member does not belong to the selected shop." });
  }
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO complaints (id,customer_id,shop_id,issue,issue_type,subject,description,target_type,target_barber_id,status)
     VALUES (?,?,?,?,?,?,?,?,?,'open')`,
    [id, req.user.sub, shopId, description, issueType || "Other", subject, description, targetType, targetBarberId],
  );
  const [rows] = await pool.query(`${complaintSelect} WHERE c.id=? LIMIT 1`, [id]);
  res.status(201).json({ complaint: mapComplaint(rows[0]) });
}

export async function listMyComplaints(req, res) {
  const [rows] = await pool.query(`${complaintSelect} WHERE c.customer_id=? ORDER BY c.created_at DESC`, [req.user.sub]);
  res.json(rows.map(mapComplaint));
}

export async function listAdminComplaints(_req, res) {
  const [rows] = await pool.query(`${complaintSelect} ORDER BY c.created_at DESC`);
  res.json(rows.map(mapComplaint));
}

function ownerScope(req) {
  if (req.user.role === "owner") {
    const shopId = String(req.query?.shopId || "");
    return { sql: "s.owner_id=? AND (?='' OR c.shop_id=?)", params: [req.user.sub, shopId, shopId] };
  }
  const shopId = req.user.shopId || req.user.sub;
  return { sql: "c.shop_id=?", params: [shopId] };
}

export async function listOwnerComplaints(req, res) {
  const scope = ownerScope(req);
  const [rows] = await pool.query(`${complaintSelect} WHERE c.target_type='staff' AND ${scope.sql} ORDER BY c.created_at DESC`, scope.params);
  res.json(rows.map(mapComplaint));
}

async function updateStatus(req, res, resolver) {
  const nextStatus = String(req.body?.status || "").toLowerCase();
  if (!["investigating", "resolved"].includes(nextStatus))
    return res.status(400).json({ message: "Choose In Progress or Resolved." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT c.id,c.customer_id,c.shop_id,c.status,c.target_type,s.name AS shop_name
       FROM complaints c JOIN shops s ON s.id=c.shop_id
       WHERE c.id=? AND c.target_type=? AND ${resolver.sql} LIMIT 1 FOR UPDATE`,
      [req.params.id, resolver.targetType, ...resolver.params(req)],
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Complaint not found or you are not allowed to resolve it." });
    }
    const complaint = rows[0];
    if (complaint.status === "closed") {
      await connection.rollback();
      return res.status(409).json({ message: "A closed complaint cannot be changed." });
    }
    if (complaint.status === "resolved" && nextStatus !== "resolved") {
      await connection.rollback();
      return res.status(409).json({ message: "A resolved complaint cannot be reopened." });
    }
    const changed = complaint.status !== nextStatus;
    if (changed) {
      await connection.query("UPDATE complaints SET status=?, resolved_at=? WHERE id=?", [nextStatus, nextStatus === "resolved" ? new Date() : null, complaint.id]);
      if (nextStatus === "resolved") {
        await connection.query(
          `INSERT INTO notifications (id,user_id,shop_id,tone,text,ref_id)
           SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id=? AND ref_id=? AND tone='ok')`,
          [crypto.randomUUID(), complaint.customer_id, complaint.shop_id, "ok", `Your complaint regarding ${complaint.shop_name} has been resolved. Please check the complaint details for the update.`, complaint.id, complaint.customer_id, complaint.id],
        );
      }
    }
    await connection.commit();
    res.json({ status: mapComplaint({ ...complaint, status: nextStatus }).status, changed });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateOwnerComplaintStatus(req, res) {
  const resolver = req.user.role === "owner"
    ? { targetType: "staff", sql: "s.owner_id=?", params: (r) => [r.user.sub] }
    : { targetType: "staff", sql: "c.shop_id=?", params: (r) => [r.user.shopId || r.user.sub] };
  return updateStatus(req, res, resolver);
}

export async function updateAdminComplaintStatus(req, res) {
  return updateStatus(req, res, { targetType: "owner", sql: "1=1", params: () => [] });
}
