import 'express-serve-static-core';
import type { UserRole } from '../utils/constants';

declare module 'express-serve-static-core' {
    interface Request {
        requestId: string;
        userId?: string;
        userRole?: UserRole;
    }
}
