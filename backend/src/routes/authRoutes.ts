import { Router } from 'express';
import { createUser } from '../controller/authcontroller.js';

const router = Router();

router.post('/register', createUser);

export default router;
