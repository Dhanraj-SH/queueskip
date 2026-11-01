import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { cacheRedis, criticalRedis } from './config/redis.js';
import requestId from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

app.use(requestId);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/healthz', (_req, res) => {
    res.status(200).json({ data: { status: 'ok' } });
});

app.get('/readyz', (_req, res) => {
    const mongoReady = mongoose.connection.readyState === 1;
    const cacheRedisReady = cacheRedis.status === 'ready';
    const criticalRedisReady = criticalRedis.status === 'ready';

    const check = mongoReady && cacheRedisReady && criticalRedisReady;

    res.status(check ? 200 : 503).json({
        data: {
            status: check ? 'ok' : 'error',
            dependencies: {
                mongodb: mongoReady ? 'up' : 'down',
                cacheRedis: cacheRedisReady ? 'up' : 'down',
                criticalRedis: criticalRedisReady ? 'up' : 'down',
            },
        },
    });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
