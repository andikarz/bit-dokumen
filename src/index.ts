import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { healthRouter } from './modules/health/health.controller.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(requestId);

app.use('/health', healthRouter);

// TODO: Fase 5 — Document upload, scan, storage

app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`[bit-dokumen] listening on :${env.PORT} (${env.NODE_ENV})`);
});

process.on('SIGTERM', () => {
  console.log('[bit-dokumen] SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

export { app };
