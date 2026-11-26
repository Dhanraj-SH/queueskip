import { z } from "zod";

export const changePassword = z.object({
    oldPassword: z.string().min(8).max(128),
    newPassword: z.string().min(8).max(72),
});

export type ChangePasswordData = z.infer<typeof changePassword>;