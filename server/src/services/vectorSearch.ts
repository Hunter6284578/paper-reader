import { eq } from 'drizzle-orm';
import { db, sqlite } from '../db/connection.js';
import { chunks, documentBlocks } from '../db/schema.js';
import { chatCompletion } from './llmService.js';
import { getDeepSeekConfig } from './modelSettings.js';

interface SearchResult {
  chunkId: number;
  content: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  blockId: number | null;
  bbox: number[] | null;
  score: number;
}

/**
 * FTS5 BM25 full-text search with query expansion via DeepSeek rewriting.
 * Replaces the former hybrid (vector + FTS5) approach.
 */
export async function ftsSearch(
  query: string,
  paperId: string,
  topN: number = 6
): Promise<SearchResult[]> {
  const cleanQuery = questionToPlainText(query);
  const expandedTerms = await expandQuery(cleanQuery);
  console.log(`[FTS5] query="${cleanQuery}" expanded="${expandedTerms}"`);

  // Fetch all chunks for this paper (needed to join with FTS results)
  const paperChunks = db.select().from(chunks).where(eq(chunks.paperId, paperId)).all();
  if (paperChunks.length === 0) {
    console.log(`[FTS5] no chunks for paper ${paperId}`);
    return [];
  }

  const merged = new Map<number, { result: SearchResult; bm25: number }>();

  const runFts = (ftsQuery: string) => {
    try {
      return sqlite.prepare(`
        SELECT chunks_fts.rowid AS rowid, bm25(chunks_fts) AS rank
        FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
        WHERE chunks_fts MATCH ? AND c.paper_id = ?
        ORDER BY rank LIMIT ?
      `).all(ftsQuery, paperId, topN * 2) as Array<{ rowid: number; rank: number }>;
    } catch (e) {
      console.warn('[FTS5 search] query failed:', ftsQuery, e);
      return [];
    }
  };

  // 1) Primary: expanded query
  const primaryQuery = toFtsQuery(expandedTerms);
  let ftsResults = runFts(primaryQuery);
  console.log(`[FTS5] primary query="${primaryQuery}" → ${ftsResults.length} hits`);

  // 2) Fallback: original (non-expanded) query
  if (ftsResults.length === 0) {
    const fallbackQuery = toFtsQuery(cleanQuery);
    if (fallbackQuery !== primaryQuery) {
      ftsResults = runFts(fallbackQuery);
      console.log(`[FTS5] fallback query="${fallbackQuery}" → ${ftsResults.length} hits`);
    }
  }

  // 3) Last resort: simple keyword LIKE match
  if (ftsResults.length === 0) {
    console.log('[FTS5] FTS returned 0, using LIKE fallback');
    const keywords = (expandedTerms + ' ' + cleanQuery)
      .toLowerCase()
      .match(/[a-z][a-z0-9_-]{1,}/g) || [];
    const uniqueKw = [...new Set(keywords)].slice(0, 10);
    if (uniqueKw.length > 0) {
      const scored = paperChunks
        .map((chunk) => {
          const lc = (chunk.content || '').toLowerCase();
          let hits = 0;
          for (const kw of uniqueKw) {
            if (lc.includes(kw)) hits++;
          }
          return { chunk, hits };
        })
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, topN);

      return scored.map((x, i) => ({
        chunkId: x.chunk.id,
        content: x.chunk.content,
        sectionTitle: x.chunk.sectionTitle,
        pageNumber: x.chunk.pageNumber,
        blockId: x.chunk.blockId,
        bbox: getBlockBbox(x.chunk.blockId),
        score: x.hits,
      }));
    }
  }

  ftsResults.forEach((r) => {
    const chunk = paperChunks.find((c) => c.id === r.rowid);
    if (!chunk) return;
    const bm25Score = -r.rank;
    merged.set(r.rowid, {
      result: {
        chunkId: chunk.id,
        content: chunk.content,
        sectionTitle: chunk.sectionTitle,
        pageNumber: chunk.pageNumber,
        blockId: chunk.blockId,
        bbox: getBlockBbox(chunk.blockId),
        score: bm25Score,
      },
      bm25: bm25Score,
    });
  });

  return [...merged.values()]
    .sort((a, b) => b.bm25 - a.bm25)
    .slice(0, topN)
    .map((m) => m.result);
}

function getBlockBbox(blockId: number | null): number[] | null {
  if (!blockId) return null;
  const row = db.select({ bbox: documentBlocks.bbox }).from(documentBlocks)
    .where(eq(documentBlocks.id, blockId)).get();
  return row?.bbox ? JSON.parse(row.bbox) as number[] : null;
}

function questionToPlainText(value: string): string {
  return value.replace(/[\u0000-\u001f]/g, ' ').trim();
}

/**
 * Use DeepSeek to expand the query into multiple English search terms.
 * For Chinese queries: translate and generate synonyms/related terms.
 * For English queries: generate synonyms and related academic terms.
 * Returns a string of space-separated search terms.
 */
async function expandQuery(query: string): Promise<string> {
  if (!getDeepSeekConfig().apiKey) return query;

  const isChinese = /[\u3400-\u9fff]/.test(query);

  try {
    const systemPrompt = isChinese
      ? `你是一位学术论文检索专家。请将以下中文问题改写为用于检索英文学术论文的搜索关键词。
要求：
1. 将问题翻译为英文关键词
2. 添加相关同义词和学术术语变体（如缩写的全称/缩写形式）
3. 总共输出 8-15 个英文关键词
4. 只输出空格分隔的关键词，不要其他内容`
      : `You are an expert at academic paper retrieval. Expand the following query with additional search terms.
Requirements:
1. Keep the core terms from the original query
2. Add synonyms, related academic terms, and variant forms (e.g., abbreviations and their full forms)
3. Output 8-15 English keywords total
4. Only output space-separated keywords, nothing else`;

    return await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ], { maxTokens: 120, temperature: 0 });
  } catch {
    return query;
  }
}

/**
 * Convert expanded search terms into an FTS5 MATCH query.
 * Uses OR to maximize recall across all expanded terms.
 */
function toFtsQuery(query: string): string {
  const terms = query.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) || [];
  const unique = [...new Set(terms)].slice(0, 20);
  return unique.length ? unique.map((term) => `"${term.replace(/"/g, '')}"`).join(' OR ') : 'paper';
}
