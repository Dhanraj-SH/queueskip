import { findUserById, listUsers } from "../repositories/userRepositories"
import { AppError } from "../utils/appError";
import type { ListUsersQuery } from "../validators/admin";

export const listUsersService = async (query: ListUsersQuery) => {
    return await listUsers(query);
};

export const getUserByIdService = async (userId: string) => {
    const user = await findUserById(userId);

    if (!user) {
        throw new AppError("User not found", 404);
    }

    return user;
}