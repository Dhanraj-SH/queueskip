import { Router } from 'express';
import { createUser, fetchUser, loginUser, logout, refresh } from '../controller/authcontroller.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/register', createUser);
router.post('/login', loginUser);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, fetchUser);

export default router;
