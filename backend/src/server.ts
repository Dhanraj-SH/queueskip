import { env } from './config/env.js';
import app from './app.js';
import { connectDatabase } from './config/db.js';
import { connectRedis } from './config/redis.js';

const startServer = async (): Promise<void> => {
    await connectDatabase();
    await connectRedis();

    const server = app.listen(env.PORT, '0.0.0.0', () => {
        console.log(`Server running in port ${env.PORT}`);
    });

    server.on('error', (error: Error) => {
        console.error('Server failed to start:', error);
        process.exitCode = 1;
    });
};

startServer().catch((error: unknown) => {
    console.error('Server startup failed', error);
    process.exitCode = 1;
});
