import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { sendOtpEmail, emailConfigured } from "../config/mail.js";

const sign = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

const cleanEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();
const EMAIL_REGEX =
  /^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const otp = () => String(crypto.randomInt(100000, 1000000));

export async function requestOtp({
  email,
  role,
  name,
  password,
  intent = "signin",
}) {
  const clean = cleanEmail(email);
  if (!EMAIL_REGEX.test(clean)) throw new Error("Enter a valid email address.");

  if (!["customer", "owner", "admin"].includes(role)) {
    throw new Error("Invalid account role.");
  }

  if (role === "admin" && clean !== cleanEmail(process.env.ADMIN_EMAIL)) {
    throw new Error("This email is not configured for admin access.");
  }

  const [existing] = await pool.query(
    "SELECT id, role FROM users WHERE email=? LIMIT 1",
    [clean],
  );

  if (existing.length && existing[0].role !== role) {
    throw new Error(
      "This email is already registered for another account type.",
    );
  }

  if (
    (intent === "signin" || intent === "forgot") &&
    !existing.length &&
    role !== "admin"
  ) {
    throw new Error("No account found. Create an account first.");
  }

  if (intent === "create" && existing.length) {
    throw new Error(
      "An account already exists for this email. Sign in instead.",
    );
  }

  if (role !== "admin" && !existing.length && !name?.trim()) {
    throw new Error("Name is required when creating an account.");
  }

  if (intent === "create") {
    if (!password) throw new Error("Password is required.");
    if (password.length < 8)
      throw new Error("Password must be at least 8 characters.");
  }

  // When SMTP is not configured we use the dev OTP as the REAL code, so the code shown to the
  // developer is the same code that verifyOtp checks (before, a random code was stored while
  // 123456 was shown, so verification always failed).
  const useDevCode = !emailConfigured && process.env.NODE_ENV !== "production";
  if (!emailConfigured && !useDevCode) {
    throw new Error(
      "Email service is not configured on the server. Set EMAIL_HOST, EMAIL_USER and EMAIL_APP_PASSWORD.",
    );
  }
  const code = useDevCode ? String(process.env.DEV_OTP || "123456") : otp();
  const expires = new Date(
    Date.now() + Number(process.env.OTP_TTL_MINUTES || 5) * 60000,
  );

  await pool.query("DELETE FROM otp_codes WHERE email=?", [clean]);
  await pool.query(
    "INSERT INTO otp_codes(email,role,code_hash,expires_at) VALUES (?,?,?,?)",
    [clean, role, await bcrypt.hash(code, 10), expires],
  );

  if (useDevCode) {
    return { ok: true, devOtp: code, emailConfigured: false };
  }

  try {
    await sendOtpEmail(clean, code);
  } catch (e) {
    await pool.query("DELETE FROM otp_codes WHERE email=?", [clean]);
    console.error("OTP email failed:", e.message);
    throw new Error(
      "Could not send the OTP email. Check the EMAIL_* settings (Gmail needs an App Password). " +
        (e.code ? `[${e.code}]` : ""),
    );
  }
  return { ok: true };
}

export async function verifyOtp({ email, role, name, code, password }) {
  const clean = cleanEmail(email);
  if (!EMAIL_REGEX.test(clean)) throw new Error("Enter a valid email address.");

  const [rows] = await pool.query(
    "SELECT * FROM otp_codes WHERE email=? AND role=? ORDER BY id DESC LIMIT 1",
    [clean, role],
  );

  if (!rows.length) throw new Error("Request a new OTP for this email.");

  const item = rows[0];
  if (new Date(item.expires_at).getTime() < Date.now()) {
    throw new Error("This code has expired. Request a new one.");
  }

  if (!(await bcrypt.compare(String(code), item.code_hash))) {
    throw new Error("That code is not correct. Please try again.");
  }

  await pool.query("DELETE FROM otp_codes WHERE email=?", [clean]);

  let [users] = await pool.query(
    "SELECT id,name,email,role,status,password_hash FROM users WHERE email=? LIMIT 1",
    [clean],
  );

  if (!users.length) {
    if (role === "admin") {
      if (clean !== cleanEmail(process.env.ADMIN_EMAIL)) {
        throw new Error("This email is not configured for admin access.");
      }
      const id = crypto.randomUUID();
      await pool.query(
        "INSERT INTO users(id,name,email,role,status,password_hash) VALUES (?,?,?,?,?,NULL)",
        [
          id,
          process.env.ADMIN_NAME || name?.trim() || clean.split("@")[0],
          clean,
          "admin",
          "active",
        ],
      );
    } else {
      if (!password || password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }
      const id = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query(
        "INSERT INTO users(id,name,email,role,status,password_hash) VALUES (?,?,?,?,?,?)",
        [
          id,
          name?.trim() || clean.split("@")[0],
          clean,
          role,
          "active",
          passwordHash,
        ],
      );
    }

    [users] = await pool.query(
      "SELECT id,name,email,role,status,password_hash FROM users WHERE email=?",
      [clean],
    );
  }

  if (
    users[0]?.role === "admin" &&
    clean !== cleanEmail(process.env.ADMIN_EMAIL)
  ) {
    throw new Error("This email is not configured for admin access.");
  }

  const user = users[0];

  if (user.status !== "active") {
    throw new Error("This account is currently blocked.");
  }

  return {
    token: sign(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

export async function passwordLogin({ email, password, role }) {
  const clean = cleanEmail(email);
  if (!EMAIL_REGEX.test(clean)) throw new Error("Enter a valid email address.");

  if (!password) throw new Error("Password is required.");

  const [users] = await pool.query(
    "SELECT id,name,email,role,status,password_hash FROM users WHERE email=? LIMIT 1",
    [clean],
  );

  if (!users.length) throw new Error("No account found with this email.");

  const user = users[0];

  if (user.role === "admin") {
    throw new Error("Admin login is OTP-only. Please sign in using OTP.");
  }

  if (user.role !== role)
    throw new Error("This account belongs to a different role.");
  if (user.status !== "active")
    throw new Error("This account is currently blocked.");
  if (!user.password_hash) {
    throw new Error(
      "Password login is not set up for this account. Please sign in using OTP.",
    );
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error("Incorrect email or password.");

  return {
    token: sign(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

export async function shopLogin({ email, password }) {
  const clean = cleanEmail(email);
  const [rows] = await pool.query(
    "SELECT id,name,owner_id,login_email,login_password_hash,status FROM shops WHERE login_email=? LIMIT 1",
    [clean],
  );

  if (
    !rows.length ||
    !(await bcrypt.compare(password, rows[0].login_password_hash))
  ) {
    throw new Error("Invalid shop email or password.");
  }

  const shop = rows[0];
  if (shop.status !== "approved") {
    throw new Error(`This shop is ${shop.status} and cannot be accessed.`);
  }

  return {
    token: sign({ id: shop.id, name: shop.name, role: "shop" }),
    user: {
      id: shop.id,
      name: shop.name,
      role: "shop",
      shopId: shop.id,
      ownerId: shop.owner_id,
    },
  };
}
