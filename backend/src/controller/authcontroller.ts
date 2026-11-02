import type { RequestHandler } from 'express';
import { registerSchema } from '@queueskip/shared/contracts/auth';
import { createUserService } from '../service/authService';

export const createUser: RequestHandler = async (req, res, next): Promise<void> => {
    try {
        const user = await createUserService(registerSchema.parse(req.body));

        res.status(201).json({
            data: {
                name: user.name,
                email: user.email,
            },
        });
    } catch (error) {
        next(error);
    }
};
