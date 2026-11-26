import { findUserById } from "../repositories/userRepositories"
import { AppError } from "../utils/appError";

export const getUserByIdService = async (userId: string) => {
    const user = await findUserById(userId);

    if (!user) {
        throw new AppError("User not found", 404);
    }

    return user;
}