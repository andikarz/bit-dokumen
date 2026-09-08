import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.headers['x-request-id'] as string || 'unknown';

  console.error(JSON.stringify({
    level: 'error',
    requestId,
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString(),
  }));

  const statusCode = (err as any).statusCode || 500;
  const code = (err as any).code || 'INTERNAL_ERROR';

  res.status(statusCode).json({
    error: {
      code,
      message: statusCode === 500 ? 'Internal server error' : err.message,
      fields: (err as any).fields || undefined,
    },
    requestId,
  });
}
