import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userRole, userStatus } from '@queueskip/shared/statuses';
import User from '../src/models/User.js';

const testEmails = ['user-model@example.test', 'duplicate-user@example.test'];
const testMongoUri =
    process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/queueskip_test?replicaSet=rs0';

describe('User model', () => {
    beforeAll(async () => {
        await mongoose.connect(testMongoUri);
        await User.syncIndexes();
    });

    afterAll(async () => {
        await User.deleteMany({ email: { $in: testEmails } });
        await mongoose.disconnect();
    });

    it('validates required fields, name length, role, and status', async () => {
        await expect(new User({}).validate()).rejects.toThrow();
        await expect(
            new User({ name: 'A', email: 'short-name@example.test' }).validate(),
        ).rejects.toThrow();
        await expect(
            new User({
                name: 'Valid Name',
                email: 'invalid-role@example.test',
                role: 'OWNER',
            }).validate(),
        ).rejects.toThrow();
        await expect(
            new User({
                name: 'Valid Name',
                email: 'invalid-status@example.test',
                status: 'LOCKED',
            }).validate(),
        ).rejects.toThrow();
    });

    it('normalizes email and applies the documented defaults', async () => {
        const created = await User.create({
            name: '  Test Viewer  ',
            email: '  USER-MODEL@EXAMPLE.TEST  ',
        });
        const stored = await User.findById(created._id).select('+passwordHash +tokenVersion');

        expect(stored).not.toBeNull();
        expect(stored?.name).toBe('Test Viewer');
        expect(stored?.email).toBe('user-model@example.test');
        expect(stored?.emailVerified).toBe(false);
        expect(stored?.passwordHash).toBeNull();
        expect(stored?.role).toBe(userRole.user);
        expect(stored?.status).toBe(userStatus.active);
        expect(stored?.tokenVersion).toBe(0);
        expect(stored?.lastLoginAt).toBeNull();
        expect(stored?.schemaVersion).toBe(1);
        expect(stored?.createdAt).toBeInstanceOf(Date);
        expect(stored?.updatedAt).toBeInstanceOf(Date);
    });

    it('enforces unique normalized email addresses in MongoDB', async () => {
        await User.create({
            name: 'First User',
            email: 'duplicate-user@example.test',
        });

        await expect(
            User.create({
                name: 'Second User',
                email: 'DUPLICATE-USER@example.test',
            }),
        ).rejects.toMatchObject({ code: 11000 });
    });
});
