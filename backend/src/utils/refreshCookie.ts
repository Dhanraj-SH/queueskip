import { CookieOptions, type Response } from "express";
import { env } from "../config/env";

export const COOKIE_NAME = 'queueskip_refresh';
export const REFRESH_TOKEN_AGE = 7 * 24 * 60 * 60 * 1000;

const baseOptions = (): CookieOptions => ({
    httpOnly: true,
    secure: env.NODE_ENV === 'production' || env.COOKIE_SAME_SITE === 'none',
    sameSite: env.COOKIE_SAME_SITE,
    ...(env.COOKIE_DOMAIN ? {domain: env.COOKIE_DOMAIN}: {}),
    path: '/api/auth',
});

export const setRefreshCookie = (res: Response, token: string): void => {
    res.cookie(COOKIE_NAME, token, {...baseOptions(), maxAge: REFRESH_TOKEN_AGE});
};

export const clearRefreshCookie = (res: Response): void => {
    res.clearCookie(COOKIE_NAME, baseOptions());
}