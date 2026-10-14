import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { createScheme, listManagedSchemes, listShopSchemes, updateScheme } from "../controllers/schemeController.js";

const router = Router();
router.get("/shop/:shopId", listShopSchemes);
router.get("/manage/:shopId", auth, requireRole("owner"), listManagedSchemes);
router.post("/manage/:shopId", auth, requireRole("owner"), createScheme);
router.patch("/manage/:shopId/:schemeId", auth, requireRole("owner"), updateScheme);
export default router;
