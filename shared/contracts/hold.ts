import { z } from 'zod';
import { maxSeatsPerHold } from '../limits';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID format');

export const holdSeatsRequestSchema = z.object({
    showId: objectIdSchema,
    seatIds: z.array(objectIdSchema).min(1, 'Seat IDs are required').max(maxSeatsPerHold),
});

export type HoldSeatsRequest = z.infer<typeof holdSeatsRequestSchema>;
export type HoldSeatsResponse = { holdId: string; expiresAt: string };
export type WatchlistStatusResponse = { inWatchlist: boolean };
