import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import {
  paymentQuote,
  submitPayment,
} from "../controllers/paymentController.js";
import {
  listMine,
  listRefunds,
  listClosureResolutions,
  getMine,
  listPending,
  listPrebookings,
  takePrebooking,
  acceptBooking,
  declineBooking,
  getUpiSettings,
  saveUpiSettings,
  listQueue,
  setQueueStatus,
  deleteBookingHistory,
  requestServiceEdit,
  listMyServiceEdits,
  listPendingServiceEdits,
  resolveServiceEdit,
} from "../controllers/bookingController.js";

const router = Router();

router.post("/payment-quote", auth, requireRole("customer"), paymentQuote);
router.post("/payment-submit", auth, requireRole("customer"), submitPayment);

router.get("/mine", auth, requireRole("customer"), listMine);
router.get("/refunds", auth, requireRole("customer"), listRefunds);
router.get(
  "/closure-resolutions",
  auth,
  requireRole("owner", "shop", "co_owner"),
  listClosureResolutions,
);
router.get(
  "/pending",
  auth,
  requireRole("owner", "shop", "co_owner"),
  listPending,
);
router.get(
  "/prebookings",
  auth,
  requireRole("owner", "shop", "co_owner"),
  listPrebookings,
);

router.get(
  "/upi-settings",
  auth,
  requireRole("owner", "shop", "co_owner"),
  getUpiSettings,
);
router.put(
  "/upi-settings",
  auth,
  requireRole("owner", "shop", "co_owner"),
  saveUpiSettings,
);

router.get(
  "/queue",
  auth,
  requireRole("customer", "owner", "shop", "co_owner"),
  listQueue,
);
router.get("/service-edits/mine", auth, requireRole("customer"), listMyServiceEdits);
router.get("/service-edits/pending", auth, requireRole("owner", "shop", "co_owner"), listPendingServiceEdits);
router.patch("/service-edits/:editId", auth, requireRole("owner", "shop", "co_owner"), resolveServiceEdit);
router.post("/:id/service-edits", auth, requireRole("customer"), requestServiceEdit);
router.patch(
  "/:id/queue-status",
  auth,
  requireRole("customer", "owner", "shop", "co_owner"),
  setQueueStatus,
);
router.delete(
  "/:id/history",
  auth,
  requireRole("owner", "shop", "co_owner"),
  deleteBookingHistory,
);

router.get("/:id", auth, requireRole("customer"), getMine);
router.patch(
  "/:id/accept",
  auth,
  requireRole("owner", "shop", "co_owner"),
  acceptBooking,
);
router.patch(
  "/:id/take-into-queue",
  auth,
  requireRole("owner", "shop", "co_owner"),
  takePrebooking,
);
router.patch(
  "/:id/decline",
  auth,
  requireRole("owner", "shop", "co_owner"),
  declineBooking,
);

export default router;
