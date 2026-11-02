import type { RegisterUserData } from '@queueskip/shared/contracts/auth';
import argon2 from 'argon2';
import { createUserByData, findUserByEmail } from '../repositories/userRepositories';

class ConflictError extends Error {
    readonly statusCode = 409;

    constructor(message: string) {
        super(message);
        this.name = 'ConflictError';
    }
}

export const createUserService = async (userData: RegisterUserData) => {
    const user = await findUserByEmail(userData.email);

    if (user) {
        throw new ConflictError('Email already registered');
    }

    const passwordHash = await argon2.hash(userData.password);

    return createUserByData({
        name: userData.name,
        email: userData.email,
        passwordHash,
    });
};
