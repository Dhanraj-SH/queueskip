import type { RequestHandler } from "express";
import { getUserByIdService, listUsersService } from "../service/adminService";
import { validateObjectId } from "../validators/common";
import { listUsersQuerySchema } from "../validators/admin";

export const listUsers: RequestHandler = async (req, res): Promise<void> => {
    const result = await listUsersService(listUsersQuerySchema.parse(req.query));

    res.status(200).json(result);
};

export const getUserById: RequestHandler = async (req, res): Promise<void> => {

    const userId = validateObjectId.parse(req.params.id);
    const user = await getUserByIdService(userId);

    res.status(200).json({
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
    });

};