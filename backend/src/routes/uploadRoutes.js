import { Router } from "express";
import multer from "multer";
import { auth, requirePermission, requireRole } from "../middleware/auth.js";
import { uploadImages } from "../controllers/uploadController.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 20, fileSize: 5 * 1024 * 1024 },
});
const uploadPermissions = (req) => {
  const folders = Array.isArray(req.body?.folders)
    ? req.body.folders
    : [req.body?.folders];
  return (folders.length ? folders : [""]).map((folder) => {
    const path = String(folder || "");
    if (path === "barber-queue/barbers") return "manage_barbers";
    if (path.endsWith("/payment")) return "manage_upi";
    return "manage_profile";
  });
};

router.post(
  "/images",
  auth,
  requireRole("owner", "shop", "co_owner"),
  upload.array("images", 20),
  requirePermission(uploadPermissions, { resource: "upload" }),
  uploadImages,
);

export default router;
