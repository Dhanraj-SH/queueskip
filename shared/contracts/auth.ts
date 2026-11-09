import { z } from 'zod';

export const registerSchema = z.object({
    name: z.string().trim().min(2).max(60),
    email: z.email().trim(),
    password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
});

export type RegisterUserData = z.infer<typeof registerSchema>;
export type LoginUserData = z.infer<typeof loginSchema>;
