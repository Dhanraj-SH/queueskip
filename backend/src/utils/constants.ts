export const userRole = {
    user: 'USER',
    manager: 'MANAGER',
    admin: 'ADMIN',
} as const;

export type UserRole = (typeof userRole)[keyof typeof userRole];

export const userStatus = {
    active: 'ACTIVE',
    suspended: 'SUSPENDED',
    deleted: 'DELETED',
} as const;

export type UserStatus = (typeof userStatus)[keyof typeof userStatus];

export const movieStatus = {
    upcoming: 'UPCOMING',
    nowShowing: 'NOW_SHOWING',
    ended: 'ENDED',
} as const;

export type MovieStatus = (typeof movieStatus)[keyof typeof movieStatus];

export const errorCodes = {
    validation: 'VALIDATION_ERROR',
    unauthorized: 'UNAUTHORIZED',
    forbidden: 'FORBIDDEN',
    notFound: 'NOT_FOUND',
    conflict: 'CONFLICT',
    internal: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];

export const limits = {
    auth: {
        loginAttemptsPerMinute: 5,
        refreshTokenTtlDays: 7,
    },
    hold: {
        maxSeatsPerHold: 6,
        holdSeconds: 300,
    },
} as const;
