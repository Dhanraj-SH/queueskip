import { z } from 'zod';

export const registerSchema = z.object({
    name: z.string().trim().min(2).max(60),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(8).max(50),
});

export type RegisterUserData = z.infer<typeof registerSchema>;
