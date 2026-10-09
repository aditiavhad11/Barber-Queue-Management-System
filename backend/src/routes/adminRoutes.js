import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { listAdmin } from "../controllers/shopController.js";
const router = Router();
router.get("/shops", auth, requireRole("admin"), listAdmin);
export default router;
