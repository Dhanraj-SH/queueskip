import type { LoginUserData, RegisterUserData } from '../validators/auth';
import argon2 from 'argon2';
import { userRole, userStatus } from '../utils/constants';
import { createUserByData, findUserByEmail, findUserByEmailForLogin, findUserById, hasAdminUser, incrementTokenVersion, type UserDocument, } from '../repositories/userRepositories';
import { env } from '../config/env';
import { AppError } from '../utils/appError';
import { generateAccessToken } from '../utils/generateAccessToken';
import { generateRefreshToken } from '../utils/generateRefreshToken';
import { verifyRefreshToken } from '../utils/verifyRefreshToken';

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
    const isFirstAdmin = userData.email === env.ADMIN_EMAIL && !(await hasAdminUser());

    return createUserByData({
        name: userData.name,
        email: userData.email,
        passwordHash,
        ...(isFirstAdmin ? { role: userRole.admin } : {}),
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

export const refreshSessionService = async (refreshToken: string): Promise<string> => {
    const decoded = verifyRefreshToken(refreshToken);
    const user = await findUserById(decoded.userId);

    if (!user || user.tokenVersion !== decoded.tokenVersion || user.status !== userStatus.active) {
        throw new AppError('Refresh token is no longer valid', 401);
    }

    return generateAccessToken(user._id.toString(), user.tokenVersion);
};

export const logoutSessionService = async (refreshToken: string | undefined): Promise<void> => {
    if (!refreshToken) {
        return;
    }

    let decoded: ReturnType<typeof verifyRefreshToken>;

    try {
        decoded = verifyRefreshToken(refreshToken);
    } catch {
        return;
    }

    const user = await findUserById(decoded.userId);

    if (user && user.tokenVersion === decoded.tokenVersion) {
        await incrementTokenVersion(user._id.toString());
    }
};

export const fetchUserService = async (userId: string) => {
    const user = await findUserById(userId);

    if (!user || user.status !== userStatus.active) {
        throw new AppError('User not found', 404);
    }

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
    };
};
