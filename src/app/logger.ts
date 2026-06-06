// logger.ts
// Structured logging via Pino. Replace `console.log` calls in subsystems
// with `logger.info({...})` / `logger.warn(...)` for production observability.
// The HTTP request logger middleware is exported separately so the webhook
// routes (which need raw body) can mount it explicitly.

import pino from 'pino';
import pinoHttp from 'pino-http';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'epimage-api' },
    // Pretty-print in dev for readability; JSON lines in prod for ingestion.
    transport: isDev
        ? { target: 'pino-pretty', options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
        : undefined,
    // Redact obvious secrets if they ever sneak into a log payload.
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers["x-dev-user"]',
            'req.headers["stripe-signature"]',
            'req.headers["x-crossmint-signature"]',
            'req.headers["x-magic-secret-key"]',
        ],
        censor: '[redacted]',
    },
});

export const httpLogger = pinoHttp({
    logger,
    // Quiet by default -- only log a single completion line per request.
    serializers: {
        req: (req: any) => ({ method: req.method, url: req.url }),
        res: (res: any) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
});
