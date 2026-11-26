import { Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { requireRole } from "../middleware/requireRole";
import { getUserById } from "../controller/adminController";
import { userRole } from "../utils/constants";

const router = Router();

router.get("/users/:id", authenticate, requireRole(userRole.admin), getUserById);

export default router;