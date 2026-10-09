import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { createReview } from "../controllers/reviewController.js";
const router = Router();
router.post("/", auth, requireRole("customer"), createReview);
export default router;
