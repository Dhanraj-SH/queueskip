import argon2 from 'argon2';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import User from '../src/models/User.js';

const testEmails = ['registration@example.test', 'duplicate-registration@example.test'];
const testMongoUri =
    process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/queueskip_test?replicaSet=rs0';

describe('POST /api/auth/register', () => {
    beforeAll(async () => {
        await mongoose.connect(testMongoUri);
        await User.syncIndexes();
        await User.deleteMany({ email: { $in: testEmails } });
    });

    afterAll(async () => {
        await User.deleteMany({ email: { $in: testEmails } });
        await mongoose.disconnect();
    });

    it('creates a user and returns only public account fields', async () => {
        const password = '  secure password  ';
        const response = await request(app).post('/api/auth/register').send({
            name: '  Registration User  ',
            email: '  REGISTRATION@EXAMPLE.TEST  ',
            password,
        });

        expect(response.status).toBe(201);
        expect(response.body).toEqual({
            data: {
                name: 'Registration User',
                email: 'registration@example.test',
            },
            message: 'User registered'
        });
        expect(response.text).not.toContain('passwordHash');
        expect(response.text).not.toContain('tokenVersion');

        const stored = await User.findOne({ email: 'registration@example.test' }).select(
            '+passwordHash +tokenVersion',
        );

        expect(stored).not.toBeNull();
        expect(stored?.passwordHash).not.toBe(password);
        expect(stored?.passwordHash).toBeTruthy();

        if (!stored?.passwordHash) {
            throw new Error('Registered user did not have a password hash');
        }

        expect(await argon2.verify(stored.passwordHash, password)).toBe(true);
    });

    it('rejects duplicate email addresses with a conflict response', async () => {
        await User.create({
            name: 'Existing User',
            email: 'duplicate-registration@example.test',
            passwordHash: 'existing-hash',
        });

        const response = await request(app).post('/api/auth/register').send({
            name: 'Another User',
            email: 'DUPLICATE-REGISTRATION@EXAMPLE.TEST',
            password: 'secure-password',
        });

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
            message: 'Request conflicts with the current state',
        });
        expect(await User.countDocuments({ email: 'duplicate-registration@example.test' })).toBe(1);
    });
});
