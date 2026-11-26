import { z } from "zod";

export const changePassword = z.object({
    oldPassword: z.string().min(8).max(128),
    newPassword: z.string().min(8).max(72),
});

export const updateProfile = z.object({
    name: z.string().trim().min(2).max(60)
});

export type ChangePasswordData = z.infer<typeof changePassword>;