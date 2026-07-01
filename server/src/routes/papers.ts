import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { mkdirSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../db/connection.js';
import { papers } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { ENV } from '../config.js';
import { enqueuePaperProcessing } from '../services/pdfProcessor.js';

const papersRoute = new Hono();

// 确保目录存在
mkdirSync(ENV.PAPERS_DIR, { recursive: true });
mkdirSync(ENV.UPLOADS_DIR, { recursive: true });

// 获取论文列表
papersRoute.get('/', authMiddleware, async (c) => {
  const list = db.select().from(papers).orderBy(desc(papers.createdAt)).all();
  return c.json({
    papers: list.map((p) => ({
      ...p,
      authors: p.authors ? JSON.parse(p.authors) : [],
      tags: p.tags ? JSON.parse(p.tags) : [],
    })),
  });
});

// 获取单篇论文
papersRoute.get('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const paper = db.select().from(papers).where(eq(papers.id, id)).get();
  if (!paper) {
    return c.json({ error: '论文不存在' }, 404);
  }
  return c.json({
    ...paper,
    authors: paper.authors ? JSON.parse(paper.authors) : [],
    tags: paper.tags ? JSON.parse(paper.tags) : [],
  });
});

// 提供 PDF 文件访问
papersRoute.get('/:id/file', async (c) => {
  const id = c.req.param('id');
  const paper = db.select().from(papers).where(eq(papers.id, id)).get();
  if (!paper) {
    return c.json({ error: '论文不存在' }, 404);
  }

  const filePath = join(ENV.PAPERS_DIR, paper.filePath);
  if (!existsSync(filePath)) {
    return c.json({ error: '文件不存在' }, 404);
  }

  const buffer = readFileSync(filePath);
  return c.body(buffer, 200, {
    'Content-Type': 'application/pdf',
    'Content-Length': buffer.length.toString(),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  });
});

// 上传论文
papersRoute.post('/upload', authMiddleware, async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!(file instanceof File)) {
    return c.json({ error: '请上传 PDF 文件' }, 400);
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return c.json({ error: '仅支持 PDF 格式' }, 400);
  }

  const id = uuidv4();
  const fileName = `${id}.pdf`;
  const filePath = join(ENV.PAPERS_DIR, fileName);

  // 保存文件
  const buffer = Buffer.from(await file.arrayBuffer());
  const { writeFileSync } = await import('fs');
  writeFileSync(filePath, buffer);

  // 提取标题（去除 .pdf 后缀）
  const title = body['title'] as string || file.name.replace(/\.pdf$/i, '');

  // 创建论文记录
  const paper = db.insert(papers).values({
    id,
    title,
    filePath: fileName,
    fileSize: file.size,
    processingStatus: 'pending',
  }).returning().get();

  // 异步处理论文（提取文本、分块、向量化）
  enqueuePaperProcessing(id);

  return c.json({
    ...paper,
    authors: [],
    tags: [],
  }, 201);
});

// 更新论文信息
const updateSchema = z.object({
  title: z.string().optional(),
  abstract: z.string().optional(),
  authors: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['unread', 'reading', 'finished']).optional(),
});

papersRoute.patch('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const paper = db.select().from(papers).where(eq(papers.id, id)).get();
  if (!paper) {
    return c.json({ error: '论文不存在' }, 404);
  }

  const updated = db.update(papers)
    .set({
      ...data,
      authors: data.authors ? JSON.stringify(data.authors) : undefined,
      tags: data.tags ? JSON.stringify(data.tags) : undefined,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(papers.id, id))
    .returning()
    .get();

  return c.json({
    ...updated,
    authors: updated.authors ? JSON.parse(updated.authors) : [],
    tags: updated.tags ? JSON.parse(updated.tags) : [],
  });
});

// 重新处理论文
papersRoute.post('/:id/reprocess', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const paper = db.select().from(papers).where(eq(papers.id, id)).get();
  if (!paper) {
    return c.json({ error: '论文不存在' }, 404);
  }

  // 重置状态
  db.update(papers)
    .set({
      processingStatus: 'pending',
      paragraphStatus: 'pending',
      processingError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(papers.id, id))
    .run();

  // 触发重新处理
  enqueuePaperProcessing(id);

  return c.json({ success: true, message: '论文正在重新处理' });
});

// 删除论文
papersRoute.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const paper = db.select().from(papers).where(eq(papers.id, id)).get();
  if (!paper) {
    return c.json({ error: '论文不存在' }, 404);
  }

  // 删除文件
  const filePath = join(ENV.PAPERS_DIR, paper.filePath);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  // 数据库记录会因 CASCADE 自动删除关联数据
  db.delete(papers).where(eq(papers.id, id)).run();

  return c.json({ success: true });
});

export { papersRoute };
