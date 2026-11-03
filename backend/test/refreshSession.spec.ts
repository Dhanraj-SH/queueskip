import { userStatus } from '@queueskip/shared/statuses';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authDependencies = vi.hoisted(() => ({
    createUserByData: vi.fn(),
    findUserByEmail: vi.fn(),
    findUserByEmailForLogin: vi.fn(),
    findUserById: vi.fn(),
    generateAccessToken: vi.fn(),
    generateRefreshToken: vi.fn(),
    verifyRefreshToken: vi.fn(),
}));

vi.mock('../src/repositories/userRepositories.js', () => ({
    createUserByData: authDependencies.createUserByData,
    findUserByEmail: authDependencies.findUserByEmail,
    findUserByEmailForLogin: authDependencies.findUserByEmailForLogin,
    findUserById: authDependencies.findUserById,
}));

vi.mock('../src/utils/generateAccessToken.js', () => ({
    generateAccessToken: authDependencies.generateAccessToken,
}));

vi.mock('../src/utils/generateRefreshToken.js', () => ({
    generateRefreshToken: authDependencies.generateRefreshToken,
}));

vi.mock('../src/utils/verifyRefreshToken.js', () => ({
    verifyRefreshToken: authDependencies.verifyRefreshToken,
}));

import { refreshSessionService } from '../src/service/authService.js';

describe('refreshSessionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authDependencies.verifyRefreshToken.mockReturnValue({
            userId: 'user-id',
            tokenVersion: 3,
        });
        authDependencies.generateAccessToken.mockReturnValue('new-access-token');
    });

    it('issues an access token for an active user with the matching token version', async () => {
        authDependencies.findUserById.mockResolvedValue({
            _id: { toString: () => 'user-id' },
            status: userStatus.active,
            tokenVersion: 3,
        });

        await expect(refreshSessionService('valid-refresh-token')).resolves.toBe(
            'new-access-token',
        );

        expect(authDependencies.findUserById).toHaveBeenCalledWith('user-id');
        expect(authDependencies.generateAccessToken).toHaveBeenCalledWith('user-id', 3);
    });

    it('rejects a user whose token version no longer matches', async () => {
        authDependencies.findUserById.mockResolvedValue({
            _id: { toString: () => 'user-id' },
            status: userStatus.active,
            tokenVersion: 4,
        });

        await expect(refreshSessionService('old-refresh-token')).rejects.toMatchObject({
            statusCode: 401,
        });
        expect(authDependencies.generateAccessToken).not.toHaveBeenCalled();
    });

    it.each([userStatus.suspended, userStatus.deleted])(
        'rejects a user with status %s',
        async (status) => {
            authDependencies.findUserById.mockResolvedValue({
                _id: { toString: () => 'user-id' },
                status,
                tokenVersion: 3,
            });

            await expect(refreshSessionService('valid-refresh-token')).rejects.toMatchObject({
                statusCode: 401,
            });
            expect(authDependencies.generateAccessToken).not.toHaveBeenCalled();
        },
    );

    it('rejects a refresh token for a user that no longer exists', async () => {
        authDependencies.findUserById.mockResolvedValue(null);

        await expect(refreshSessionService('orphaned-refresh-token')).rejects.toMatchObject({
            statusCode: 401,
        });
        expect(authDependencies.generateAccessToken).not.toHaveBeenCalled();
    });
});
