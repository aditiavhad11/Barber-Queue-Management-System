import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createReviewSchema } from "../schemas/index.js";
import { createReview } from "../controllers/reviewController.js";

const router = Router();
router.post(
  "/",
  auth,
  requireRole("customer"),
  validate(createReviewSchema),
  createReview,
);
export default router;
