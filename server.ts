import express from 'express';
import path from 'path';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import apiRouter from './server/src/routes/api.js';
import multiSocialRouter from './server/src/routes/multiSocialApi.js';
import { schedulerService } from './server/src/services/SchedulerService.js';
import fs from 'fs';

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();

  app.use(cors());
  app.use(cookieParser());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'YouTube AutoPilot', timestamp: new Date().toISOString() });
  });

  const uploadDir = path.resolve(process.cwd(), 'data/uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadDir));

  app.use('/api', apiRouter);
  app.use('/api', multiSocialRouter);

  schedulerService.start();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`YouTube AutoPilot server listening on port ${PORT} (0.0.0.0)`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
