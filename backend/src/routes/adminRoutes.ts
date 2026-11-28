import { Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { requireRole } from "../middleware/requireRole";
import { getUserById, listUsers, updateUser } from "../controller/adminController";
import { userRole } from "../utils/constants";

const router = Router();

router.get("/users", authenticate, requireRole(userRole.admin), listUsers);
router.get("/users/:id", authenticate, requireRole(userRole.admin), getUserById);
router.patch("/users/:id", authenticate, requireRole(userRole.admin), updateUser);

export default router;