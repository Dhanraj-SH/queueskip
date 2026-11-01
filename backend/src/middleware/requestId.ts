import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const requestId: RequestHandler = (req, res, next) => {
    const id = randomUUID();

    req.requestId = id;
    res.setHeader('X-Request-Id', id);

    next();
};

export default requestId;
