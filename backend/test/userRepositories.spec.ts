import { beforeEach, describe, expect, it, vi } from 'vitest';

const userModel = vi.hoisted(() => ({
    findOne: vi.fn(),
}));

vi.mock('../src/models/User.js', () => ({
    default: userModel,
}));

import { findUserByEmailForLogin } from '../src/repositories/userRepositories.js';

describe('findUserByEmailForLogin', () => {
    beforeEach(() => {
        userModel.findOne.mockReset();
    });

    it('selects hidden password and token version fields for authentication', async () => {
        const user = { email: 'login@example.test' };
        const select = vi.fn().mockResolvedValue(user);
        userModel.findOne.mockReturnValue({ select });

        await expect(findUserByEmailForLogin('login@example.test')).resolves.toBe(user);

        expect(userModel.findOne).toHaveBeenCalledWith({ email: 'login@example.test' });
        expect(select).toHaveBeenCalledWith('+passwordHash +tokenVersion');
    });
});
