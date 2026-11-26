import { Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { changeMyPassword, updateMyProfile } from "../controller/meController";

const router = Router();

router.patch("/", authenticate, updateMyProfile);
router.post("/changePassword", authenticate, changeMyPassword);

export default router;