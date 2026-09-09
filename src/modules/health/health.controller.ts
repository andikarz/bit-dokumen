import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../../db/pool.js';
import { scanner } from '../scanner/clamav-scanner.js';

export const healthRouter = Router();

healthRouter.get('/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const [dbHealthy, clamavHealthy] = await Promise.all([
    checkDatabaseHealth(),
    scanner.ping()
  ]);

  if (dbHealthy && clamavHealthy) {
    res.json({
      status: 'ok',
      checks: { database: 'up', clamav: 'up' }
    });
  } else {
    res.status(503).json({
      status: 'unhealthy',
      checks: {
        database: dbHealthy ? 'up' : 'down',
        clamav: clamavHealthy ? 'up' : 'down'
      }
    });
  }
});
