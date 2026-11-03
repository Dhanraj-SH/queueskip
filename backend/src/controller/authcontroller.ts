import type { RequestHandler, Request } from 'express';
import { loginSchema, registerSchema } from '@queueskip/shared/contracts/auth';
import { createUserService, loginUserService, logoutSessionService, refreshSessionService } from '../service/authService';
import { clearRefreshCookie, COOKIE_NAME, setRefreshCookie } from '../utils/refreshCookie';

const readRefreshToken = (req: Request): string | undefined => {
    const fromCookie: unknown = req.cookies?.[COOKIE_NAME];
    if (typeof fromCookie === 'string' && fromCookie) {
        return fromCookie;
    }

    return undefined;
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
        const { user, accessToken, refreshToken } = await loginUserService(loginSchema.parse(req.body));

        setRefreshCookie(res, refreshToken);

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

export const refresh: RequestHandler = async (req, res): Promise<void> => {
    const refreshToken = readRefreshToken(req);

    if (!refreshToken) {
        res.status(401).json({
            message: 'Refresh token required',
        });
        return;
    }

    res.status(200).json({
        accessToken: await refreshSessionService(refreshToken),
    });
};

export const logout: RequestHandler = async (req, res): Promise<void> => {
    await logoutSessionService(readRefreshToken(req));

    clearRefreshCookie(res);

    res.status(200).json({
        message: 'Logout successful',
    });
};
