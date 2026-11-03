import type { RequestHandler } from 'express';
import { loginSchema, registerSchema } from '@queueskip/shared/contracts/auth';
import { env } from '../config/env';
import { createUserService, loginUserService } from '../service/authService';

const refreshCookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const createUser: RequestHandler = async (req, res, next): Promise<void> => {
    try {
        const user = await createUserService(registerSchema.parse(req.body));

        res.status(201).json({
            data: {
                name: user.name,
                email: user.email,
            },
            message: 'User registered',
        });
    } catch (error) {
        next(error);
    }
};

export const loginUser: RequestHandler = async (req, res, next): Promise<void> => {
    try {
        const { user, accessToken, refreshToken } = await loginUserService(
            loginSchema.parse(req.body),
        );

        res.cookie('queueskip_refresh', refreshToken, refreshCookieOptions);
        res.status(200).json({
            data: {
                name: user.name,
                email: user.email,
                accessToken,
            },
            message: 'Login successful',
        });
    } catch (error) {
        next(error);
    }
};
