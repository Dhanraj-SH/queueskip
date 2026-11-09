export const userRole = {
    user: 'USER',
    admin: 'ADMIN',
} as const;

export type UserRole = (typeof userRole)[keyof typeof userRole];

export const userStatus = {
    active: 'ACTIVE',
    suspended: 'SUSPENDED',
    banned: 'BANNED',
} as const;

export type UserStatus = (typeof userStatus)[keyof typeof userStatus];
