import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

type HttpErrorLike = {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
};

const getStatus = (error: unknown): number => {
    if (error instanceof ZodError) {
        return 400;
    }

    if (typeof error === 'object' && error !== null) {
        const candidate = error as HttpErrorLike;

        if ( error instanceof Error && (error.name === 'ValidationError' || error.name === 'CastError') ) {
            return 400;
        }

        if (candidate.code === 11000) {
            return 409;
        }

        const status = candidate.statusCode ?? candidate.status;

        if ( typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ) {
            return status;
        }

        if (error instanceof SyntaxError && 'body' in error) {
            return 400;
        }
    }

    return 500;
};

const messageForStatus = (status: number): string => {
    switch (status) {
        case 400: return 'Request is invalid';
        case 401: return 'Authentication is required';
        case 403: return 'You are not allowed to perform this action';
        case 404: return 'Resource not found';
        case 409: return 'Request conflicts with the current state';
        case 413: return 'Request body is too large';
        case 422: return 'Request could not be processed';
        case 429: return 'Too many requests';
        case 503: return 'Service is temporarily unavailable';
        default: return status >= 500 ? 'Server error' : 'Request failed';
    }
};

const send = (res: Response, status: number, message: string): void => {
    res.status(status).json({ message });
};

export const errorHandler: ErrorRequestHandler = ( error: unknown, req: Request, res: Response, next ): void => {
    if (res.headersSent) {
        next(error);
        return;
    }

    const status = getStatus(error);

    if (status >= 500) {
        console.error('Request failed:', { requestId: req.requestId, error });
    }

    send(res, status, messageForStatus(status));
};

export const notFoundHandler: RequestHandler = (_req, res): void => {
    send(res, 404, 'Route not found');
};