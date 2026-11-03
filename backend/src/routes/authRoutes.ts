import { Router } from 'express';
import { createUser, loginUser, refresh } from '../controller/authcontroller.js';

const router = Router();

router.post('/register', createUser);
router.post('/login', loginUser);
router.get('/refresh', refresh);

export default router;
