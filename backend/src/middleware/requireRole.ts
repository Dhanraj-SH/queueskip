import type { RequestHandler } from 'express';
import type { UserRole } from '../utils/constants';
import { AppError } from '../utils/appError';

export const requireRole = (...allowedRoles: UserRole[]): RequestHandler => {
    return (req, _res, next): void => {
        if (!req.userRole || !allowedRoles.includes(req.userRole)) {
            next(new AppError('You are not allowed to perform this action', 403));
            return;
        }

        next();
    };
};
