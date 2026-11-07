import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { requireAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import archiveRoutes from './routes/archives.js';
import broadcastRoutes from './routes/broadcast.js';
import dashboardRoutes from './routes/dashboard.js';
import logRoutes from './routes/logs.js';
import pricingRoutes from './routes/pricing.js';
import tenantRoutes from './routes/tenants.js';
import unitRoutes from './routes/units.js';
import publicRoutes from './routes/public.js';
import webhookRoutes from './routes/webhooks.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigin.split(','), allowedHeaders: ['Content-Type', 'Authorization', 'X-Pay-Token'] }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/webhooks', webhookRoutes);

  // Everything below requires a staff login.
  app.use('/api', requireAuth);
  app.use('/api', dashboardRoutes);
  app.use('/api', unitRoutes);
  app.use('/api', pricingRoutes);
  app.use('/api', tenantRoutes);
  app.use('/api', archiveRoutes);
  app.use('/api', broadcastRoutes);
  app.use('/api', logRoutes);

  app.use('/api', notFoundHandler);

  // Serve the built Vue app (single-deploy mode) when it exists.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
  }

  app.use(errorHandler);
  return app;
}
