import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import {
  contactCustomer,
  bookingNotification,
  listMyNotifications,
} from "../controllers/notificationController.js";
const router = Router();
router.post("/contact", auth, requireRole("owner", "shop"), contactCustomer);
router.post("/booking", auth, requireRole("customer"), bookingNotification);
router.get(
  "/mine",
  auth,
  requireRole("owner", "shop", "customer"),
  listMyNotifications,
);
export default router;
