import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import {
  requestOtpController,
  verifyOtpController,
  passwordLoginController,
  shopLoginController,
  listUsersController,
} from "../controllers/authController.js";

const router = Router();

router.post("/request-otp", requestOtpController);
router.post("/verify-otp", verifyOtpController);
router.post("/login-password", passwordLoginController);
router.post("/shop-login", shopLoginController);
router.get("/users", auth, requireRole("admin"), listUsersController);

export default router;
