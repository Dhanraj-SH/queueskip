import { beforeEach, describe, expect, it, vi } from 'vitest';

const readiness = vi.hoisted(() => ({
    mongoReady: true,
    cacheRedisStatus: 'ready',
    criticalRedisStatus: 'ready',
}));

vi.mock('mongoose', () => ({
    default: {
        connection: {
            get readyState() {
                return readiness.mongoReady ? 1 : 0;
            },
        },
    },
}));

vi.mock('../src/config/redis.js', () => ({
    cacheRedis: {
        get status() {
            return readiness.cacheRedisStatus;
        },
    },
    criticalRedis: {
        get status() {
            return readiness.criticalRedisStatus;
        },
    },
}));

import request from 'supertest';
import express from 'express';
import app from '../src/app.js';
import requestId from '../src/middleware/requestId.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';

describe('/healthz', () => {
    it('returns 200 while the process is running', async () => {
        const response = await request(app).get('/healthz');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ data: { status: 'ok' } });
        expect(response.headers['x-request-id']).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
    });
});

describe('/readyz', () => {
    beforeEach(() => {
        readiness.mongoReady = true;
        readiness.cacheRedisStatus = 'ready';
        readiness.criticalRedisStatus = 'ready';
    });

    it('returns 200 when all dependencies are ready', async () => {
        const response = await request(app).get('/readyz');

        expect(response.status).toBe(200);
        expect(response.body.data.dependencies).toEqual({
            mongodb: 'up',
            cacheRedis: 'up',
            criticalRedis: 'up',
        });
    });

    describe('error handlers', () => {
        it('returns a generic server error without exposing internal details', async () => {
            const errorApp = express();
            errorApp.use(requestId);
            errorApp.get('/failure', (_req, _res, next) => {
                next(new Error('database password should not be exposed'));
            });
            errorApp.use(notFoundHandler);
            errorApp.use(errorHandler);

            const response = await request(errorApp).get('/failure');

            expect(response.status).toBe(500);
            expect(response.body).toEqual({ message: 'Server error' });
            expect(response.text).not.toContain('database password');
            expect(response.headers['x-request-id']).toBeTruthy();
        });

        it('returns a generic 404 for unknown routes', async () => {
            const response = await request(app).get('/not-a-route');

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ message: 'Route not found' });
        });
    });

    it('returns 503 when a dependency is down', async () => {
        readiness.cacheRedisStatus = 'end';

        const response = await request(app).get('/readyz');

        expect(response.status).toBe(503);
        expect(response.body.data.dependencies.cacheRedis).toBe('down');
    });
});
