import { z } from 'zod';
import { limits } from '../utils/constants';

export const holdRequestSchema = z.object({
    showId: z.string().min(1),
    seatIds: z
        .array(z.string().min(1))
        .min(1)
        .max(limits.hold.maxSeatsPerHold),
});

export type HoldRequest = z.infer<typeof holdRequestSchema>;
