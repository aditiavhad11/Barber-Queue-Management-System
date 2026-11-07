import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createComplaintSchema,
  updateComplaintStatusSchema,
} from "../schemas/index.js";
import {
  createComplaint,
  listMyComplaints,
  listAdminComplaints,
  listOwnerComplaints,
  updateOwnerComplaintStatus,
  updateAdminComplaintStatus,
} from "../controllers/complaintController.js";

const router = Router();
router.post(
  "/",
  auth,
  requireRole("customer"),
  validate(createComplaintSchema),
  createComplaint,
);
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
  auth,
  requireRole("owner", "shop", "co_owner"),
  validate(updateComplaintStatusSchema),
  updateOwnerComplaintStatus,
);
router.patch(
  "/admin/:id/status",
  auth,
  requireRole("admin"),
  validate(updateComplaintStatusSchema),
  updateAdminComplaintStatus,
);
export default router;
