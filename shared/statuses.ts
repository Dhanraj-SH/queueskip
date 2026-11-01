export const userRole = {
    user: 'USER',
    manager: 'MANAGER',
    admin: 'ADMIN',
} as const;

export type UserRole = (typeof userRole)[keyof typeof userRole];

export const userStatus = {
    active: 'ACTIVE',
    suspended: 'SUSPENDED',
    deleted: 'DELETED'
} as const;

export type UserStatus = (typeof userStatus)[keyof typeof userStatus];

export const seatStatus = {
    available: 'AVAILABLE',
    held: 'HELD',
    sold: 'SOLD',
} as const;

export type SeatStatus = (typeof seatStatus)[keyof typeof seatStatus];

export const orderStatus = {
    pendingPayment: 'PENDING_PAYMENT',
    paid: 'PAID',
    confirmed: 'CONFIRMED',
    expired: 'EXPIRED',
    cancelled: 'CANCELLED',
    failed: 'FAILED',
    refundPending: 'REFUND_PENDING',
    refunded: 'REFUNDED',
} as const;

export type OrderStatus = (typeof orderStatus)[keyof typeof orderStatus];