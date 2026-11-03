import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const generateAccessToken = (userId: string, tokenVersion: number): string => {
    return jwt.sign(
        { 
            userId, 
            tokenVersion
        }, 
        env.JWT_ACCESS_SECRET,
        {
            algorithm: "HS256",
            expiresIn: "15m"
        }
    );
};