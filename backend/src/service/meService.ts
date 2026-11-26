import argon2 from 'argon2';
import { changeUserPassword, findUserByIdForPasswordChange } from "../repositories/userRepositories";
import { AppError } from "../utils/appError";
import { userStatus } from "../utils/constants";
import { ChangePasswordData } from "../validators/me";
import { generateAccessToken } from "../utils/generateAccessToken";
import { generateRefreshToken } from "../utils/generateRefreshToken";

export const changeMyPasswordService = async (userId: string, password: ChangePasswordData) => {
    const user = await findUserByIdForPasswordChange(userId);

    if (!user || user.status !== userStatus.active || !user.passwordHash) {
        throw new AppError("Invalid credentials", 401);
    }

    const isMatch = await argon2.verify(user.passwordHash, password.oldPassword);

    if (!isMatch) {
        throw new AppError("Invalid credentials", 401);
    }

    const passwordHash = await argon2.hash(password.newPassword);
    const updatedUser = await changeUserPassword(userId, passwordHash);
    
    if (!updatedUser) {
        throw new AppError("User not found", 404);
    }

    return {
        accessToken: generateAccessToken(updatedUser.id, updatedUser.tokenVersion),
        refreshToken: generateRefreshToken(updatedUser.id, updatedUser.tokenVersion),
    };
};