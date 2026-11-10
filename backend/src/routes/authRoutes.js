import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import {
  requestOtpController,
  verifyOtpController,
  resetPasswordController,
  passwordLoginController,
  shopLoginController,
  listUsersController,
} from "../controllers/authController.js";
import { authRateLimiter, otpRateLimiter } from "../middleware/rateLimit.js";

const router = Router();

router.post("/request-otp", otpRateLimiter, requestOtpController);
router.post("/verify-otp", otpRateLimiter, verifyOtpController);
router.post("/reset-password", otpRateLimiter, resetPasswordController);
router.post("/login-password", authRateLimiter, passwordLoginController);
router.post("/shop-login", authRateLimiter, shopLoginController);
router.get("/users", auth, requireRole("admin"), listUsersController);

export default router;
