import { NextFunction, Request, Response } from "express";
import jwt from 'jsonwebtoken';
import { AppError } from "../utils/appError";
import { env } from "../config/env";
import { findUserById } from "../repositories/userRepositories";

export interface AuthenticatedRequest extends Request {
    userId: string;
};

export const authrnticate = async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    const authorization = req.headers.authorization;

    if(!authorization){
        next(new AppError("Authentication required", 401));
        return;
    }

    const [schema, token] = authorization.split(" ");

    if(schema !== "Bearer" || !token) {
        next(new AppError("Invalid authozization header", 401));
        return;
    }

    try {
        const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {algorithms: ["HS256"]});

        if(typeof decoded === 'string' || typeof decoded.userId !== 'string' || typeof decoded.tokenVersion !== 'number') {
            next(new AppError("Invalid token payload", 401));
            return;
        }

        const user = await findUserById(decoded.userId);

        if(!user || user.tokenVersion !== decoded.tokenVersion || user.status !== 'ACTIVE'){
            next(new AppError("Session is no longer vaild", 401));
            return;
        }

        req.userId = decoded.userId;
        next();
    } catch {
        next(new AppError("Invalid or expired token", 401));
    }
};

export const requireUserId = (req: AuthenticatedRequest): string => {
    if (!req.userId) {
        throw new AppError("Authentication required", 401);
    }

    return req.userId;
};