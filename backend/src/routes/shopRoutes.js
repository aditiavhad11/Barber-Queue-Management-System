import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import {
  listApproved,
  listMine,
  createShop,
  updateShop,
  updateStatus,
  resubmit,
  listAdmin,
  deleteShop,
  createBarber,
  updateBarber,
  createService,
  listServiceUnavailability,
  saveServiceUnavailability,
  removeServiceUnavailability,
  listPublicServiceUnavailability,
  listCoOwners,
  createCoOwner,
  updateCoOwner,
  deleteCoOwner,
} from "../controllers/shopController.js";
const router = Router();
router.get("/", listApproved);
router.get("/:id/service-availability", listPublicServiceUnavailability);
router.get("/mine", auth, requireRole("owner"), listMine);
router.post("/", auth, requireRole("owner"), createShop);
router.patch("/:id", auth, requireRole("owner"), updateShop);
router.post(
  "/:id/services",
  auth,
  requireRole("owner", "shop", "co_owner"),
  createService,
);
router.get(
  "/:id/services/:serviceId/unavailability",
  auth,
  requireRole("owner", "shop", "co_owner"),
  listServiceUnavailability,
);
router.post(
  "/:id/services/:serviceId/unavailability",
  auth,
  requireRole("owner", "shop", "co_owner"),
  saveServiceUnavailability,
);
router.delete(
  "/:id/services/:serviceId/unavailability/:restrictionId",
  auth,
  requireRole("owner", "shop", "co_owner"),
  removeServiceUnavailability,
);
router.post(
  "/:id/barbers",
  auth,
  requireRole("owner", "shop", "co_owner"),
  createBarber,
);
router.patch(
  "/:id/barbers/:barberId",
  auth,
  requireRole("owner", "shop", "co_owner"),
  updateBarber,
);
router.get("/:id/co-owners", auth, requireRole("owner"), listCoOwners);
router.post("/:id/co-owners", auth, requireRole("owner"), createCoOwner);
router.patch(
  "/:id/co-owners/:coOwnerId",
  auth,
  requireRole("owner"),
  updateCoOwner,
);
router.delete(
  "/:id/co-owners/:coOwnerId",
  auth,
  requireRole("owner"),
  deleteCoOwner,
);
router.patch("/:id/status", auth, requireRole("admin"), updateStatus);
router.patch("/:id/resubmit", auth, requireRole("owner"), resubmit);
router.delete("/:id", auth, requireRole("owner"), deleteShop);
router.get("/admin/all", auth, requireRole("admin"), listAdmin);
export default router;
