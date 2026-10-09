import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import {
  paymentQuote,
  submitPayment,
} from "../controllers/paymentController.js";
import {
  listMine,
  getMine,
  listPending,
  acceptBooking,
  declineBooking,
  getUpiSettings,
  saveUpiSettings,
  listQueue,
  setQueueStatus,
  deleteBookingHistory,
} from "../controllers/bookingController.js";

const router = Router();

router.post("/payment-quote", auth, requireRole("customer"), paymentQuote);
router.post("/payment-submit", auth, requireRole("customer"), submitPayment);

router.get("/mine", auth, requireRole("customer"), listMine);
router.get("/pending", auth, requireRole("owner", "shop"), listPending);

router.get("/upi-settings", auth, requireRole("owner", "shop"), getUpiSettings);
router.put("/upi-settings", auth, requireRole("owner", "shop"), saveUpiSettings);

router.get("/queue", auth, requireRole("customer", "owner", "shop"), listQueue);
router.patch("/:id/queue-status", auth, requireRole("customer", "owner", "shop"), setQueueStatus);
router.delete("/:id/history", auth, requireRole("owner", "shop"), deleteBookingHistory);

router.get("/:id", auth, requireRole("customer"), getMine);
router.patch("/:id/accept", auth, requireRole("owner", "shop"), acceptBooking);
router.patch("/:id/decline", auth, requireRole("owner", "shop"), declineBooking);

export default router;
