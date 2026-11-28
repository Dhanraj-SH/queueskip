import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { UserRole } from './constants.js';

export const generateAccessToken = (userId: string, role: UserRole, tokenVersion: number): string => {
    return jwt.sign(
        { 
            userId, 
            role,
            tokenVersion
        }, 
        env.JWT_ACCESS_SECRET,
        {
            algorithm: "HS256",
            expiresIn: "15m"
        }
    );
};