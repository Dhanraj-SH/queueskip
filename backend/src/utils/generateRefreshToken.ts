import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { REFRESH_TOKEN_AGE } from './refreshCookie';

export const generateRefreshToken = (userId: string, tokenVersion: number): string => {
    return jwt.sign(
        {
            userId,
            tokenVersion
        },
        env.JWT_REFRESH_SECRET,
        {
            algorithm: "HS256",
            expiresIn: REFRESH_TOKEN_AGE / 1000
        }
    );
};