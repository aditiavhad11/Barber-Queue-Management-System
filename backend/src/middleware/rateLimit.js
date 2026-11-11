import { rateLimit } from "express-rate-limit";

export function createRateLimiter(options = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests. Please try again later." },
    ...options,
  });
}

export const apiRateLimiter = createRateLimiter();
export const authRateLimiter = createRateLimiter({ limit: 10 });
export const otpRateLimiter = createRateLimiter({ limit: 5 });
