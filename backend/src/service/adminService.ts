import { findUserById, listUsers, updateUserById } from "../repositories/userRepositories"
import { AppError } from "../utils/appError";
import { userStatus } from "../utils/constants";
import type { ListUsersQueryData, UpdateUserData } from "../validators/admin";

export const listUsersService = async (query: ListUsersQueryData) => {
    return await listUsers(query);
};

export const getUserByIdService = async (userId: string) => {
    const user = await findUserById(userId);

    if (!user) {
        throw new AppError("User not found", 404);
    }

    return user;
};

export const updateUserService = async (userId: string, updateData: UpdateUserData, requesterId: string) => {
    if (userId === requesterId && (updateData.role !== undefined || updateData.status !== undefined)) {
        throw new AppError("An admin cannot change their own role or status", 400);
    }

    const user = await findUserById(userId);

    if(!user) {
        throw new AppError("User not found", 404);
    }

    if(user.status === userStatus.deleted) {
        throw new AppError("This action cannot be performed", 403);
    }

    if(updateData.status === userStatus.deleted){
        throw new AppError("This action cannot be performed", 403);
    }

    return await updateUserById(userId, updateData);

};