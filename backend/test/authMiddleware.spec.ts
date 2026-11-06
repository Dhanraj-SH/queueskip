import { userRole, userStatus } from '@queueskip/shared/statuses';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authDependencies = vi.hoisted(() => ({
    findUserById: vi.fn(),
    verify: vi.fn(),
}));

vi.mock('../src/repositories/userRepositories.js', () => ({
    findUserById: authDependencies.findUserById,
}));

vi.mock('jsonwebtoken', () => ({
    default: {
        verify: authDependencies.verify,
    },
}));

import express from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { authenticate } from '../src/middleware/authMiddleware.js';
import requestId from '../src/middleware/requestId.js';

const createProtectedApp = () => {
    const app = express();
    app.use(requestId);
    app.get('/protected', authenticate, (req, res) => {
        res.json({ userId: req.userId, userRole: req.userRole });
    });
    app.use(errorHandler);
    return app;
};

describe('authenticate middleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authDependencies.verify.mockReturnValue({
            userId: '0123456789abcdef01234567',
            tokenVersion: 2,
        });
        authDependencies.findUserById.mockResolvedValue({
            id: '0123456789abcdef01234567',
            status: userStatus.active,
            tokenVersion: 2,
            role: userRole.admin,
        });
    });

    it('sets the authenticated user ID and role for a valid access token', async () => {
        const response = await request(createProtectedApp())
            .get('/protected')
            .set('Authorization', 'Bearer valid-access-token');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            userId: '0123456789abcdef01234567',
            userRole: userRole.admin,
        });
        expect(authDependencies.verify).toHaveBeenCalledWith(
            'valid-access-token',
            expect.any(String),
            { algorithms: ['HS256'] },
        );
        expect(authDependencies.findUserById).toHaveBeenCalledWith('0123456789abcdef01234567');
    });

    it.each([undefined, 'Basic token', 'Bearer', 'Bearer token extra'])(
        'rejects malformed authorization header %s',
        async (authorization) => {
            const testRequest = request(createProtectedApp()).get('/protected');
            if (authorization) {
                testRequest.set('Authorization', authorization);
            }
            const response = await testRequest;

            expect(response.status).toBe(401);
            expect(authDependencies.verify).not.toHaveBeenCalled();
            expect(authDependencies.findUserById).not.toHaveBeenCalled();
        },
    );

    it('rejects a token with an invalid payload', async () => {
        authDependencies.verify.mockReturnValue({
            userId: 'not-an-object-id',
            tokenVersion: 2,
        });

        const response = await request(createProtectedApp())
            .get('/protected')
            .set('Authorization', 'Bearer valid-access-token');

        expect(response.status).toBe(401);
        expect(authDependencies.findUserById).not.toHaveBeenCalled();
    });

    it('rejects stale token versions', async () => {
        authDependencies.findUserById.mockResolvedValue({
            id: '0123456789abcdef01234567',
            status: userStatus.active,
            tokenVersion: 3,
            role: userRole.user,
        });

        const response = await request(createProtectedApp())
            .get('/protected')
            .set('Authorization', 'Bearer valid-access-token');

        expect(response.status).toBe(401);
    });

    it('rejects inactive users', async () => {
        authDependencies.findUserById.mockResolvedValue({
            id: '0123456789abcdef01234567',
            status: userStatus.suspended,
            tokenVersion: 2,
            role: userRole.user,
        });

        const response = await request(createProtectedApp())
            .get('/protected')
            .set('Authorization', 'Bearer valid-access-token');

        expect(response.status).toBe(401);
    });

    it('forwards database errors instead of converting them to 401', async () => {
        authDependencies.findUserById.mockRejectedValue(new Error('database unavailable'));
        const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await request(createProtectedApp())
            .get('/protected')
            .set('Authorization', 'Bearer valid-access-token');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server error' });
        expect(logError).toHaveBeenCalledOnce();
        logError.mockRestore();
    });
});
