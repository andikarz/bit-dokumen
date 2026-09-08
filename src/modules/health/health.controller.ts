import { Router, Request, Response } from 'express';
import net from 'node:net';
import { checkDatabaseHealth } from '../../db/pool.js';
import { env } from '../../config/env.js';

export const healthRouter = Router();

healthRouter.get('/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

async function checkClamav(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);

    socket.on('connect', () => {
      socket.write('PING');
    });

    socket.on('data', (data) => {
      socket.destroy();
      resolve(data.toString().includes('PONG'));
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST);
  });
}

healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const [dbHealthy, clamavHealthy] = await Promise.all([
    checkDatabaseHealth(),
    checkClamav()
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
