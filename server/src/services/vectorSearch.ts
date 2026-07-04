import { sqlite } from '../db/connection.js';
import { chatCompletion } from './llmService.js';
import { getDeepSeekConfig } from './modelSettings.js';
import { generateQueryEmbedding, cosineSimilarity, isEmbeddingAvailable } from './embeddingService.js';

export interface SearchResult {
  chunkId: number;
  content: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  blockId: number | null;
  bbox: number[] | null;
  score: number;
  paperId: string;
  paperTitle: string;
}

interface RetrievalQuery {
  original: string;
  expanded: string;
  embedding: number[] | null;
}

interface SearchRow {
  id: number;
  content: string;
  section_title: string | null;
  page_number: number | null;
  block_id: number | null;
  bbox: string | null;
  paper_id: string;
  paper_title: string;
  embedding?: string;
  rank?: number;
}

export async function hybridSearch(query: string, paperId: string, topN = 6): Promise<SearchResult[]> {
  const prepared = await prepareRetrievalQuery(query);
  return searchPrepared(prepared, paperId, topN);
}

export async function globalHybridSearch(query: string, topN = 8): Promise<SearchResult[]> {
  const prepared = await prepareRetrievalQuery(query);
  return searchPrepared(prepared, null, topN);
}

async function prepareRetrievalQuery(query: string): Promise<RetrievalQuery> {
  const original = questionToPlainText(query);
  const [expanded, embedding] = await Promise.all([
    expandQuery(original),
    isEmbeddingAvailable()
      ? generateQueryEmbedding(original).catch((error) => {
          console.warn('[Vector] query embedding failed; using FTS5 only:', error);
          return null;
        })
      : Promise.resolve(null),
  ]);
  return { original, expanded, embedding };
}

async function searchPrepared(prepared: RetrievalQuery, paperId: string | null, topN: number): Promise<SearchResult[]> {
  const [ftsResults, vectorResults] = await Promise.all([
    ftsSearchPrepared(prepared, paperId, topN * 2),
    prepared.embedding ? vectorSearchPrepared(prepared.embedding, paperId, topN * 2) : Promise.resolve([]),
  ]);
  return fuseResults(ftsResults, vectorResults, topN);
}

export function fuseResults(ftsResults: SearchResult[], vectorResults: SearchResult[], topN: number): SearchResult[] {
  if (vectorResults.length === 0) return ftsResults.slice(0, topN);
  const k = 60;
  const fused = new Map<number, { result: SearchResult; score: number }>();
  for (const [rank, result] of ftsResults.entries()) {
    fused.set(result.chunkId, { result, score: 1 / (k + rank + 1) });
  }
  for (const [rank, result] of vectorResults.entries()) {
    const existing = fused.get(result.chunkId);
    if (existing) existing.score += 1 / (k + rank + 1);
    else fused.set(result.chunkId, { result, score: 1 / (k + rank + 1) });
  }
  return [...fused.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, topN)
    .map(({ result, score }) => ({ ...result, score }));
}

async function ftsSearchPrepared(prepared: RetrievalQuery, paperId: string | null, topN: number): Promise<SearchResult[]> {
  const primary = toFtsQuery(prepared.expanded);
  const fallback = toFtsQuery(prepared.original);
  let rows = runFts(primary, paperId, topN);
  if (rows.length === 0 && fallback !== primary) rows = runFts(fallback, paperId, topN);
  if (rows.length === 0) return likeFallback(prepared, paperId, topN);
  return rows.map((row) => rowToResult(row, -(row.rank || 0)));
}

function runFts(query: string, paperId: string | null, limit: number): SearchRow[] {
  try {
    if (paperId) {
      return sqlite.prepare(`
        SELECT c.id, c.content, c.section_title, c.page_number, c.block_id,
               b.bbox, c.paper_id, p.title AS paper_title, bm25(chunks_fts) AS rank
        FROM chunks_fts
        JOIN chunks c ON c.id = chunks_fts.rowid
        JOIN papers p ON p.id = c.paper_id
        LEFT JOIN document_blocks b ON b.id = c.block_id
        WHERE chunks_fts MATCH ? AND c.paper_id = ?
        ORDER BY rank LIMIT ?
      `).all(query, paperId, limit) as SearchRow[];
    }
    return sqlite.prepare(`
      SELECT c.id, c.content, c.section_title, c.page_number, c.block_id,
             b.bbox, c.paper_id, p.title AS paper_title, bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.rowid
      JOIN papers p ON p.id = c.paper_id
      LEFT JOIN document_blocks b ON b.id = c.block_id
      WHERE chunks_fts MATCH ? AND p.processing_status = 'ready'
      ORDER BY rank LIMIT ?
    `).all(query, limit) as SearchRow[];
  } catch (error) {
    console.warn('[FTS5] query failed:', query, error);
    return [];
  }
}

async function vectorSearchPrepared(queryEmbedding: number[], paperId: string | null, topN: number): Promise<SearchResult[]> {
  const rows = (paperId
    ? sqlite.prepare(`
        SELECT c.id, c.content, c.section_title, c.page_number, c.block_id, c.embedding,
               b.bbox, c.paper_id, p.title AS paper_title
        FROM chunks c JOIN papers p ON p.id = c.paper_id
        LEFT JOIN document_blocks b ON b.id = c.block_id
        WHERE c.paper_id = ? AND c.embedding IS NOT NULL
      `).all(paperId)
    : sqlite.prepare(`
        SELECT c.id, c.content, c.section_title, c.page_number, c.block_id, c.embedding,
               b.bbox, c.paper_id, p.title AS paper_title
        FROM chunks c JOIN papers p ON p.id = c.paper_id
        LEFT JOIN document_blocks b ON b.id = c.block_id
        WHERE c.embedding IS NOT NULL AND p.processing_status = 'ready'
      `).all()) as SearchRow[];

  return rows
    .map((row) => ({ row, similarity: safeCosine(queryEmbedding, row.embedding) }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, topN)
    .map(({ row, similarity }) => rowToResult(row, similarity));
}

function safeCosine(query: number[], serialized: string | undefined): number {
  if (!serialized) return 0;
  try {
    return cosineSimilarity(query, JSON.parse(serialized) as number[]);
  } catch {
    return 0;
  }
}

function likeFallback(prepared: RetrievalQuery, paperId: string | null, topN: number): SearchResult[] {
  const keywords = `${prepared.expanded} ${prepared.original}`.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) || [];
  const unique = [...new Set(keywords)].slice(0, 10);
  if (unique.length === 0) return [];
  const rows = (paperId
    ? sqlite.prepare(`
        SELECT c.id, c.content, c.section_title, c.page_number, c.block_id,
               b.bbox, c.paper_id, p.title AS paper_title
        FROM chunks c JOIN papers p ON p.id = c.paper_id
        LEFT JOIN document_blocks b ON b.id = c.block_id WHERE c.paper_id = ?
      `).all(paperId)
    : sqlite.prepare(`
        SELECT c.id, c.content, c.section_title, c.page_number, c.block_id,
               b.bbox, c.paper_id, p.title AS paper_title
        FROM chunks c JOIN papers p ON p.id = c.paper_id
        LEFT JOIN document_blocks b ON b.id = c.block_id WHERE p.processing_status = 'ready'
      `).all()) as SearchRow[];
  return rows
    .map((row) => ({ row, hits: unique.reduce((sum, keyword) => sum + (row.content.toLowerCase().includes(keyword) ? 1 : 0), 0) }))
    .filter(({ hits }) => hits > 0)
    .sort((left, right) => right.hits - left.hits)
    .slice(0, topN)
    .map(({ row, hits }) => rowToResult(row, hits));
}

function rowToResult(row: SearchRow, score: number): SearchResult {
  let bbox: number[] | null = null;
  if (row.bbox) {
    try { bbox = JSON.parse(row.bbox) as number[]; } catch { bbox = null; }
  }
  return {
    chunkId: row.id,
    content: row.content,
    sectionTitle: row.section_title,
    pageNumber: row.page_number,
    blockId: row.block_id,
    bbox,
    score,
    paperId: row.paper_id,
    paperTitle: row.paper_title,
  };
}

function questionToPlainText(value: string): string {
  return value.replace(/[\u0000-\u001f]/g, ' ').trim();
}

async function expandQuery(query: string): Promise<string> {
  if (!getDeepSeekConfig().apiKey) return query;
  const isChinese = /[\u3400-\u9fff]/.test(query);
  const systemPrompt = isChinese
    ? '将中文学术问题改写为 8-15 个空格分隔的英文检索关键词。保留核心概念并补充同义词、缩写与全称。只输出关键词。'
    : 'Expand the academic query into 8-15 space-separated retrieval keywords. Keep core terms and add synonyms, abbreviations, and full forms. Output keywords only.';
  try {
    return await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ], { maxTokens: 120, temperature: 0 });
  } catch {
    return query;
  }
}

function toFtsQuery(query: string): string {
  const terms = query.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) || [];
  const unique = [...new Set(terms)].slice(0, 20);
  return unique.length ? unique.map((term) => `"${term.replace(/"/g, '')}"`).join(' OR ') : 'paper';
}
