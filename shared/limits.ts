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
