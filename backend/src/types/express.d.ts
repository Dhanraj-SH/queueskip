import 'express-serve-static-core';
import type { UserRole } from '@queueskip/shared/statuses';

declare module 'express-serve-static-core' {
    interface Request {
        requestId: string;
        userId?: string;
        userRole?: UserRole;
    }
}
