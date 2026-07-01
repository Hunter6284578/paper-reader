/**
 * 翻译服务 — 调用 DeepSeek API 翻译论文段落/句子
 * 支持缓存（translations 表）避免重复翻译
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { documentBlocks, paragraphs, sentences, translations } from '../db/schema.js';
import { chatCompletion } from './llmService.js';
import { ENV } from '../config.js';
import { getDeepSeekConfig } from './modelSettings.js';

interface TranslationResult {
  sourceId: number;
  sourceType: 'paragraph' | 'sentence' | 'block';
  originalText: string;
  translatedText: string;
}

const BATCH_SIZE = 5;

/**
 * 批量翻译段落（优先查缓存）
 */
export async function translateParagraphs(
  paperId: string,
  paragraphIds: number[]
): Promise<TranslationResult[]> {
  return translateBatch(paperId, paragraphIds, 'paragraph');
}

/**
 * 批量翻译句子
 */
export async function translateSentences(
  paperId: string,
  sentenceIds: number[]
): Promise<TranslationResult[]> {
  return translateBatch(paperId, sentenceIds, 'sentence');
}

export async function translateBlocks(paperId: string, blockIds: number[]): Promise<TranslationResult[]> {
  return translateBatch(paperId, blockIds, 'block');
}

/**
 * 通用批量翻译
 */
async function translateBatch(
  paperId: string,
  ids: number[],
  sourceType: 'paragraph' | 'sentence' | 'block'
): Promise<TranslationResult[]> {
  if (ids.length === 0) return [];

  // 1. 查缓存
  const cached = db
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.sourceType, sourceType),
        inArray(translations.sourceId, ids)
      )
    )
    .all();

  const cachedMap = new Map(cached.map((t) => [t.sourceId, t.translatedText]));

  // 2. 找出未命中缓存的 ID
  const uncachedIds = ids.filter((id) => !cachedMap.has(id));

  // 3. 获取原文
  const originalMap = await getOriginalTexts(paperId, uncachedIds, sourceType);

  // 4. 批量调用 DeepSeek 翻译
  const newTranslations: TranslationResult[] = [];
  if (uncachedIds.length > 0) {
    // 分批翻译
    for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
      const batchIds = uncachedIds.slice(i, i + BATCH_SIZE);
      const batchTexts = batchIds.map((id) => ({
        id,
        text: originalMap.get(id) || '',
      })).filter((t) => t.text.length > 0);

      if (batchTexts.length === 0) continue;

      try {
        const results = await callDeepSeekTranslate(batchTexts, sourceType);

        // 写入缓存
        for (const result of results) {
          try {
            db.insert(translations).values({
              paperId,
              sourceType,
              sourceId: result.sourceId,
              originalText: result.originalText,
              translatedText: result.translatedText,
              model: getDeepSeekConfig().model,
            }).onConflictDoNothing().run();
          } catch {
            // 忽略重复插入
          }
          newTranslations.push(result);
        }
      } catch (e) {
        console.error('[翻译服务] 翻译失败:', e);
      }
    }
  }

  // 5. 合并缓存 + 新翻译
  const allResults: TranslationResult[] = [];

  for (const id of ids) {
    const text = originalMap.get(id) || cached.find((t) => t.sourceId === id)?.originalText || '';
    const translated = cachedMap.get(id) || newTranslations.find((t) => t.sourceId === id)?.translatedText || '';

    if (translated) {
      allResults.push({
        sourceId: id,
        sourceType,
        originalText: text,
        translatedText: translated,
      });
    }
  }

  return allResults;
}

/**
 * 获取原文
 */
async function getOriginalTexts(
  paperId: string,
  ids: number[],
  sourceType: 'paragraph' | 'sentence' | 'block'
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;

  if (sourceType === 'paragraph') {
    const rows = db
      .select({
        id: paragraphs.id,
        content: paragraphs.content,
        processedContent: paragraphs.processedContent,
      })
      .from(paragraphs)
      .where(
        and(eq(paragraphs.paperId, paperId), inArray(paragraphs.id, ids))
      )
      .all();
    for (const row of rows) {
      // 将公式标记一并交给翻译模型，配合 prompt 保证公式原样返回。
      map.set(row.id, row.processedContent || row.content);
    }
  } else if (sourceType === 'sentence') {
    const rows = db
      .select({ id: sentences.id, content: sentences.content })
      .from(sentences)
      .where(
        and(eq(sentences.paperId, paperId), inArray(sentences.id, ids))
      )
      .all();
    for (const row of rows) {
      map.set(row.id, row.content);
    }
  } else {
    const rows = db.select({
      id: documentBlocks.id,
      content: documentBlocks.content,
      processedContent: documentBlocks.processedContent,
    }).from(documentBlocks).where(and(
      eq(documentBlocks.paperId, paperId), inArray(documentBlocks.id, ids),
    )).all();
    for (const row of rows) {
      if (row.content) map.set(row.id, row.processedContent || row.content);
    }
  }

  return map;
}

/**
 * 调用 DeepSeek 批量翻译
 */
async function callDeepSeekTranslate(
  texts: Array<{ id: number; text: string }>,
  sourceType: 'paragraph' | 'sentence' | 'block' = 'paragraph',
): Promise<TranslationResult[]> {
  if (texts.length === 1) {
    // 单段翻译
    const translated = await chatCompletion([
      { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
      { role: 'user', content: texts[0].text },
    ], { maxTokens: 2000, temperature: 0.3 });

    return [{
      sourceId: texts[0].id,
      sourceType,
      originalText: texts[0].text,
      translatedText: translated.trim(),
    }];
  }

  // 多段翻译：用标记分隔
  const userContent = texts
    .map((t, i) => `[段落${i + 1}]\n${t.text}`)
    .join('\n\n---\n\n');

  const response = await chatCompletion([
    { role: 'system', content: BATCH_TRANSLATION_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ], { maxTokens: 4000, temperature: 0.3 });

  // 解析结果
  return parseBatchTranslation(response, texts, sourceType);
}

/**
 * 解析批量翻译结果
 */
function parseBatchTranslation(
  response: string,
  texts: Array<{ id: number; text: string }>,
  sourceType: 'paragraph' | 'sentence' | 'block',
): TranslationResult[] {
  const results: TranslationResult[] = [];

  // 尝试按 [段落N] 分割
  const parts = response.split(/\[段落\d+\]/).filter((p) => p.trim().length > 0);

  if (parts.length === texts.length) {
    for (let i = 0; i < texts.length; i++) {
      results.push({
        sourceId: texts[i].id,
        sourceType,
        originalText: texts[i].text,
        translatedText: parts[i].trim(),
      });
    }
    return results;
  }

  // 解析失败，回退为整段翻译
  console.warn('[翻译服务] 批量翻译解析失败，回退为整段');
  return [{
    sourceId: texts[0].id,
    sourceType,
    originalText: texts.map((t) => t.text).join('\n\n'),
    translatedText: response.trim(),
  }];
}

const TRANSLATION_SYSTEM_PROMPT = `你是一位专业的学术论文翻译助手。请将以下英文学术论文段落翻译为流畅准确的中文。
要求：
1. 保持学术用语的专业性和准确性
2. 关键术语首次出现时用“中文（English）”格式标注
3. 保持原文的逻辑关系和学术语气
4. 只输出翻译结果，不要添加任何解释或额外内容
5. 文本中的 $...$ 和 $$...$$ 标记表示数学公式，翻译时必须原样保留这些标记及其内容，不要翻译或修改公式`;

const BATCH_TRANSLATION_SYSTEM_PROMPT = `你是一位专业的学术论文翻译助手。请将以下英文学术论文段落翻译为流畅准确的中文。
要求：
1. 保持学术用语的专业性和准确性
2. 关键术语首次出现时用“中文（English）”格式标注
3. 保持原文的逻辑关系和学术语气
4. 每个段落用 [段落N] 开头标记（N为段落编号）
5. 只输出翻译结果，不要添加任何解释
6. 文本中的 $...$ 和 $$...$$ 标记表示数学公式，翻译时必须原样保留这些标记及其内容，不要翻译或修改公式`;
