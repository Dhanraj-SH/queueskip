import type { LoginUserData, RegisterUserData } from '@queueskip/shared/contracts/auth';
import argon2 from 'argon2';
import { userStatus } from '@queueskip/shared/statuses';
import {
    createUserByData,
    findUserByEmail,
    findUserByEmailForLogin,
    type UserDocument,
} from '../repositories/userRepositories';
import { AppError } from '../utils/appError';
import { generateAccessToken } from '../utils/generateAccessToken';
import { generateRefreshToken } from '../utils/generateRefreshToken';

const issueToken = (user: UserDocument) => {
    return {
        user: {
            name: user.name,
            email: user.email,
        },
        accessToken: generateAccessToken(user.id, user.tokenVersion),
        refreshToken: generateRefreshToken(user.id, user.tokenVersion),
    };
};

export const createUserService = async (userData: RegisterUserData) => {
    const user = await findUserByEmail(userData.email);

    if (user) {
        throw new AppError('Email already registered', 409);
    }

    const passwordHash = await argon2.hash(userData.password);

    return createUserByData({
        name: userData.name,
        email: userData.email,
        passwordHash,
    });
};

export const loginUserService = async (loginData: LoginUserData) => {
    const user = await findUserByEmailForLogin(loginData.email);

    if (!user?.passwordHash || user.status !== userStatus.active) {
        throw new AppError('Invalid credentials', 401);
    }

    const passwordValid = await argon2.verify(user.passwordHash, loginData.password);

    if (!passwordValid) {
        throw new AppError('Invalid credentials', 401);
    }

    user.lastLoginAt = new Date();
    await user.save();

    return issueToken(user);
};
