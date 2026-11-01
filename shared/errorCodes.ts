export const errorCode = {
    badRequest: 'BAD_REQUEST',
    unauthorized: 'UNAUTHORIZED',
    forbidden: 'FORBIDDEN',
    notFound: 'NOT_FOUND',
    conflict: 'CONFLICT',
    tooManyRequests: 'TOO_MANY_REQUESTS',
    internalServerError: 'INTERNAL_SERVER_ERROR',
    invalidJson: 'INVALID_JSON',
    validationFailed: 'VALIDATION_FAILED',
    duplicateResource: 'DUPLICATE_RESOURCE',
    invalidId: 'INVALID_ID',
    seatUnavailable: 'SEAT_UNAVAILABLE',
    emailNotVerified: 'EMAIL_NOT_VERIFIED',
    rateLimited: 'RATE_LIMITED',
    holdExpired: 'HOLD_EXPIRED',
    couponInvalid: 'COUPON_INVALID',
} as const;

export type ErrorCode = (typeof errorCode)[keyof typeof errorCode];
