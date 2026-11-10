import jwt from "jsonwebtoken";

export function isDevOtpEnabled(env = process.env) {
  return env.ALLOW_DEV_OTP === "true" && env.NODE_ENV === "development";
}

export function tagOtpHash(hash, isDevelopmentOtp, purpose = "signin") {
  return `${isDevelopmentOtp ? "dev:" : ""}${purpose === "reset" ? "reset:" : ""}${hash}`;
}

export function canVerifyOtpHash(storedHash, env = process.env) {
  return !storedHash.startsWith("dev:") || isDevOtpEnabled(env);
}

export function unwrapOtpHash(storedHash) {
  return storedHash.replace(/^(?:dev:)?(?:reset:)?/, "");
}

export function isResetOtpHash(storedHash) {
  return /^(?:dev:)?reset:/.test(storedHash);
}

export function createAccessToken(user, secret = process.env.JWT_SECRET) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      ...(user.shopId ? { shopId: user.shopId } : {}),
      ...(user.permissions ? { permissions: user.permissions } : {}),
    },
    secret,
    { expiresIn: "20m" },
  );
}

export function validateAuthEnvironment(env = process.env) {
  if (env.ALLOW_DEV_OTP === "true" && env.NODE_ENV !== "development") {
    throw new Error("ALLOW_DEV_OTP=true is only permitted when NODE_ENV=development.");
  }
}
