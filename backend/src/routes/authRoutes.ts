import { Router } from 'express';
import { createUser, loginUser, logout, refresh } from '../controller/authcontroller.js';

const router = Router();

router.post('/register', createUser);
router.post('/login', loginUser);
router.post('/refresh', refresh);
router.post('/logout', logout);

export default router;
