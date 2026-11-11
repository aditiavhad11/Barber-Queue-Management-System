import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { pool } from "../src/config/db.js";
import { stopEmergencyClosureWorker } from "../src/jobs/emergencyClosureQueue.js";
import { app } from "../src/server.js";
import {
  canVerifyOtpHash,
  createAccessToken,
  isResetOtpHash,
  isDevOtpEnabled,
  tagOtpHash,
  unwrapOtpHash,
  validateAuthEnvironment,
} from "../src/config/authSecurity.js";
import {
  createCorsOriginCallback,
  validateCorsEnvironment,
} from "../src/config/httpSecurity.js";
import {
  mapAdminShopResponse,
  mapOwnerShopResponse,
  mapPublicShopResponse,
} from "../src/controllers/shopController.js";
import { auth, permissionGranted, requirePermission } from "../src/middleware/auth.js";
import { createRateLimiter } from "../src/middleware/rateLimit.js";
import {
  safeImageFilename,
  uploadValidatedImages,
  validateImageFile,
} from "../src/controllers/uploadController.js";
import { isStrongPassword } from "../src/utils/validators.js";
import {
  cleanupExpiredOtpCodes,
  requestOtp,
  resetPassword,
  verifyOtp,
} from "../src/models/authModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.after(async () => {
  await pool.end();
  await stopEmergencyClosureWorker();
});
const publicShop = {
  id: "shop-1",
  owner_id: "owner-1",
  name: "Sample Shop",
  description: "A shop",
  contact: "9999999999",
  address: "Sample address",
  latitude: null,
  longitude: null,
  hours_open: "09:00:00",
  hours_close: "18:00:00",
  availability_json: "{}",
  policies_json: "{}",
  status: "approved",
  active: 1,
  rating: 4.5,
  review_count: 2,
  upi_qr_url: "",
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-02T00:00:00Z"),
  login_email: "private-login@example.test",
  login_password_hash: "shop-hash-secret",
};
const shopDetails = {
  reviews: [
    {
      id: "review-1",
      queueId: "queue-1",
      customerId: "private-customer-id",
      customer: "Customer Name",
      rating: 5,
      text: "Good service",
      date: "01 Jan 2026",
    },
  ],
  coOwners: [
    {
      id: "co-1",
      name: "Private Co-owner",
      email: "private-co-owner@example.test",
      phone: "8888888888",
      permissions: { manage_queue: true },
      status: "active",
    },
  ],
  availability: {},
  photos: [],
  services: [],
  barbers: [
    {
      id: "barber-1",
      name: "Barber Name",
      phone: "7777777777",
      email: "private-barber@example.test",
      serviceIds: [],
    },
  ],
};

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runPermission(middleware, req) {
  const res = mockResponse();
  let nextCalled = false;
  let nextError = null;
  await middleware(req, res, (error) => {
    nextCalled = true;
    nextError = error || null;
  });
  return { res, nextCalled, nextError };
}

test("public shop mapper strips credentials and private nested contacts", () => {
  const response = mapPublicShopResponse(publicShop, shopDetails);
  const serialized = JSON.stringify(response);
  assert.equal(response.ownerId, undefined);
  assert.equal(response.loginEmail, undefined);
  assert.deepEqual(response.coOwners, []);
  assert.equal(response.barbers[0].phone, undefined);
  assert.equal(response.barbers[0].email, undefined);
  assert.doesNotMatch(serialized, /private-login|shop-hash-secret|private-co-owner|private-barber|7777777777|8888888888/);
  assert.equal(response.reviewsList[0].customerId, undefined);
});

test("shop list queries use explicit projections and history deletion excludes co-owners", () => {
  const shopController = fs.readFileSync(path.resolve(__dirname, "../src/controllers/shopController.js"), "utf8");
  const bookingRoutes = fs.readFileSync(path.resolve(__dirname, "../src/routes/bookingRoutes.js"), "utf8");
  assert.doesNotMatch(shopController, /SELECT\s+\*\s+FROM\s+shops/i);
  assert.match(shopController, /SELECT \$\{SHOP_PUBLIC_COLUMNS\} FROM shops WHERE status='approved'/);
  assert.match(
    bookingRoutes,
    /router\.delete\(\s*"\/:id\/history",\s*auth,\s*requireRole\("owner",\s*"shop"\)/,
  );
});

test("owner and admin shop mappers preserve management data without hashes", () => {
  for (const response of [
    mapOwnerShopResponse(publicShop, shopDetails),
    mapAdminShopResponse(publicShop, shopDetails),
  ]) {
    const serialized = JSON.stringify(response);
    assert.equal(response.loginEmail, "private-login@example.test");
    assert.equal(response.coOwners[0].email, "private-co-owner@example.test");
    assert.equal(response.barbers[0].phone, "7777777777");
    assert.doesNotMatch(serialized, /login_password_hash|shop-hash-secret|password_hash/);
  }
});

test("development OTP requires both the explicit flag and development mode", () => {
  assert.equal(isDevOtpEnabled({ ALLOW_DEV_OTP: "true", NODE_ENV: "development" }), true);
  assert.equal(isDevOtpEnabled({ ALLOW_DEV_OTP: "false", NODE_ENV: "development" }), false);
  assert.equal(isDevOtpEnabled({ ALLOW_DEV_OTP: "true", NODE_ENV: "production" }), false);
  assert.throws(
    () => validateAuthEnvironment({ ALLOW_DEV_OTP: "true", NODE_ENV: "production" }),
    /only permitted when NODE_ENV=development/,
  );
  assert.doesNotThrow(() => validateAuthEnvironment({ ALLOW_DEV_OTP: "true", NODE_ENV: "development" }));
});

test("development OTP hashes are unusable outside explicitly enabled development", () => {
  const tagged = tagOtpHash("bcrypt-hash", true);
  assert.equal(unwrapOtpHash(tagged), "bcrypt-hash");
  assert.equal(canVerifyOtpHash(tagged, { ALLOW_DEV_OTP: "true", NODE_ENV: "development" }), true);
  assert.equal(canVerifyOtpHash(tagged, { ALLOW_DEV_OTP: "false", NODE_ENV: "production" }), false);
  assert.equal(canVerifyOtpHash("bcrypt-hash", { NODE_ENV: "production" }), true);
});

test("password-reset OTP hashes are purpose-bound and cannot be used for sign-in", () => {
  const resetHash = tagOtpHash("bcrypt-hash", true, "reset");
  const signInHash = tagOtpHash("bcrypt-hash", true, "signin");
  assert.equal(isResetOtpHash(resetHash), true);
  assert.equal(isResetOtpHash(signInHash), false);
  assert.equal(unwrapOtpHash(resetHash), "bcrypt-hash");
});

test("OTP and shop auth responses no longer expose development bypasses", () => {
  const authModel = fs.readFileSync(path.resolve(__dirname, "../src/models/authModel.js"), "utf8");
  const frontendAuth = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/hooks/useAuth.js"), "utf8");
  const authPage = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/pages/auth/Auth.jsx"), "utf8");
  assert.doesNotMatch(authModel, /devOtp\s*:/);
  assert.doesNotMatch(frontendAuth, /VITE_DEV_OTP|mock-/);
  assert.doesNotMatch(authPage, /Development OTP|devOtp/);
});

test("co-owner permissions are evaluated from the database, not JWT permission claims", async () => {
  const originalQuery = pool.query;
  pool.query = async () => [[{
    shop_id: "shop-1",
    permissions_json: { manage_upi: false },
    status: "active",
  }], []];
  try {
    const result = await runPermission(requirePermission("manage_upi"), {
      params: { id: "shop-1" },
      body: {},
      query: {},
      user: {
        sub: "co-1",
        role: "co_owner",
        shopId: "shop-1",
        permissions: { all: true },
      },
    });
    assert.equal(result.res.statusCode, 403);
    assert.equal(result.nextCalled, false);
  } finally {
    pool.query = originalQuery;
  }
});

test("inactive and cross-shop co-owners receive 403", async () => {
  const originalQuery = pool.query;
  try {
    pool.query = async () => [[{
      shop_id: "shop-1",
      permissions_json: { manage_services: true },
      status: "inactive",
    }], []];
    const inactive = await runPermission(requirePermission("manage_services"), {
      params: { id: "shop-1" },
      body: {},
      query: {},
      user: { sub: "co-1", role: "co_owner", shopId: "shop-1" },
    });
    assert.equal(inactive.res.statusCode, 403);

    pool.query = async () => [[{
      shop_id: "shop-1",
      permissions_json: { manage_services: true },
      status: "active",
    }], []];
    const crossShop = await runPermission(requirePermission("manage_services"), {
      params: { id: "shop-2" },
      body: {},
      query: {},
      user: { sub: "co-1", role: "co_owner", shopId: "shop-1" },
    });
    assert.equal(crossShop.res.statusCode, 403);
  } finally {
    pool.query = originalQuery;
  }
});

test("authorized co-owner booking action uses current database permission and booking association", async () => {
  const originalQuery = pool.query;
  let queryCount = 0;
  pool.query = async () => {
    queryCount += 1;
    return queryCount === 1
      ? [[{
          shop_id: "shop-1",
          permissions_json: JSON.stringify({ manage_queue: true }),
          status: "active",
        }], []]
      : [[{ shop_id: "shop-1" }], []];
  };
  try {
    const result = await runPermission(
      requirePermission("manage_queue", { resource: "booking" }),
      {
        params: { id: "booking-1" },
        body: {},
        query: {},
        user: {
          sub: "co-1",
          role: "co_owner",
          shopId: "shop-1",
          permissions: {},
        },
      },
    );
    assert.equal(result.nextCalled, true);
    assert.equal(result.nextError, null);
    assert.equal(queryCount, 2);
  } finally {
    pool.query = originalQuery;
  }
});

test("permission JSON supports frontend-compatible arrays and explicit wildcard grants", () => {
  assert.equal(permissionGranted(["manage_barbers"], "manage_barbers"), true);
  assert.equal(permissionGranted({ "*": true }, "manage_hours"), true);
  assert.equal(permissionGranted({ manage_hours: false }, "manage_hours"), false);
});

test("access tokens expire after twenty minutes", () => {
  const token = createAccessToken({ id: "user-1", role: "customer" }, "test-secret");
  const claims = jwt.verify(token, "test-secret");
  assert.equal(claims.exp - claims.iat, 20 * 60);
});

test("authentication middleware rejects blocked, deleted and suspended database accounts", async () => {
  const originalQuery = pool.query;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "auth-test-secret";
  const cases = [
    { role: "customer", sub: "user-1", rows: [{ id: "user-1", role: "customer", status: "blocked" }] },
    { role: "owner", sub: "missing-user", rows: [] },
    { role: "shop", sub: "shop-1", rows: [{ status: "suspended", active: 0 }] },
    { role: "co_owner", sub: "co-1", rows: [{ co_status: "inactive", shop_status: "approved", shop_active: 1 }] },
  ];
  try {
    for (const item of cases) {
      pool.query = async () => [item.rows, []];
      const req = {
        headers: {
          authorization: `Bearer ${jwt.sign({ sub: item.sub, role: item.role }, process.env.JWT_SECRET, { expiresIn: "20m" })}`,
        },
      };
      const res = mockResponse();
      let nextCalled = false;
      await auth(req, res, () => { nextCalled = true; });
      assert.equal(res.statusCode, 401);
      assert.equal(nextCalled, false);
    }

    pool.query = async () => [[{ id: "user-1", role: "customer", status: "active" }], []];
    const activeReq = {
      headers: {
        authorization: `Bearer ${jwt.sign({ sub: "user-1", role: "customer" }, process.env.JWT_SECRET, { expiresIn: "20m" })}`,
      },
    };
    const activeRes = mockResponse();
    let activeNext = false;
    await auth(activeReq, activeRes, () => { activeNext = true; });
    assert.equal(activeNext, true);
  } finally {
    pool.query = originalQuery;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});

test("API rate limiter returns 429 after the configured request limit", async () => {
  const app = express();
  app.get("/limited", createRateLimiter({ windowMs: 60_000, limit: 1 }), (_req, res) => res.send("ok"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    const url = `http://127.0.0.1:${address.port}/limited`;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 429);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("CORS allows configured origins and requires explicit non-wildcard production config", async () => {
  const corsOrigin = createCorsOriginCallback(["https://client.example"]);
  await new Promise((resolve, reject) => corsOrigin("https://client.example", (error, allowed) => error || !allowed ? reject(error || new Error("denied")) : resolve()));
  await new Promise((resolve) => corsOrigin("https://other.example", (error) => resolve(error)));
  assert.throws(() => validateCorsEnvironment({ NODE_ENV: "production", CLIENT_URL: "" }), /explicit/);
  assert.throws(() => validateCorsEnvironment({ NODE_ENV: "production", CLIENT_URL: "*" }), /explicit/);
  assert.deepEqual(validateCorsEnvironment({ NODE_ENV: "production", CLIENT_URL: "https://client.example" }), ["https://client.example"]);
});

test("strong password policy requires length and character diversity", () => {
  assert.equal(isStrongPassword("CorrectHorse7!"), true);
  assert.equal(isStrongPassword("short1!A"), false);
  assert.equal(isStrongPassword("alllowercase123!"), false);
  assert.equal(isStrongPassword("NoSymbolPassword7"), false);
  assert.equal(isStrongPassword(`LongPassword7!${"x".repeat(120)}`), false);
});

test("OTP registration responses do not reveal whether the account exists", async () => {
  const originalQuery = pool.query;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDevOtp = process.env.ALLOW_DEV_OTP;
  const originalLog = console.log;
  process.env.NODE_ENV = "development";
  process.env.ALLOW_DEV_OTP = "true";
  console.log = () => {};
  try {
    pool.query = async (sql) => {
      if (String(sql).includes("SELECT id, role FROM users"))
        return [[{ id: "user-1", role: "customer" }], []];
      return [{ affectedRows: 1 }, []];
    };
    const existing = await requestOtp({
      email: "person@example.test",
      role: "customer",
      name: "Person Name",
      password: "StrongPassword8!",
      intent: "create",
    });
    pool.query = async (sql) => {
      if (String(sql).includes("SELECT id, role FROM users")) return [[], []];
      return [{ affectedRows: 1 }, []];
    };
    const unknown = await requestOtp({
      email: "person@example.test",
      role: "customer",
      name: "Person Name",
      password: "StrongPassword8!",
      intent: "create",
    });
    assert.deepEqual(existing, unknown);
    assert.deepEqual(existing, { ok: true });
  } finally {
    pool.query = originalQuery;
    console.log = originalLog;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDevOtp === undefined) delete process.env.ALLOW_DEV_OTP;
    else process.env.ALLOW_DEV_OTP = originalDevOtp;
  }
});

test("password reset OTP cannot authenticate but can reset an active account", async () => {
  const originalQuery = pool.query;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDevOtp = process.env.ALLOW_DEV_OTP;
  const originalLog = console.log;
  process.env.NODE_ENV = "development";
  process.env.ALLOW_DEV_OTP = "true";
  let code = "";
  let storedHash = "";
  console.log = (message) => {
    code = String(message).match(/\b\d{6}\b/)?.[0] || "";
  };
  pool.query = async (sql, params = []) => {
    const statement = String(sql);
    if (statement.includes("SELECT id, role FROM users"))
      return [[{ id: "user-1", role: "customer" }], []];
    if (statement.includes("INSERT INTO otp_codes")) {
      storedHash = params[2];
      return [{ affectedRows: 1 }, []];
    }
    if (statement.includes("SELECT * FROM otp_codes"))
      return [[{ code_hash: storedHash, expires_at: new Date(Date.now() + 60_000) }], []];
    if (statement.includes("SELECT id,name,email,role,status,password_hash FROM users"))
      return [[{ id: "user-1", name: "Person Name", email: "person@example.test", role: "customer", status: "active" }], []];
    if (statement.includes("SELECT id FROM users WHERE email=?"))
      return [[{ id: "user-1" }], []];
    return [{ affectedRows: 1 }, []];
  };
  try {
    await requestOtp({ email: "person@example.test", role: "customer", intent: "forgot" });
    assert.match(storedHash, /^dev:reset:/);
    await assert.rejects(
      verifyOtp({ email: "person@example.test", role: "customer", code, intent: "signin" }),
      /Invalid or expired verification code/,
    );
    assert.deepEqual(
      await verifyOtp({ email: "person@example.test", role: "customer", code, intent: "forgot" }),
      { ok: true },
    );
    assert.deepEqual(
      await resetPassword({
        email: "person@example.test",
        role: "customer",
        code,
        password: "ResetPassword9!",
      }),
      { ok: true },
    );
  } finally {
    pool.query = originalQuery;
    console.log = originalLog;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDevOtp === undefined) delete process.env.ALLOW_DEV_OTP;
    else process.env.ALLOW_DEV_OTP = originalDevOtp;
  }
});

test("actual Express app sends Helmet security headers", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/not-found`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok(response.headers.get("content-security-policy"));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("image upload validates extension, declared MIME and file signature", async () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const validated = await validateImageFile({
    buffer: png,
    size: png.length,
    originalname: "client.png",
    mimetype: "image/png",
  });
  assert.equal(validated.mime, "image/png");
  await assert.rejects(
    validateImageFile({
      buffer: Buffer.from("MZ executable"),
      size: 13,
      originalname: "payload.jpg",
      mimetype: "image/jpeg",
    }),
    /valid JPG, PNG and WebP/,
  );
  assert.match(safeImageFilename(".png"), /^[0-9a-f-]{36}\.png$/i);
});

test("partial upload failure cleans previously uploaded remote files", async () => {
  const uploaded = [];
  const destroyed = [];
  let call = 0;
  await assert.rejects(
    uploadValidatedImages(
      [{ buffer: Buffer.from("one") }, { buffer: Buffer.from("two") }],
      [{ extension: ".png", mime: "image/png" }, { extension: ".jpg", mime: "image/jpeg" }],
      ["barber-queue/shops", "barber-queue/shops"],
      {
        upload: async (_buffer, _folder, filename) => {
          call += 1;
          if (call === 2) throw new Error("Cloudinary request failed");
          uploaded.push(filename);
          return { public_id: `barber-queue/shops/${filename}`, secure_url: "https://cdn.example/image" };
        },
        destroy: async (publicId) => destroyed.push(publicId),
      },
    ),
    /Cloudinary request failed/,
  );
  assert.equal(uploaded.length, 1);
  assert.deepEqual(destroyed, [`barber-queue/shops/${uploaded[0]}`]);
});

test("expired OTP cleanup is bounded and deletes only expired codes", async () => {
  let statement;
  const deleted = await cleanupExpiredOtpCodes(async (sql) => {
    statement = String(sql);
    return [{ affectedRows: 3 }, []];
  });
  assert.equal(deleted, 3);
  assert.match(statement, /expires_at < UTC_TIMESTAMP\(\) LIMIT 500/);
});
