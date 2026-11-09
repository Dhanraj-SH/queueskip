import { z } from 'zod';

export const holdRequestSchema = z.object({
    showId: z.string().min(1),
    seatIds: z.array(z.string().min(1)).min(1).max(6),
});

export type HoldRequest = z.infer<typeof holdRequestSchema>;
