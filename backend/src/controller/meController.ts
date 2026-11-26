import { RequestHandler } from "express";
import { requireUserId } from "../middleware/authMiddleware";
import { changePassword, updateProfile } from "../validators/me";
import { changeMyPasswordService, updateMyProfileService } from "../service/meService";
import { setRefreshCookie } from "../utils/refreshCookie";

export const changeMyPassword: RequestHandler = async (req, res, next): Promise<void> => {
    try {
        const userId = requireUserId(req);
        const { accessToken, refreshToken } = await changeMyPasswordService(
            userId,
            changePassword.parse(req.body),
        );

        setRefreshCookie(res, refreshToken);

        res.status(200).json({
            data: { accessToken },
            message: "Password changed",
        });
        
    } catch (error) {
        next(error);
    }
};

export const updateMyProfile: RequestHandler = async (req, res, next): Promise<void> => {
    try{
        const userId = requireUserId(req);

        const user = await updateMyProfileService(userId, updateProfile.parse(req.body));

        if(!user){
            res.status(404).json({
                message: "User not found"
            });

            return;
        }

        res.status(200).json({
            data:{
                name: user.name,
            },
            message: "Name updated successfully"
        });
    } catch(error) {
        next(error);
    }
};