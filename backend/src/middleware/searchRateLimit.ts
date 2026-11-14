import type { RequestHandler } from 'express';
import { criticalRedis } from '../config/redis';

const WINDOW_SECONDS = 60;
const REQUEST_LIMIT = 60;

const incrementSearchCount = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export const searchRateLimit: RequestHandler = async (req, res, next): Promise<void> => {
    if (req.query.q === undefined) {
        next();
        return;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `rate-limit:movie-search:${ip}`;

    try {
        const count = Number(await criticalRedis.eval(incrementSearchCount, 1, key, WINDOW_SECONDS));

        if (count > REQUEST_LIMIT) {
            res.status(429).json({ message: 'Too many requests' });
            return;
        }
    } catch (error) {
        console.error('Search rate limit unavailable; allowing request', {
            requestId: req.requestId,
            error,
        });
    }

    next();
};
