import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, lte, desc, sql, gte, isNull, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { papers, reviewEvents, vocabContexts, vocabItems, reviewLogs, documentBlocks, sentences, studyLogs, userSettings } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { lookupWord } from '../services/dictionary.js';
import { sm2Schedule, REVIEW_QUALITY_MAP, type ReviewGrade } from '../services/sm2Scheduler.js';
import { chatCompletion, generateWordAnalysis } from '../services/llmService.js';
import { ENV } from '../config.js';
import { getDeepSeekConfig } from '../services/modelSettings.js';

const vocabRoute = new Hono();

// 获取生词列表
vocabRoute.get('/', authMiddleware, async (c) => {
  const status = c.req.query('status') || 'active';
  const list = db.select()
    .from(vocabItems)
    .where(eq(vocabItems.status, status))
    .orderBy(desc(vocabItems.createdAt))
    .all();

  const contexts = db.select().from(vocabContexts).orderBy(desc(vocabContexts.createdAt)).all();
  return c.json({
    vocabItems: list.map((item) => ({
      ...item,
      contexts: contexts.filter((context) => context.vocabId === item.id),
    })),
  });
});

// 获取今日复习任务
vocabRoute.get('/review/today', authMiddleware, async (c) => {
  const now = new Date().toISOString();
  const list = db.select()
    .from(vocabItems)
    .where(and(
      eq(vocabItems.status, 'active'),
      lte(vocabItems.dueDate, now)
    ))
    .orderBy(vocabItems.dueDate)
    .all();

  return c.json({
    reviewItems: list,
    totalCount: list.length,
  });
});

// 添加生词
const addSchema = z.object({
  word: z.string().min(1),
  contextSentence: z.string().optional(),
  sentence: z.string().optional(),
  sourcePaperId: z.string().optional(),
  pageNumber: z.number().int().positive().optional(),
  blockId: z.number().int().positive().optional(),
});

/**
 * Extract the sentence containing the target word from a block or paragraph.
 * Tries the sentences table first, then falls back to splitting block content.
 */
function extractSentenceFromBlock(blockId: number, word: string, paperId?: string): string | null {
  // Try sentences table first (sentence-level granularity)
  if (paperId) {
    // Look up the paragraph that owns this block (for legacy paragraph-based blocks)
    const block = db.select().from(documentBlocks).where(eq(documentBlocks.id, blockId)).get();
    if (block) {
      // Try to find a sentence in the same paragraph containing the word
      const paraSentences = db.select().from(sentences)
        .where(eq(sentences.paragraphId, block.blockIndex))
        .orderBy(sentences.sentenceIndex)
        .all();
      for (const s of paraSentences) {
        if (s.content.toLowerCase().includes(word.toLowerCase())) {
          return s.content;
        }
      }
    }
  }

  // Fallback: use the document block content directly
  const block = db.select().from(documentBlocks).where(eq(documentBlocks.id, blockId)).get();
  if (block?.content) {
    return extractSentenceFromText(block.content, word);
  }

  return null;
}

/**
 * Extract the sentence containing the target word from raw text
 * using simple sentence boundary detection.
 */
function extractSentenceFromText(text: string, word: string): string | null {
  if (!text) return null;
  // Split on sentence boundaries (period, question mark, exclamation mark followed by space or end)
  const sentenceRegex = /[^.!?]*[.!?]+(?=\s|$)|[^.!?]+$/g;
  const matches = text.match(sentenceRegex);
  if (!matches) return text;

  const lowerWord = word.toLowerCase();
  for (const sentence of matches) {
    if (sentence.toLowerCase().includes(lowerWord)) {
      return sentence.trim();
    }
  }
  // If not found, return the full text
  return text.trim();
}

vocabRoute.post('/add', authMiddleware, zValidator('json', addSchema), async (c) => {
  const data = c.req.valid('json');
  const word = data.word.toLowerCase().trim();

  // Resolve the context sentence: prefer explicit `sentence`, then `contextSentence`, then server-side extraction
  let contextSentence = data.sentence?.trim() || data.contextSentence?.trim() || null;
  if (!contextSentence && data.blockId) {
    contextSentence = extractSentenceFromBlock(data.blockId, word, data.sourcePaperId);
  }

  // 检查是否已存在
  const existing = db.select().from(vocabItems).where(eq(vocabItems.word, word)).get();
  if (existing) {
    if (contextSentence) {
      const paper = data.sourcePaperId
        ? db.select().from(papers).where(eq(papers.id, data.sourcePaperId)).get()
        : null;
      const duplicate = db.select().from(vocabContexts).where(and(
        eq(vocabContexts.vocabId, existing.id),
        eq(vocabContexts.sentence, contextSentence),
      )).get();
      if (!duplicate) {
        db.insert(vocabContexts).values({
          vocabId: existing.id,
          paperId: data.sourcePaperId || null,
          paperTitle: paper?.title || null,
          sentence: contextSentence,
          pageNumber: data.pageNumber || null,
          blockId: data.blockId || null,
        }).run();
      }
    }
    const contexts = db.select().from(vocabContexts)
      .where(eq(vocabContexts.vocabId, existing.id)).orderBy(desc(vocabContexts.createdAt)).all();
    return c.json({ vocabItem: { ...existing, contexts }, addedContext: true });
  }

  // 查询词典
  const dictResult = await lookupWord(word);

  // 可选：获取中文释义
  let definitionCn: string | null = null;
  if (getDeepSeekConfig().apiKey && dictResult?.definitionEn) {
    try {
      definitionCn = await chatCompletion([
        {
          role: 'system',
          content: '你是一位英语词典翻译。请将以下英文单词的释义翻译成简洁的中文，只需给出中文翻译，不需要其他内容。',
        },
        {
          role: 'user',
          content: `单词: ${word}\n英文释义: ${dictResult.definitionEn}`,
        },
      ], { maxTokens: 100 });
    } catch (e) {
      console.warn('[生词] 中文释义获取失败:', e);
    }
  }

  // 写入数据库
  const vocabItem = db.insert(vocabItems).values({
    word,
    phonetic: dictResult?.phonetic,
    audioUrl: dictResult?.audioUrl,
    partOfSpeech: dictResult?.partOfSpeech,
    definitionEn: dictResult?.definitionEn,
    definitionCn,
    exampleSentence: dictResult?.exampleSentence,
    sourcePaperId: data.sourcePaperId || null,
    contextSentence: contextSentence,
  }).returning().get();

  // 异步生成词根词缀和助记（不阻塞返回）
  if (getDeepSeekConfig().apiKey) {
    generateWordAnalysis(word, dictResult?.definitionEn || definitionCn)
      .then((analysis) => {
        if (analysis.wordRoots || analysis.mnemonic) {
          db.update(vocabItems)
            .set({ wordRoots: analysis.wordRoots, mnemonic: analysis.mnemonic })
            .where(eq(vocabItems.id, vocabItem.id))
            .run();
        }
      })
      .catch(() => { /* ignore */ });
  }

  if (contextSentence) {
    const paper = data.sourcePaperId
      ? db.select().from(papers).where(eq(papers.id, data.sourcePaperId)).get()
      : null;
    db.insert(vocabContexts).values({
      vocabId: vocabItem.id,
      paperId: data.sourcePaperId || null,
      paperTitle: paper?.title || null,
      sentence: contextSentence,
      pageNumber: data.pageNumber || null,
      blockId: data.blockId || null,
    }).run();
  }

  const contexts = db.select().from(vocabContexts).where(eq(vocabContexts.vocabId, vocabItem.id)).all();

  // 记录今日新词（添加时自动记录）
  const today = new Date().toISOString().split('T')[0];
  const existingLog = db.select().from(studyLogs).where(eq(studyLogs.date, today)).get();
  if (existingLog) {
    db.update(studyLogs)
      .set({ newWordsCount: existingLog.newWordsCount + 1 })
      .where(eq(studyLogs.date, today))
      .run();
  } else {
    db.insert(studyLogs).values({ date: today, newWordsCount: 1, reviewCount: 0 }).run();
  }

  return c.json({ vocabItem: { ...vocabItem, contexts } }, 201);
});

// 提交复习结果
const reviewSchema = z.object({
  grade: z.enum(['forgot', 'hard', 'good', 'easy']),
  responseTimeMs: z.number().optional(),
  eventId: z.string().uuid().optional(),
  reviewedAt: z.string().datetime().optional(),
});

vocabRoute.post('/review/:id', authMiddleware, zValidator('json', reviewSchema), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { grade, responseTimeMs, eventId, reviewedAt } = c.req.valid('json');

  const vocab = db.select().from(vocabItems).where(eq(vocabItems.id, id)).get();
  if (!vocab) {
    return c.json({ error: '生词不存在' }, 404);
  }
  if (eventId) {
    const applied = db.select().from(reviewEvents).where(eq(reviewEvents.id, eventId)).get();
    if (applied) return c.json({ vocabItem: vocab, duplicate: true });
  }

  const quality = REVIEW_QUALITY_MAP[grade];
  const result = sm2Schedule(
    {
      repetitions: vocab.repetitions,
      intervalDays: vocab.intervalDays,
      easeFactor: vocab.easeFactor,
    },
    quality
  );

  // 更新生词状态
  let updated = db.update(vocabItems)
    .set({
      repetitions: result.repetitions,
      intervalDays: result.intervalDays,
      easeFactor: result.easeFactor,
      dueDate: result.dueDate.toISOString(),
      lastReviewAt: new Date().toISOString(),
      totalReviews: vocab.totalReviews + 1,
      correctReviews: vocab.correctReviews + (quality >= 3 ? 1 : 0),
    })
    .where(eq(vocabItems.id, id))
    .returning()
    .get();

  // Auto-master: if easeFactor >= 2.5 and interval >= 21 days and total reviews >= 5
  // Only trigger on "good" or "easy" grades (quality >= 4)
  if (quality >= 4 && updated.easeFactor >= 2.5 && updated.intervalDays >= 21 && updated.totalReviews >= 5) {
    updated = db.update(vocabItems)
      .set({ status: 'mastered' })
      .where(eq(vocabItems.id, id))
      .returning()
      .get();
  }

  // 记录复习日志
  db.insert(reviewLogs).values({
    vocabId: id,
    quality,
    prevInterval: vocab.intervalDays,
    newInterval: result.intervalDays,
    prevEaseFactor: vocab.easeFactor,
    newEaseFactor: result.easeFactor,
    responseTimeMs,
  }).run();

  if (eventId) {
    db.insert(reviewEvents).values({
      id: eventId,
      vocabId: id,
      grade,
      responseTimeMs,
      reviewedAt: reviewedAt || new Date().toISOString(),
    }).run();
  }

  // 更新今日学习日志（复习计数）
  const today = new Date().toISOString().split('T')[0];
  const existingLog = db.select().from(studyLogs).where(eq(studyLogs.date, today)).get();
  if (existingLog) {
    db.update(studyLogs)
      .set({ reviewCount: existingLog.reviewCount + 1 })
      .where(eq(studyLogs.date, today))
      .run();
  } else {
    db.insert(studyLogs).values({ date: today, newWordsCount: 0, reviewCount: 1 }).run();
  }

  return c.json({ vocabItem: updated });
});

// 删除生词
vocabRoute.delete('/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  db.delete(vocabItems).where(eq(vocabItems.id, id)).run();
  return c.json({ success: true });
});

// 手动标记为已掌握
vocabRoute.post('/master/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const vocab = db.select().from(vocabItems).where(eq(vocabItems.id, id)).get();
  if (!vocab) {
    return c.json({ error: '生词不存在' }, 404);
  }

  const updated = db.update(vocabItems)
    .set({ status: 'mastered' })
    .where(eq(vocabItems.id, id))
    .returning()
    .get();

  return c.json({ vocabItem: updated });
});

// 获取学习统计
vocabRoute.get('/stats', authMiddleware, async (c) => {
  const total = db.select({ count: sql<number>`count(*)` })
    .from(vocabItems).get()?.count || 0;

  const active = db.select({ count: sql<number>`count(*)` })
    .from(vocabItems)
    .where(eq(vocabItems.status, 'active'))
    .get()?.count || 0;

  const mastered = db.select({ count: sql<number>`count(*)` })
    .from(vocabItems)
    .where(eq(vocabItems.status, 'mastered'))
    .get()?.count || 0;

  const now = new Date().toISOString();
  const dueToday = db.select({ count: sql<number>`count(*)` })
    .from(vocabItems)
    .where(and(
      eq(vocabItems.status, 'active'),
      lte(vocabItems.dueDate, now)
    ))
    .get()?.count || 0;

  // 最近7天复习数
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentReviews = db.select({ count: sql<number>`count(*)` })
    .from(reviewLogs)
    .where(sql`reviewed_at >= ${sevenDaysAgo.toISOString()}`)
    .get()?.count || 0;

  return c.json({
    stats: { total, active, mastered, dueToday, recentReviews },
  });
});

// ============================================================
// 学习批次（获取未学习过的词）
// ============================================================
vocabRoute.get('/learn/batch', authMiddleware, (c) => {
  const batchSize = parseInt(c.req.query('size') || '10', 10);

  // 获取未学习过的词（learnedAt 为空）
  const unlearned = db.select()
    .from(vocabItems)
    .where(and(
      eq(vocabItems.status, 'active'),
      isNull(vocabItems.learnedAt)
    ))
    .orderBy(vocabItems.createdAt)
    .limit(batchSize)
    .all();

  // 如果未学习的不够，补充一些之前学过但需要复习的
  if (unlearned.length < batchSize) {
    const remaining = batchSize - unlearned.length;
    const now = new Date().toISOString();
    const dueItems = db.select()
      .from(vocabItems)
      .where(and(
        eq(vocabItems.status, 'active'),
        lte(vocabItems.dueDate, now),
        sql`${vocabItems.learnedAt} IS NOT NULL`
      ))
      .orderBy(vocabItems.dueDate)
      .limit(remaining)
      .all();
    unlearned.push(...dueItems);
  }

  const contexts = db.select().from(vocabContexts).all();
  const itemsWithContexts = unlearned.map((item) => ({
    ...item,
    contexts: contexts.filter((ctx) => ctx.vocabId === item.id),
  }));

  return c.json({ items: itemsWithContexts });
});

// 标记单词完成首次学习
vocabRoute.post('/learn/:id', authMiddleware, (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const vocab = db.select().from(vocabItems).where(eq(vocabItems.id, id)).get();
  if (!vocab) return c.json({ error: '生词不存在' }, 404);

  const now = new Date().toISOString();
  const today = now.split('T')[0];

  // 更新 learnedAt
  if (!vocab.learnedAt) {
    db.update(vocabItems)
      .set({ learnedAt: now })
      .where(eq(vocabItems.id, id))
      .run();

    // 更新今日学习日志（新词计数）
    const existingLog = db.select().from(studyLogs).where(eq(studyLogs.date, today)).get();
    if (existingLog) {
      db.update(studyLogs)
        .set({ newWordsCount: existingLog.newWordsCount + 1 })
        .where(eq(studyLogs.date, today))
        .run();
    } else {
      db.insert(studyLogs).values({ date: today, newWordsCount: 1, reviewCount: 0 }).run();
    }
  }

  const updated = db.select().from(vocabItems).where(eq(vocabItems.id, id)).get();
  return c.json({ vocabItem: updated });
});

// ============================================================
// 打卡日历数据
// ============================================================
vocabRoute.get('/study-calendar', authMiddleware, (c) => {
  const days = parseInt(c.req.query('days') || '90', 10);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  const logs = db.select({
    date: studyLogs.date,
    newWordsCount: studyLogs.newWordsCount,
    reviewCount: studyLogs.reviewCount,
  })
    .from(studyLogs)
    .where(gte(studyLogs.date, startDateStr))
    .orderBy(studyLogs.date)
    .all();

  // 计算连续打卡天数
  let streak = 0;
  const today = new Date().toISOString().split('T')[0];
  const checkDate = new Date();

  while (true) {
    const dateStr = checkDate.toISOString().split('T')[0];
    const log = logs.find((l) => l.date === dateStr);
    if (log && (log.newWordsCount > 0 || log.reviewCount > 0)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else if (dateStr === today) {
      // 今天还没学，从昨天开始算
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // 今日统计
  const todayLog = logs.find((l) => l.date === today);
  const todayStats = {
    newWords: todayLog?.newWordsCount || 0,
    reviews: todayLog?.reviewCount || 0,
  };

  return c.json({ calendar: logs, streak, todayStats });
});

// ============================================================
// 用户设置
// ============================================================
vocabRoute.get('/settings', authMiddleware, (c) => {
  const dailyGoalRow = db.select().from(userSettings).where(eq(userSettings.key, 'dailyGoal')).get();
  const dailyGoal = dailyGoalRow ? parseInt(dailyGoalRow.value, 10) : 20;
  return c.json({ dailyGoal });
});

const settingsSchema = z.object({
  dailyGoal: z.number().int().min(1).max(200),
});

vocabRoute.put('/settings', authMiddleware, zValidator('json', settingsSchema), (c) => {
  const { dailyGoal } = c.req.valid('json');
  db.insert(userSettings)
    .values({ key: 'dailyGoal', value: String(dailyGoal) })
    .onConflictDoUpdate({ target: userSettings.key, set: { value: String(dailyGoal), updatedAt: sql`(datetime('now'))` } })
    .run();
  return c.json({ dailyGoal });
});

export { vocabRoute };
