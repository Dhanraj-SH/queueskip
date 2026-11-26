import { RequestHandler } from "express";
import { requireUserId } from "../middleware/authMiddleware";
import { changePassword } from "../validators/me";
import { changeMyPasswordService } from "../service/meService";
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