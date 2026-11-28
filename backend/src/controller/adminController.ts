import type { RequestHandler } from "express";
import { getUserByIdService, listUsersService, updateUserService } from "../service/adminService";
import { validateObjectId } from "../validators/common";
import { adminUsersUpdate, listUsersQuerySchema } from "../validators/admin";
import { requireUserId } from "../middleware/authMiddleware";

export const listUsers: RequestHandler = async (req, res): Promise<void> => {
    const result = await listUsersService(listUsersQuerySchema.parse(req.query));

    res.status(200).json(result);
};

export const getUserById: RequestHandler = async (req, res, next): Promise<void> => {
    try{
        const userId = validateObjectId.parse(req.params.id);
        const user = await getUserByIdService(userId);
    
        if (!user) {
            res.status(404).json({ message: "User not found" });
            return;
        }
    
        res.status(200).json({
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
        });
    } catch(error) {
        next(error)
    }
};

export const updateUser: RequestHandler = async(req, res, next): Promise<void> => {
    try{
        const userId = validateObjectId.parse(req.params.id);
    
        const user = await updateUserService(
            userId,
            adminUsersUpdate.parse(req.body),
            requireUserId(req),
        );
    
        if (!user) {
            res.status(404).json({ message: "User not found" });
            return;
        }
    
        res.status(200).json({
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
        });
    } catch(error) {
        next(error);
    }
}