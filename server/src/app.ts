import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { HTTPException } from 'hono/http-exception';
import { ENV } from './config.js';
import './db/connection.js';
import { auth } from './routes/auth.js';
import { papersRoute } from './routes/papers.js';
import { highlightsRoute } from './routes/highlights.js';
import { vocabRoute } from './routes/vocab.js';
import { chatRoute } from './routes/chat.js';
import { readingRoute } from './routes/reading.js';
import { imagesRoute } from './routes/images.js';
import { settingsRoute } from './routes/settings.js';

export function createApp(): Hono {
  const app = new Hono();
  app.use('*', logger());
  app.use('/api/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }));

  app.get('/api/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));
  app.route('/api/auth', auth);
  app.route('/api/papers', papersRoute);
  app.route('/api/highlights', highlightsRoute);
  app.route('/api/vocab', vocabRoute);
  app.route('/api/chat', chatRoute);
  app.route('/api/reading', readingRoute);
  app.route('/api/images', imagesRoute);
  app.route('/api/settings', settingsRoute);

  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    console.error('[Server Error]', error);
    const message = ENV.NODE_ENV === 'production' ? '服务器内部错误' : error.message || '服务器内部错误';
    return c.json({ error: message }, 500);
  });
  app.notFound((c) => c.json({ error: '接口不存在' }, 404));
  return app;
}

export const app = createApp();
