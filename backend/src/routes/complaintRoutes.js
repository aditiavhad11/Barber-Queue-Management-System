import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import {
  createComplaint,
  listMyComplaints,
  listAdminComplaints,
  listOwnerComplaints,
  updateOwnerComplaintStatus,
  updateAdminComplaintStatus,
} from "../controllers/complaintController.js";

const router = Router();
router.post("/", auth, requireRole("customer"), createComplaint);
router.get("/mine", auth, requireRole("customer"), listMyComplaints);
router.get("/admin", auth, requireRole("admin"), listAdminComplaints);
router.get(
  "/owner",
  auth,
  requireRole("owner", "shop", "co_owner"),
  listOwnerComplaints,
);
router.patch(
  "/:id/status",
  auth, requireRole("owner", "shop", "co_owner"),
  updateOwnerComplaintStatus,
);
router.patch("/admin/:id/status", auth, requireRole("admin"), updateAdminComplaintStatus);
export default router;
