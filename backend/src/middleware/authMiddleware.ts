import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { userStatus } from '../utils/constants';
import { findUserById } from '../repositories/userRepositories';
import { env } from '../config/env';
import { AppError } from '../utils/appError';

const isAccessTokenPayload = ( payload: string | jwt.JwtPayload ): payload is jwt.JwtPayload & { userId: string; tokenVersion: number } =>
    typeof payload !== 'string' &&
    typeof payload.userId === 'string' &&
    /^[a-f\d]{24}$/i.test(payload.userId) &&
    typeof payload.tokenVersion === 'number' &&
    Number.isInteger(payload.tokenVersion) &&
    payload.tokenVersion >= 0;

export const authenticate: RequestHandler = async (req, _res, next): Promise<void> => {
    const [scheme, token, ...extraParts] = req.get('authorization')?.trim().split(/\s+/) ?? [];

    if (scheme?.toLowerCase() !== 'bearer' || !token || extraParts.length > 0) {
        next(new AppError('Authentication is required', 401));
        return;
    }

    let payload: string | jwt.JwtPayload;

    try {
        payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    } catch {
        next(new AppError('Invalid or expired access token', 401));
        return;
    }

    if (!isAccessTokenPayload(payload)) {
        next(new AppError('Invalid access token payload', 401));
        return;
    }

    try {
        const user = await findUserById(payload.userId);

        if (
            !user ||
            user.tokenVersion !== payload.tokenVersion ||
            user.status !== userStatus.active
        ) {
            next(new AppError('Session is no longer valid', 401));
            return;
        }

        req.userId = user.id;
        req.userRole = user.role;
        next();
    } catch (error) {
        next(error);
    }
};

export const requireUserId = (req: Request): string => {
    if (!req.userId) {
        throw new AppError('Authentication is required', 401);
    }

    return req.userId;
};
