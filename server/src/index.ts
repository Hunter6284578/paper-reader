import { serve } from '@hono/node-server';
import { ENV } from './config.js';
import { app } from './app.js';
import { startProcessingWorker } from './services/pdfProcessor.js';

console.log(`🚀 服务器启动中... (env: ${ENV.NODE_ENV})`);
console.log(`📁 数据目录: ${ENV.DATA_DIR}`);
startProcessingWorker();

serve({
  fetch: app.fetch,
  port: ENV.PORT,
  hostname: '0.0.0.0',
}, (info) => {
  console.log(`✅ 服务器已启动: http://localhost:${info.port}`);
});

export { app };
