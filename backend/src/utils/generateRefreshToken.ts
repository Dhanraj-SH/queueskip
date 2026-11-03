import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export const generateRefreshToken = (userId: string, tokenVersion: number): string => {
    return jwt.sign(
        {
            userId,
            tokenVersion
        },
        env.JWT_REFRESH_SECRET,
        {
            algorithm: "HS256",
            expiresIn: "7d"
        }
    );
};