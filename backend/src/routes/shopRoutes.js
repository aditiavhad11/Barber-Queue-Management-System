import { Router } from "express";
import { auth, requirePermission, requireRole } from "../middleware/auth.js";
import {
  listApproved,
  listMine,
  createShop,
  updateShop,
  listEmergencyClosures,
  endEmergencyClosure,
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
const shopUpdatePermissions = (req) => {
  const permissions = [];
  if (
    ["name", "description", "contact", "address", "location", "policy", "photos"].some(
      (field) => req.body?.[field] !== undefined,
    )
  ) {
    permissions.push("manage_profile");
  }
  if (["hours", "availability", "isOpen"].some((field) => req.body?.[field] !== undefined)) {
    permissions.push("manage_hours");
  }
  return permissions.length ? permissions : ["manage_profile"];
};

router.get("/", listApproved);

router.get("/:id/service-availability", listPublicServiceUnavailability);

router.get("/mine", auth, requireRole("owner"), listMine);

router.post("/", auth, requireRole("owner"), createShop);

router.patch(
  "/:id",
  auth,
  requireRole("owner", "shop", "co_owner"),
  requirePermission(shopUpdatePermissions),
  updateShop,
);
router.get(
  "/:id/emergency-closures",
  auth,
  requireRole("owner", "shop", "co_owner"),
  requirePermission("manage_hours"),
  listEmergencyClosures,
);
router.patch(
  "/:id/emergency-closures/:closureId/end",
  auth,
  requireRole("owner", "shop", "co_owner"),
  requirePermission("manage_hours"),
  endEmergencyClosure,
);

router.post(
  "/:id/services",
  auth,
  requireRole("owner", "shop", "co_owner"),
  requirePermission("manage_services"),
  createService,
);

router.get(
  "/:id/services/:serviceId/unavailability",
  auth,
  requireRole("owner", "shop", "co_owner"),
  requirePermission("manage_services"),
  listServiceUnavailability,
);

router.post(
  "/:id/services/:serviceId/unavailability",
  auth,
  requireRole("owner", "shop", "co_owner"),
  requirePermission("manage_services"),
  saveServiceUnavailability,
);

router.delete(
  "/:id/services/:serviceId/unavailability/:restrictionId",
  auth,
  requireRole("owner", "shop", "co_owner"),
  requirePermission("manage_services"),
  removeServiceUnavailability,
);

router.post(
  "/:id/barbers",
  auth,
  requireRole("owner", "shop", "co_owner"),
  requirePermission("manage_barbers"),
  createBarber,
);

router.patch(
  "/:id/barbers/:barberId",
  auth,
  requireRole("owner", "shop", "co_owner"),
  requirePermission("manage_barbers"),
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
