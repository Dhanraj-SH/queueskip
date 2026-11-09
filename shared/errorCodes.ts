export const errorCodes = {
    validation: 'VALIDATION_ERROR',
    unauthorized: 'UNAUTHORIZED',
    forbidden: 'FORBIDDEN',
    notFound: 'NOT_FOUND',
    conflict: 'CONFLICT',
    internal: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];
