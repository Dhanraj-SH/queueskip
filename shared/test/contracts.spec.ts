import { describe, expect, it } from 'vitest';
import { holdSeatsRequestSchema, objectIdSchema } from '../contracts/hold';
import { maxSeatsPerHold } from '../limits';
import { orderStatus, seatStatus, userRole } from '../statuses';
import { errorCode } from '../errorCodes';

const validId = '507f1f77bcf86cd799439011';

describe('shared hold contract', () => {
    it('accepts a valid show and seat list', () => {
        const result = holdSeatsRequestSchema.safeParse({
            showId: validId,
            seatIds: [validId],
        });

        expect(result.success).toBe(true);
    });

    it('rejects invalid IDs, empty lists, and too many seats', () => {
        expect(objectIdSchema.safeParse('not-an-object-id').success).toBe(false);
        expect(holdSeatsRequestSchema.safeParse({ showId: validId, seatIds: [] }).success).toBe(
            false,
        );
        expect(
            holdSeatsRequestSchema.safeParse({
                showId: validId,
                seatIds: Array.from({ length: maxSeatsPerHold + 1 }, () => validId),
            }).success,
        ).toBe(false);
    });
});

describe('shared wire values', () => {
    it('exposes stable roles, statuses, and error codes', () => {
        expect(userRole.admin).toBe('ADMIN');
        expect(seatStatus.held).toBe('HELD');
        expect(orderStatus.pendingPayment).toBe('PENDING_PAYMENT');
        expect(errorCode.seatUnavailable).toBe('SEAT_UNAVAILABLE');
    });
});
