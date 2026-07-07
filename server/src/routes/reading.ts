/**
 * 阅读 API 路由
 * 提供论文结构化段落查询、翻译等功能
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, gte, lt, asc, inArray, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { documentBlocks, translations, papers, userSettings, readingSessions } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { translateBlocks } from '../services/translationService.js';

const readingRoute = new Hono();

// 获取论文结构目录
readingRoute.get('/:paperId/structure', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');

  const paper = db.select().from(papers).where(eq(papers.id, paperId)).get();
  if (!paper) {
    return c.json({ error: '论文不存在' }, 404);
  }

  const blockRows = db.select({
    sectionTitle: documentBlocks.sectionTitle,
    blockIndex: documentBlocks.blockIndex,
    blockType: documentBlocks.blockType,
  }).from(documentBlocks).where(eq(documentBlocks.paperId, paperId))
    .orderBy(asc(documentBlocks.blockIndex)).all();

  if (blockRows.length > 0) {
    const sections: Array<{ sectionTitle: string; paragraphCount: number; startIndex: number }> = [];
    let current = '';
    for (const block of blockRows) {
      const title = block.sectionTitle || 'Full Text';
      if (title !== current) {
        sections.push({ sectionTitle: title, paragraphCount: 0, startIndex: block.blockIndex });
        current = title;
      }
      if (block.blockType === 'text') sections[sections.length - 1].paragraphCount++;
    }
    return c.json({
      sections,
      totalParagraphs: blockRows.length,
      totalBlocks: blockRows.length,
      paragraphStatus: paper.paragraphStatus,
      processingError: paper.processingError,
      contentVersion: paper.contentVersion,
    });
  }

  return c.json({
    sections: [],
    totalParagraphs: 0,
    totalBlocks: 0,
    paragraphStatus: paper.paragraphStatus,
    processingError: paper.processingError,
    contentVersion: paper.contentVersion,
  });
});

// 分页获取统一阅读块（文本 + 原页视觉裁切）
readingRoute.get('/:paperId/blocks', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '30', 10)), 80);
  const rows = db.select().from(documentBlocks)
    .where(and(
      eq(documentBlocks.paperId, paperId),
      gte(documentBlocks.blockIndex, offset),
      lt(documentBlocks.blockIndex, offset + limit),
    ))
    .orderBy(asc(documentBlocks.blockIndex)).all();
  const total = db.select({ count: sql<number>`count(*)` }).from(documentBlocks)
    .where(eq(documentBlocks.paperId, paperId)).get()?.count || 0;
  const ids = rows.map((row) => row.id);
  const cached = ids.length ? db.select().from(translations).where(and(
    eq(translations.sourceType, 'block'), inArray(translations.sourceId, ids),
  )).all() : [];
  const translationMap = new Map(cached.map((item) => [item.sourceId, item.translatedText]));

  return c.json({
    blocks: rows.map((row) => ({
      id: row.id,
      blockIndex: row.blockIndex,
      type: row.blockType,
      sectionTitle: row.sectionTitle,
      content: row.content,
      processedContent: row.processedContent,
      pageNumber: row.pageNumber,
      bbox: row.bbox ? JSON.parse(row.bbox) : null,
      assetUrl: row.assetPath ? `/api/images/block/${row.id}` : null,
      caption: row.caption,
      translation: translationMap.get(row.id) || null,
    })),
    total,
    offset,
    limit,
  });
});

// 离线下载清单；客户端用 contentVersion 判断是否需要刷新缓存。
// 返回完整的离线数据包，包含所有 document blocks、翻译和资产 URL。
readingRoute.get('/:paperId/manifest', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');
  const paper = db.select().from(papers).where(eq(papers.id, paperId)).get();
  if (!paper) return c.json({ error: '论文不存在' }, 404);

  // Fetch all document blocks with full data
  const allBlocks = db.select().from(documentBlocks)
    .where(eq(documentBlocks.paperId, paperId))
    .orderBy(asc(documentBlocks.blockIndex))
    .all();

  const blockIds = allBlocks.map((b) => b.id);

  // Fetch all cached translations for these blocks
  const blockTranslations = blockIds.length > 0
    ? db.select().from(translations)
        .where(and(
          eq(translations.sourceType, 'block'),
          inArray(translations.sourceId, blockIds),
        )).all()
    : [];

  const translationMap = new Map(blockTranslations.map((t) => [t.sourceId, t.translatedText]));

  const allTranslations = db.select({
    sourceType: translations.sourceType,
    sourceId: translations.sourceId,
    translatedText: translations.translatedText,
  }).from(translations)
    .where(eq(translations.paperId, paperId))
    .all();

  return c.json({
    paperId,
    title: paper.title,
    contentVersion: paper.contentVersion,
    pdfUrl: `/api/papers/${paperId}/file`,
    blocks: allBlocks.map((row) => ({
      id: row.id,
      blockIndex: row.blockIndex,
      type: row.blockType,
      sectionTitle: row.sectionTitle,
      content: row.content,
      processedContent: row.processedContent,
      pageNumber: row.pageNumber,
      bbox: row.bbox ? JSON.parse(row.bbox) : null,
      assetPath: row.assetPath,
      assetUrl: row.assetPath ? `/api/images/block/${row.id}` : null,
      caption: row.caption,
      charCount: row.charCount,
      translation: translationMap.get(row.id) || null,
    })),
    assets: allBlocks
      .filter((block) => block.assetPath)
      .map((block) => ({
        blockId: block.id,
        url: `/api/images/block/${block.id}`,
        assetPath: block.assetPath,
      })),
    translations: allTranslations.map((t) => ({
      sourceType: t.sourceType,
      sourceId: t.sourceId,
      translatedText: t.translatedText,
    })),
  });
});

// 批量翻译
const translateSchema = z.object({
  ids: z.array(z.number()).min(1).max(20),
  mode: z.literal('block'),
});

readingRoute.post('/:paperId/translate', authMiddleware, zValidator('json', translateSchema), async (c) => {
  const paperId = c.req.param('paperId');
  const { ids, mode } = c.req.valid('json');

  try {
    const results = await translateBlocks(paperId, ids);

    return c.json({ translations: results });
  } catch (e: any) {
    console.error('[翻译API] 失败:', e);
    return c.json({ error: e.message || '翻译失败' }, 500);
  }
});

// 保存阅读位置
readingRoute.post('/:paperId/position', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');
  const { blockIndex } = await c.req.json();
  db.insert(userSettings).values({
    key: `reading_pos_${paperId}`,
    value: JSON.stringify({ blockIndex, savedAt: new Date().toISOString() }),
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: userSettings.key,
    set: {
      value: JSON.stringify({ blockIndex, savedAt: new Date().toISOString() }),
      updatedAt: new Date().toISOString(),
    },
  }).run();
  return c.json({ success: true });
});

// 获取阅读位置
readingRoute.get('/:paperId/position', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');
  const setting = db.select().from(userSettings).where(eq(userSettings.key, `reading_pos_${paperId}`)).get();
  if (!setting) return c.json({ position: null });
  return c.json({ position: JSON.parse(setting.value) });
});

// 记录阅读会话
readingRoute.post('/:paperId/session', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');
  const { durationSeconds, blocksRead } = await c.req.json() as { durationSeconds: number; blocksRead: number };
  db.insert(readingSessions).values({
    paperId,
    startedAt: new Date(Date.now() - durationSeconds * 1000).toISOString(),
    endedAt: new Date().toISOString(),
    durationSeconds: Math.round(durationSeconds),
    blocksRead: blocksRead || 0,
  }).run();
  return c.json({ success: true });
});

// 获取论文阅读统计
readingRoute.get('/:paperId/stats', authMiddleware, async (c) => {
  const paperId = c.req.param('paperId');
  const sessions = db.select().from(readingSessions).where(eq(readingSessions.paperId, paperId)).all();
  const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  const totalBlocks = sessions.reduce((sum, s) => sum + s.blocksRead, 0);
  return c.json({
    totalReadingTime: totalSeconds,
    sessionCount: sessions.length,
    blocksRead: totalBlocks,
    averageSessionTime: sessions.length > 0 ? Math.round(totalSeconds / sessions.length) : 0,
  });
});

export { readingRoute };
