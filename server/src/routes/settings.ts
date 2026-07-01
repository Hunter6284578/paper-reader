import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth.js';
import { getDeepSeekConfig, getMaskedDeepSeekSettings, saveDeepSeekSettings } from '../services/modelSettings.js';
import { chatCompletion } from '../services/llmService.js';

const settingsRoute = new Hono();
settingsRoute.use('*', authMiddleware);

settingsRoute.get('/ai', (c) => c.json(getMaskedDeepSeekSettings()));

const updateSchema = z.object({
  apiKey: z.string().min(8).optional(),
  model: z.string().min(1).max(100).default('deepseek-chat'),
});

settingsRoute.put('/ai', zValidator('json', updateSchema), async (c) => {
  const { apiKey, model } = c.req.valid('json');
  saveDeepSeekSettings(apiKey, model);
  return c.json(getMaskedDeepSeekSettings());
});

settingsRoute.post('/ai/test', async (c) => {
  const config = getDeepSeekConfig();
  if (!config.apiKey) return c.json({ error: '请先保存 DeepSeek API Key' }, 400);
  const answer = await chatCompletion([
    { role: 'user', content: '只回复 OK' },
  ], { maxTokens: 8, temperature: 0 });
  return c.json({ success: true, message: answer.trim() || 'OK' });
});

export { settingsRoute };
