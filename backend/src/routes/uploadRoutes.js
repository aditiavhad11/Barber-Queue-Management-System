import { Router } from "express";
import multer from "multer";
import { auth, requireRole } from "../middleware/auth.js";
import { uploadImages } from "../controllers/uploadController.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 20, fileSize: 5 * 1024 * 1024 },
});

router.post(
  "/images",
  auth,
  requireRole("owner", "shop", "co_owner"),
  upload.array("images", 20),
  uploadImages,
);

export default router;
