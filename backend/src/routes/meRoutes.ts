import { Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { changeMyPassword } from "../controller/meController";

const router = Router();

router.post("/changePassword", authenticate, changeMyPassword);

export default router;