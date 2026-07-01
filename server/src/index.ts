import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { ENV } from './config.js';

// 初始化数据库连接（会自动创建目录）
import './db/connection.js';

// 导入路由
import { auth } from './routes/auth.js';
import { papersRoute } from './routes/papers.js';
import { highlightsRoute } from './routes/highlights.js';
import { vocabRoute } from './routes/vocab.js';
import { chatRoute } from './routes/chat.js';
import { readingRoute } from './routes/reading.js';
import { imagesRoute } from './routes/images.js';
import { settingsRoute } from './routes/settings.js';
import { startProcessingWorker, enqueuePaperProcessing } from './services/pdfProcessor.js';

const app = new Hono();

// 中间件
app.use('*', logger());
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// 健康检查
app.get('/api/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

// 路由挂载
app.route('/api/auth', auth);
app.route('/api/papers', papersRoute);
app.route('/api/highlights', highlightsRoute);
app.route('/api/vocab', vocabRoute);
app.route('/api/chat', chatRoute);
app.route('/api/reading', readingRoute);
app.route('/api/images', imagesRoute);
app.route('/api/settings', settingsRoute);

// Dev-only reprocess endpoint
app.post('/api/dev/reprocess/:paperId', (c) => {
  const paperId = c.req.param('paperId');
  enqueuePaperProcessing(paperId);
  return c.json({ ok: true, message: `Enqueued ${paperId} for reprocessing` });
});

// 全局错误处理
app.onError((err, c) => {
  console.error('[Server Error]', err);
  return c.json({ error: err.message || '服务器内部错误' }, 500);
});

// 404
app.notFound((c) => c.json({ error: '接口不存在' }, 404));

// 启动服务
console.log(`🚀 服务器启动中... (env: ${ENV.NODE_ENV})`);
console.log(`📁 数据目录: ${ENV.DATA_DIR}`);
startProcessingWorker();

serve({
  fetch: app.fetch,
  port: ENV.PORT,
}, (info) => {
  console.log(`✅ 服务器已启动: http://localhost:${info.port}`);
});

export { app };
