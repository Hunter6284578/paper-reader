import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { dictCache } from '../db/schema.js';
import { ENV } from '../config.js';

export interface DictResult {
  word: string;
  phonetic: string | null;
  audioUrl: string | null;
  partOfSpeech: string | null;
  definitionEn: string | null;
  exampleSentence: string | null;
}

interface FreeDictEntry {
  word: string;
  phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
  meanings?: Array<{
    partOfSpeech: string;
    definitions: Array<{
      definition: string;
      example?: string;
    }>;
  }>;
}

/**
 * 查询单词（优先缓存 → Free Dictionary API）
 */
export async function lookupWord(word: string): Promise<DictResult | null> {
  const normalizedWord = word.toLowerCase().trim();

  // 1. 检查缓存
  const cached = db.select().from(dictCache).where(eq(dictCache.word, normalizedWord)).get();
  if (cached) {
    return JSON.parse(cached.response) as DictResult;
  }

  // 2. 调用 Free Dictionary API
  try {
    const response = await fetch(`${ENV.DICT_API_URL}/${encodeURIComponent(normalizedWord)}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null; // 单词不存在
      }
      throw new Error(`词典 API 错误: ${response.status}`);
    }

    const data = await response.json() as FreeDictEntry[];
    const entry = data[0];

    if (!entry) return null;

    // 提取信息
    const phonetic = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || null;
    const audioUrl = entry.phonetics?.find((p) => p.audio)?.audio || null;
    const meaning = entry.meanings?.[0];
    const definition = meaning?.definitions?.[0];

    const result: DictResult = {
      word: normalizedWord,
      phonetic,
      audioUrl,
      partOfSpeech: meaning?.partOfSpeech || null,
      definitionEn: definition?.definition || null,
      exampleSentence: definition?.example || null,
    };

    // 3. 缓存结果
    db.insert(dictCache).values({
      word: normalizedWord,
      response: JSON.stringify(result),
    }).onConflictDoNothing().run();

    return result;
  } catch (error) {
    console.error(`[词典] 查询失败: ${word}`, error);
    return null;
  }
}
