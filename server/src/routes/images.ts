/**
 * 页面图片 API 路由
 * 提供 PDF 页面渲染后的 JPEG 图片访问
 */

import { Hono } from 'hono';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { documentBlocks, pageImages } from '../db/schema.js';
import { ENV } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';

const imagesRoute = new Hono();

// 原页视觉块裁切图
imagesRoute.get('/block/:blockId', authMiddleware, async (c) => {
  const blockId = parseInt(c.req.param('blockId'), 10);
  const block = db.select().from(documentBlocks).where(eq(documentBlocks.id, blockId)).get();
  if (!block?.assetPath) return c.json({ error: '视觉块不存在' }, 404);
  const filePath = join(ENV.UPLOADS_DIR, block.assetPath);
  if (!existsSync(filePath)) return c.json({ error: '视觉资源不存在' }, 404);
  const buffer = readFileSync(filePath);
  return c.body(buffer, 200, {
    'Content-Type': 'image/png',
    'Content-Length': buffer.length.toString(),
    'Cache-Control': 'private, max-age=604800',
  });
});

// 获取论文所有页面图片列表
imagesRoute.get('/:paperId', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');

  const images = db
    .select()
    .from(pageImages)
    .where(eq(pageImages.paperId, paperId))
    .orderBy(asc(pageImages.pageNumber))
    .all();

  return c.json({
    images: images.map((img) => ({
      pageNumber: img.pageNumber,
      imageUrl: `/api/images/${paperId}/${img.pageNumber}`,
      width: img.width,
      height: img.height,
      fileSize: img.fileSize,
    })),
  });
});

// 获取指定页面图片
imagesRoute.get('/:paperId/:page', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');
  const page = parseInt(c.req.param('page'), 10);

  if (isNaN(page) || page < 1) {
    return c.json({ error: '无效的页码' }, 400);
  }

  const image = db
    .select()
    .from(pageImages)
    .where(
      and(
        eq(pageImages.paperId, paperId),
        eq(pageImages.pageNumber, page)
      )
    )
    .get();

  if (!image) {
    return c.json({ error: '页面图片不存在' }, 404);
  }

  const filePath = join(ENV.UPLOADS_DIR, image.imagePath);
  if (!existsSync(filePath)) {
    return c.json({ error: '图片文件不存在' }, 404);
  }

  const buffer = readFileSync(filePath);
  return c.body(buffer, 200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': buffer.length.toString(),
    'Cache-Control': 'public, max-age=86400',
  });
});

export { imagesRoute };
