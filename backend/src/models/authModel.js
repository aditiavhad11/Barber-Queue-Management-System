import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";
import { sendOtpEmail, emailConfigured } from "../config/mail.js";
import {
  canVerifyOtpHash,
  createAccessToken,
  isResetOtpHash,
  isDevOtpEnabled,
  tagOtpHash,
  unwrapOtpHash,
} from "../config/authSecurity.js";
import {
  isValidEmail,
  isValidName,
  isValidOtp,
  isStrongPassword,
  PATTERNS,
} from "../utils/validators.js";

const cleanEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();
const EMAIL_REGEX = PATTERNS.EMAIL;
const otp = () => String(crypto.randomInt(100000, 1000000));

export async function cleanupExpiredOtpCodes(query = pool.query.bind(pool)) {
  const [result] = await query(
    "DELETE FROM otp_codes WHERE expires_at < UTC_TIMESTAMP() LIMIT 500",
  );
  return Number(result.affectedRows || 0);
}

export async function requestOtp({
  email,
  role,
  name,
  password,
  intent = "signin",
}) {
  await cleanupExpiredOtpCodes();
  const clean = cleanEmail(email);
  if (!isValidEmail(clean)) throw new Error("Enter a valid email address.");

  if (name && !isValidName(name)) {
    throw new Error("Enter a valid name (2 to 60 alphabetic characters).");
  }

    if (!["customer", "owner", "admin"].includes(role)) {
    throw new Error("Invalid account role.");
  }

    if (!["signin", "create", "forgot"].includes(intent)) {
      throw new Error("Invalid authentication request.");
    }

    if (intent === "create") {
      if (role !== "admin" && !name?.trim())
        throw new Error("Name is required when creating an account.");
      if (
        role !== "admin" &&
        !isStrongPassword(password)
      ) {
        throw new Error(
          "Password must be 12-128 characters and include uppercase, lowercase, a number and a symbol.",
        );
      }
    }

    const useDevCode = isDevOtpEnabled();
    if (!emailConfigured && !useDevCode) {
      throw new Error(
        "Email service is not configured on the server. Set EMAIL_HOST, EMAIL_USER and EMAIL_APP_PASSWORD.",
      );
    }

  if (role === "admin" && clean !== cleanEmail(process.env.ADMIN_EMAIL)) {
    return { ok: true };
  }

  const [existing] = await pool.query(
    "SELECT id, role FROM users WHERE email=? LIMIT 1",
    [clean],
  );

  if (existing.length && existing[0].role !== role) {
    return { ok: true };
  }

  if (
    (intent === "signin" || intent === "forgot") &&
    !existing.length &&
    role !== "admin"
  ) {
    return { ok: true };
  }

  if (intent === "create" && existing.length) {
    return { ok: true };
  }

  const code = otp();
  const expires = new Date(
    Date.now() + Number(process.env.OTP_TTL_MINUTES || 5) * 60000,
  );

  await pool.query("DELETE FROM otp_codes WHERE email=?", [clean]);
  await pool.query(
    "INSERT INTO otp_codes(email,role,code_hash,expires_at) VALUES (?,?,?,?)",
    [
      clean,
      role,
      tagOtpHash(await bcrypt.hash(code, 10), useDevCode, intent === "forgot" ? "reset" : "signin"),
      expires,
    ],
  );

  if (useDevCode) {
    console.log(`[AUTH DEV] OTP for ${clean} (${role}): ${code}`);
    return { ok: true };
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

async function findValidOtp(clean, role, code, purpose = "signin") {
  const [rows] = await pool.query(
    "SELECT * FROM otp_codes WHERE email=? AND role=? ORDER BY id DESC LIMIT 1",
    [clean, role],
  );
  if (!rows.length) throw new Error("Invalid or expired verification code.");

  const item = rows[0];
  if (new Date(item.expires_at).getTime() < Date.now()) {
    throw new Error("Invalid or expired verification code.");
  }

  if (!canVerifyOtpHash(item.code_hash)) {
    throw new Error("Invalid or expired verification code.");
  }
  if (isResetOtpHash(item.code_hash) !== (purpose === "reset")) {
    throw new Error("Invalid or expired verification code.");
  }
  const codeHash = unwrapOtpHash(item.code_hash);
  if (!(await bcrypt.compare(String(code), codeHash))) {
    throw new Error("Invalid or expired verification code.");
  }
  return item;
}

export async function verifyOtp({
  email,
  role,
  name,
  code,
  password,
  intent = "signin",
}) {
  await cleanupExpiredOtpCodes();
  const clean = cleanEmail(email);
  if (!isValidEmail(clean) || !isValidOtp(code))
    throw new Error("Invalid or expired verification code.");

  await findValidOtp(clean, role, code, intent === "forgot" ? "reset" : "signin");

  let [users] = await pool.query(
    "SELECT id,name,email,role,status,password_hash FROM users WHERE email=? LIMIT 1",
    [clean],
  );

  if (intent === "forgot") {
    if (
      !users.length ||
      users[0].role !== role ||
      users[0].status !== "active" ||
      role === "admin"
    ) {
      throw new Error("Invalid or expired verification code.");
    }
    return { ok: true };
  }

  await pool.query("DELETE FROM otp_codes WHERE email=?", [clean]);

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
      if (!isStrongPassword(password)) {
        throw new Error(
          "Password must be 12-128 characters and include uppercase, lowercase, a number and a symbol.",
        );
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
    throw new Error("Invalid or expired verification code.");
  }

  return {
    token: createAccessToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

export async function resetPassword({ email, role, code, password }) {
  const clean = cleanEmail(email);
  if (
    !isValidEmail(clean) ||
    !isValidOtp(code) ||
    !["customer", "owner"].includes(role)
  ) {
    throw new Error("Unable to reset password. Check the code and try again.");
  }
  if (!isStrongPassword(password)) {
    throw new Error(
      "Password must be 12-128 characters and include uppercase, lowercase, a number and a symbol.",
    );
  }

  await findValidOtp(clean, role, code, "reset");
  const [users] = await pool.query(
    "SELECT id FROM users WHERE email=? AND role=? AND status='active' LIMIT 1",
    [clean, role],
  );
  if (!users.length)
    throw new Error("Unable to reset password. Check the code and try again.");

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    "UPDATE users SET password_hash=? WHERE id=? AND status='active'",
    [passwordHash, users[0].id],
  );
  if (!result.affectedRows)
    throw new Error("Unable to reset password. Check the code and try again.");
  await pool.query("DELETE FROM otp_codes WHERE email=?", [clean]);
  return { ok: true };
}

export async function passwordLogin({ email, password, role }) {
  const clean = cleanEmail(email);
  if (!EMAIL_REGEX.test(clean) || !password)
    throw new Error("Invalid email or password.");

  const [users] = await pool.query(
    "SELECT id,name,email,role,status,password_hash FROM users WHERE email=? LIMIT 1",
    [clean],
  );
  const user = users[0];
  if (
    !user ||
    user.role === "admin" ||
    user.role !== role ||
    user.status !== "active" ||
    !user.password_hash ||
    !(await bcrypt.compare(password, user.password_hash))
  ) {
    throw new Error("Invalid email or password.");
  }

  return {
    token: createAccessToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

export async function shopLogin({ email, password }) {
  const clean = cleanEmail(email);
  if (!isValidEmail(clean) || !password)
    throw new Error("Invalid shop or manager credentials.");

  const [shops] = await pool.query(
    "SELECT id,name,owner_id,login_email,login_password_hash,status,active FROM shops WHERE login_email=? LIMIT 1",
    [clean],
  );
  const shop = shops[0];
  if (
    shop &&
    (await bcrypt.compare(String(password), shop.login_password_hash))
  ) {
    if (shop.status !== "approved" || !shop.active)
      throw new Error("Invalid shop or manager credentials.");
    return {
      token: createAccessToken({
        id: shop.id,
        name: shop.name,
        role: "shop",
        shopId: shop.id,
        permissions: { all: true },
      }),
      user: {
        id: shop.id,
        name: shop.name,
        role: "shop",
        shopId: shop.id,
        ownerId: shop.owner_id,
        permissions: { all: true },
      },
    };
  }

  const [coOwners] = await pool.query(
    `SELECT c.id,c.shop_id,c.name,c.email,c.phone,c.title,c.password_hash,c.permissions_json,c.status AS co_status,
            s.name AS shop_name,s.owner_id,s.status AS shop_status,s.active AS shop_active
     FROM shop_co_owners c JOIN shops s ON s.id=c.shop_id
     WHERE LOWER(c.email)=? LIMIT 1`,
    [clean],
  );
  const coOwner = coOwners[0];
  if (
    coOwner &&
    (await bcrypt.compare(String(password), coOwner.password_hash))
  ) {
    if (
      coOwner.co_status !== "active" ||
      coOwner.shop_status !== "approved" ||
      !coOwner.shop_active
    ) {
      throw new Error("Invalid shop or manager credentials.");
    }
    let permissions = {};
    try {
      permissions =
        typeof coOwner.permissions_json === "object" &&
        coOwner.permissions_json !== null
          ? coOwner.permissions_json
          : JSON.parse(coOwner.permissions_json || "{}");
    } catch {
      permissions = {};
    }
    return {
      token: createAccessToken({
        id: coOwner.id,
        name: coOwner.name,
        role: "co_owner",
        shopId: coOwner.shop_id,
        permissions,
      }),
      user: {
        id: coOwner.id,
        name: coOwner.name,
        email: coOwner.email,
        phone: coOwner.phone,
        role: "co_owner",
        title: coOwner.title || "Co-Owner",
        shopId: coOwner.shop_id,
        shopName: coOwner.shop_name,
        ownerId: coOwner.owner_id,
        permissions,
      },
    };
  }

  throw new Error("Invalid shop or manager credentials.");
}
