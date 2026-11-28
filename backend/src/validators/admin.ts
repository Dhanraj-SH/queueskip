import { z } from 'zod';
import { userRole, userStatus, type UserRole, type UserStatus } from '../utils/constants';

const userRoleValues = Object.values(userRole) as [UserRole, ...UserRole[]];
const userStatusValues = Object.values(userStatus) as [UserStatus, ...UserStatus[]];

export const listUsersQuerySchema = z.object({
    q: z.preprocess(
        (value) => (typeof value === 'string' ? value.trim() || undefined : value),
        z.string().min(1).max(100).optional(),
    ),
    role: z.enum(userRoleValues).optional(),
    status: z.enum(userStatusValues).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});

export const adminUsersUpdate = z.object({
    role: z.enum(userRoleValues).optional(),
    status: z.enum(userStatusValues).optional()
});

export type ListUsersQueryData = z.infer<typeof listUsersQuerySchema>;
export type UpdateUserData = z.infer<typeof adminUsersUpdate>;