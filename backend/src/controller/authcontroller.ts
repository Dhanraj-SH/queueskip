import type { RequestHandler, Request } from 'express';
import { loginSchema, registerSchema } from '@queueskip/shared/contracts/auth';
import { env } from '../config/env';
import { createUserService, loginUserService, refreshSessionService } from '../service/authService';
import { COOKIE_NAME, REFRESH_TOKEN_AGE, setRefreshCookie } from '../utils/refreshCookie';

const refreshCookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_AGE,
};

const readRefreshToken = (req: Request): string | undefined => {
    const fromCookie: unknown = req.cookies?.[COOKIE_NAME];
    if(typeof fromCookie === 'string' && fromCookie){
        return fromCookie;
    }

    const fromBody: unknown = req.body?.refreshToken;
    return typeof fromBody === "string" && fromBody ? fromBody : undefined;
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

export const refresh: RequestHandler = async(req, res, next): Promise<void> => {
    const refreshToken = readRefreshToken(req);

    if(!refreshToken){
        res.status(401).json({
            message: "Refresh token required"
        });
        return;
    }
    
    res.status(200).json({
        accessToken: await refreshSessionService(refreshToken)
    });
};