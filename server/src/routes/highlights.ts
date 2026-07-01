import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { highlights } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';

const highlightsRoute = new Hono();

// 获取论文的所有高亮
highlightsRoute.get('/paper/:paperId', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');
  const list = db.select().from(highlights).where(eq(highlights.paperId, paperId)).all();
  return c.json({
    highlights: list.map((h) => ({
      ...h,
      position: JSON.parse(h.position),
    })),
  });
});

// 创建高亮
const createSchema = z.object({
  paperId: z.string(),
  pageNumber: z.number().optional(),
  paragraphId: z.number().optional(),
  position: z.any(),
  type: z.enum(['highlight', 'area', 'note']).optional(),
  color: z.string().optional(),
  comment: z.string().optional(),
  selectedText: z.string().optional(),
});

highlightsRoute.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json');
  const id = uuidv4();

  const highlight = db.insert(highlights).values({
    id,
    paperId: data.paperId,
    pageNumber: data.pageNumber ?? null,
    paragraphId: data.paragraphId ?? null,
    position: JSON.stringify(data.position),
    type: data.type || 'highlight',
    color: data.color || '#FFEB3B',
    comment: data.comment,
    selectedText: data.selectedText,
  }).returning().get();

  return c.json({
    ...highlight,
    position: JSON.parse(highlight.position),
  }, 201);
});

// 更新高亮（批注）
const updateSchema = z.object({
  comment: z.string().optional(),
  color: z.string().optional(),
});

highlightsRoute.patch('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id');

  const updated = db.update(highlights)
    .set({
      ...c.req.valid('json'),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(highlights.id, id))
    .returning()
    .get();

  if (!updated) {
    return c.json({ error: '高亮不存在' }, 404);
  }

  return c.json({
    ...updated,
    position: JSON.parse(updated.position),
  });
});

// 删除高亮
highlightsRoute.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  db.delete(highlights).where(eq(highlights.id, id)).run();
  return c.json({ success: true });
});

export { highlightsRoute };
