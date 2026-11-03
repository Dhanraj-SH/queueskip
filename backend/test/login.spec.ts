import { beforeEach, describe, expect, it, vi } from 'vitest';

const authServices = vi.hoisted(() => ({
    createUserService: vi.fn(),
    loginUserService: vi.fn(),
    logoutSessionService: vi.fn(),
    refreshSessionService: vi.fn(),
}));

vi.mock('../src/service/authService.js', () => ({
    createUserService: authServices.createUserService,
    loginUserService: authServices.loginUserService,
    logoutSessionService: authServices.logoutSessionService,
    refreshSessionService: authServices.refreshSessionService,
}));

import request from 'supertest';
import app from '../src/app.js';

describe('POST /api/auth/login', () => {
    beforeEach(() => {
        authServices.loginUserService.mockReset();
        authServices.logoutSessionService.mockReset();
        authServices.refreshSessionService.mockReset();
    });

    it('returns an access token and sets the refresh token in an httpOnly cookie', async () => {
        authServices.loginUserService.mockResolvedValue({
            user: {
                name: 'Login User',
                email: 'login@example.test',
            },
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
        });

        const response = await request(app).post('/api/auth/login').send({
            email: 'LOGIN@EXAMPLE.TEST',
            password: 'secure-password',
        });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            data: {
                name: 'Login User',
                email: 'login@example.test',
                accessToken: 'access-token',
            },
            message: 'Login successful',
        });
        expect(response.text).not.toContain('refresh-token');

        const cookie = response.headers['set-cookie']?.[0];
        expect(cookie).toContain('queueskip_refresh=refresh-token');
        expect(cookie).toMatch(/httponly/i);
        expect(cookie).toMatch(/samesite=(lax|strict|none)/i);
        if (cookie?.match(/samesite=none/i)) {
            expect(cookie).toMatch(/secure/i);
        }
        expect(cookie).toContain('Path=/api/auth');
        expect(cookie).toContain('Max-Age=604800');
    });

    it('does not set a refresh cookie when credentials are rejected', async () => {
        authServices.loginUserService.mockRejectedValue(
            Object.assign(new Error('Invalid credentials'), { statusCode: 401 }),
        );

        const response = await request(app).post('/api/auth/login').send({
            email: 'login@example.test',
            password: 'incorrect-password',
        });

        expect(response.status).toBe(401);
        expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('rejects invalid login input', async () => {
        const response = await request(app).post('/api/auth/login').send({
            email: 'not-an-email',
            password: 'short',
        });

        expect(response.status).toBe(400);
        expect(authServices.loginUserService).not.toHaveBeenCalled();
    });

    it('reads the refresh token cookie on POST /refresh', async () => {
        authServices.refreshSessionService.mockResolvedValue('new-access-token');

        const response = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', 'queueskip_refresh=valid-refresh-token');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ accessToken: 'new-access-token' });
        expect(authServices.refreshSessionService).toHaveBeenCalledWith('valid-refresh-token');
    });

    it('does not expose a GET refresh route', async () => {
        const response = await request(app).get('/api/auth/refresh');

        expect(response.status).toBe(404);
    });

    it('logs out using the refresh cookie and clears it', async () => {
        const response = await request(app)
            .post('/api/auth/logout')
            .set('Cookie', 'queueskip_refresh=valid-refresh-token');

        expect(response.status).toBe(200);
        expect(authServices.logoutSessionService).toHaveBeenCalledWith('valid-refresh-token');
        expect(response.headers['set-cookie']?.[0]).toContain('queueskip_refresh=');
        expect(response.headers['set-cookie']?.[0]).toMatch(/expires=/i);
    });

    it('allows credentialed requests from a configured frontend origin', async () => {
        const response = await request(app)
            .post('/api/auth/refresh')
            .set('Origin', 'http://localhost:5173');

        expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
        expect(response.headers['access-control-allow-credentials']).toBe('true');
    });
});
