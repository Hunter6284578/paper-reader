import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { streamSSE } from 'hono/streaming';
import { db } from '../db/connection.js';
import { chatMessages } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { ftsSearch } from '../services/vectorSearch.js';
import { streamChat, buildRAGSystemPrompt } from '../services/llmService.js';
import { ENV } from '../config.js';
import { getDeepSeekConfig } from '../services/modelSettings.js';

const chatRoute = new Hono();

// 获取论文的聊天历史
chatRoute.get('/history/:paperId', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');
  const list = db.select()
    .from(chatMessages)
    .where(eq(chatMessages.paperId, paperId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(50)
    .all();

  return c.json({
    messages: list.reverse().map((m) => ({
      ...m,
      references: m.references ? JSON.parse(m.references) : [],
    })),
  });
});

// AI 问答（SSE 流式）
const askSchema = z.object({
  paperId: z.string(),
  question: z.string().min(1),
});

chatRoute.post('/ask', authMiddleware, zValidator('json', askSchema), async (c) => {
  const { paperId, question } = c.req.valid('json');

  if (!getDeepSeekConfig().apiKey) {
    return c.json({ error: 'DeepSeek API 未配置' }, 503);
  }

  // 1. FTS5 检索相关片段
  const searchResults = await ftsSearch(question, paperId, 6);

  if (searchResults.length === 0) {
    return c.json({ error: '未找到相关内容，请确保论文已完成处理' }, 404);
  }

  // 2. 构建 system prompt
  const contexts = searchResults.map((r, i) => ({
    content: r.content,
    sectionTitle: r.sectionTitle,
    pageNumber: r.pageNumber,
    blockId: r.blockId,
    index: i,
  }));

  const systemPrompt = buildRAGSystemPrompt(contexts);

  // 3. 保存用户消息
  db.insert(chatMessages).values({
    paperId,
    role: 'user',
    content: question,
  }).run();

  // 3.5 获取最近对话历史（多轮上下文）
  const history = db.select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.paperId, paperId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(8)
    .all()
    .reverse();

  // 4. SSE 流式响应
  return streamSSE(c, async (stream) => {
    let fullContent = '';

    try {
      await streamChat(
        [
          { role: 'system', content: systemPrompt },
          ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
        async (chunk) => {
          if (chunk.done) {
            // 发送完成事件，包含引用信息
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({
                references: searchResults.map((r, i) => ({
                  index: i + 1,
                  chunkId: r.chunkId,
                  blockId: r.blockId,
                  sectionTitle: r.sectionTitle,
                  pageNumber: r.pageNumber,
                  bbox: r.bbox,
                  score: r.score,
                })),
              }),
            });
          } else {
            fullContent += chunk.content;
            await stream.writeSSE({
              event: 'chunk',
              data: chunk.content,
            });
          }
        }
      );

      // 保存助手回复
      db.insert(chatMessages).values({
        paperId,
        role: 'assistant',
        content: fullContent,
        references: JSON.stringify(
          searchResults.map((r, i) => ({
            chunkId: r.chunkId, blockId: r.blockId, pageNumber: r.pageNumber,
            bbox: r.bbox, score: r.score, index: i + 1,
          }))
        ),
      }).run();
    } catch (error: any) {
      console.error('[AI问答] 流式响应错误:', error);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: error.message || 'AI 服务暂时不可用' }),
      });
    }
  });
});

// 清空聊天历史
chatRoute.delete('/history/:paperId', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');
  db.delete(chatMessages).where(eq(chatMessages.paperId, paperId)).run();
  return c.json({ success: true });
});

export { chatRoute };
