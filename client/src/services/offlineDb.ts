import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { api, resolveApiUrl, authorizedFetch } from './api';
import type { DocumentBlock } from '../types';

let connection: SQLiteDBConnection | null = null;
let initPromise: Promise<void> | null = null;

// ============================================================
// Schema version — bump when adding breaking changes
// ============================================================
const SCHEMA_VERSION = 2;

async function initNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const consistent = await sqlite.checkConnectionsConsistency();
  const existing = (await sqlite.isConnection('paper_reader', false)).result;
  connection = consistent.result && existing
    ? await sqlite.retrieveConnection('paper_reader', false)
    : await sqlite.createConnection('paper_reader', false, 'no-encryption', SCHEMA_VERSION, false);
  await connection.open();

  // Legacy tables (v1)
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS cache_entries (
      cache_key TEXT PRIMARY KEY, json_value TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offline_actions (
      id TEXT PRIMARY KEY, action_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);

  // ============================================================
  // v2: structured offline tables
  // ============================================================
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS offline_papers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      content_version INTEGER NOT NULL DEFAULT 1,
      pdf_path TEXT,
      last_synced TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offline_blocks (
      id INTEGER NOT NULL,
      paper_id TEXT NOT NULL,
      block_type TEXT NOT NULL,
      block_index INTEGER NOT NULL,
      content TEXT,
      processed_content TEXT,
      section_title TEXT,
      page_number INTEGER,
      bbox TEXT,
      asset_path TEXT,
      asset_local_path TEXT,
      caption TEXT,
      char_count INTEGER DEFAULT 0,
      translation TEXT,
      PRIMARY KEY (id, paper_id)
    );
    CREATE INDEX IF NOT EXISTS idx_offline_blocks_paper ON offline_blocks(paper_id, block_index);

    CREATE TABLE IF NOT EXISTS offline_translations (
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      translated_text TEXT NOT NULL,
      PRIMARY KEY (source_type, source_id)
    );

    CREATE TABLE IF NOT EXISTS offline_vocab_items (
      id INTEGER PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      phonetic TEXT,
      audio_url TEXT,
      part_of_speech TEXT,
      definition_en TEXT,
      definition_cn TEXT,
      example_sentence TEXT,
      source_paper_id TEXT,
      context_sentence TEXT,
      repetitions INTEGER DEFAULT 0,
      interval_days REAL DEFAULT 0,
      ease_factor REAL DEFAULT 2.5,
      due_date TEXT,
      last_review_at TEXT,
      total_reviews INTEGER DEFAULT 0,
      correct_reviews INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS offline_vocab_contexts (
      id INTEGER PRIMARY KEY,
      vocab_id INTEGER NOT NULL,
      paper_id TEXT,
      paper_title TEXT,
      sentence TEXT NOT NULL,
      page_number INTEGER,
      block_id INTEGER,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_offline_vocab_ctx_vocab ON offline_vocab_contexts(vocab_id);

    CREATE TABLE IF NOT EXISTS offline_review_events (
      id TEXT PRIMARY KEY,
      vocab_id INTEGER NOT NULL,
      grade TEXT NOT NULL,
      response_time_ms INTEGER,
      reviewed_at TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offline_vocab_queue (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

export async function initOfflineDb(): Promise<void> {
  if (!initPromise) initPromise = initNative();
  return initPromise;
}

// ============================================================
// Legacy key-value cache (backward compatible)
// ============================================================

export async function putCachedJson(key: string, value: unknown): Promise<void> {
  await initOfflineDb();
  const json = JSON.stringify(value);
  if (connection) {
    await connection.run(
      `INSERT INTO cache_entries(cache_key,json_value,updated_at) VALUES(?,?,?)
       ON CONFLICT(cache_key) DO UPDATE SET json_value=excluded.json_value,updated_at=excluded.updated_at`,
      [key, json, new Date().toISOString()],
    );
  } else localStorage.setItem(`offline:${key}`, json);
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  await initOfflineDb();
  if (connection) {
    const result = await connection.query('SELECT json_value FROM cache_entries WHERE cache_key = ?', [key]);
    const json = result.values?.[0]?.json_value as string | undefined;
    return json ? JSON.parse(json) as T : null;
  }
  const json = localStorage.getItem(`offline:${key}`);
  return json ? JSON.parse(json) as T : null;
}

export async function queueOfflineAction(type: string, payload: unknown, id = crypto.randomUUID()): Promise<string> {
  await initOfflineDb();
  if (connection) {
    await connection.run(
      'INSERT OR IGNORE INTO offline_actions(id,action_type,payload,created_at) VALUES(?,?,?,?)',
      [id, type, JSON.stringify(payload), new Date().toISOString()],
    );
  } else {
    const actions = JSON.parse(localStorage.getItem('offline:actions') || '[]') as unknown[];
    actions.push({ id, type, payload, createdAt: new Date().toISOString() });
    localStorage.setItem('offline:actions', JSON.stringify(actions));
  }
  return id;
}

// ============================================================
// Manifest types
// ============================================================

interface ManifestBlock {
  id: number;
  blockIndex: number;
  type: string;
  sectionTitle: string | null;
  content: string | null;
  processedContent: string | null;
  pageNumber: number | null;
  bbox: number[] | null;
  assetPath: string | null;
  assetUrl: string | null;
  caption: string | null;
  charCount: number;
  translation: string | null;
}

interface ManifestAsset {
  blockId: number;
  url: string;
  assetPath: string;
}

interface ManifestTranslation {
  sourceType: string;
  sourceId: number;
  translatedText: string;
}

interface ManifestResponse {
  paperId: string;
  title: string;
  contentVersion: number;
  pdfUrl: string;
  blocks: ManifestBlock[];
  assets: ManifestAsset[];
  translations: ManifestTranslation[];
}

// ============================================================
// Download flow: fetch manifest and cache everything locally
// ============================================================

export async function downloadPaperForOffline(paperId: string, onProgress?: (step: string) => void): Promise<boolean> {
  await initOfflineDb();

  try {
    onProgress?.('获取下载清单...');
    const manifest = await api.get<ManifestResponse>(`/reading/${paperId}/manifest`);

    // 1. Save paper metadata
    onProgress?.('保存论文信息...');
    await savePaperOffline(paperId, manifest.title, manifest.contentVersion);

    // 2. Save all document blocks
    onProgress?.('保存文档块...');
    await saveBlocksOffline(paperId, manifest.blocks);

    // 3. Save all translations
    onProgress?.('保存翻译...');
    await saveTranslationsOffline(manifest.translations);

    // 4. Download and cache PDF
    onProgress?.('下载 PDF...');
    await downloadAssetOffline(paperId, manifest.pdfUrl, 'pdf');

    // 5. Download block assets (figures, tables, etc.)
    onProgress?.('下载图表资源...');
    for (let i = 0; i < manifest.assets.length; i++) {
      const asset = manifest.assets[i];
      await downloadAssetOffline(paperId, asset.url, `block_${asset.blockId}`);
      onProgress?.(`下载图表资源... (${i + 1}/${manifest.assets.length})`);
    }

    // 6. Update last_synced timestamp
    if (connection) {
      await connection.run(
        'UPDATE offline_papers SET last_synced = ? WHERE id = ?',
        [new Date().toISOString(), paperId],
      );
    }

    // Also keep the legacy cache for backward compatibility
    await putCachedJson(`blocks:${paperId}`, {
      blocks: manifest.blocks.map((b) => ({
        id: b.id,
        blockIndex: b.blockIndex,
        type: b.type,
        sectionTitle: b.sectionTitle,
        content: b.content,
        processedContent: b.processedContent,
        pageNumber: b.pageNumber,
        bbox: b.bbox,
        assetUrl: b.assetUrl,
        caption: b.caption,
        translation: b.translation,
      })),
      total: manifest.blocks.length,
    });

    onProgress?.('下载完成');
    return true;
  } catch (e) {
    console.error('[离线] 下载失败:', e);
    return false;
  }
}

async function savePaperOffline(paperId: string, title: string, contentVersion: number): Promise<void> {
  if (connection) {
    await connection.run(
      `INSERT INTO offline_papers(id,title,status,content_version,last_synced) VALUES(?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, content_version=excluded.content_version, last_synced=excluded.last_synced`,
      [paperId, title, 'downloaded', contentVersion, new Date().toISOString()],
    );
  } else {
    const papers = JSON.parse(localStorage.getItem('offline:papers') || '{}');
    papers[paperId] = { id: paperId, title, contentVersion, status: 'downloaded', lastSynced: new Date().toISOString() };
    localStorage.setItem('offline:papers', JSON.stringify(papers));
  }
}

async function saveBlocksOffline(paperId: string, blocks: ManifestBlock[]): Promise<void> {
  if (connection) {
    // Clear existing blocks for this paper, then insert new ones
    await connection.run('DELETE FROM offline_blocks WHERE paper_id = ?', [paperId]);
    for (const b of blocks) {
      await connection.run(
        `INSERT OR REPLACE INTO offline_blocks(id,paper_id,block_type,block_index,content,processed_content,section_title,page_number,bbox,asset_path,caption,char_count,translation)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          b.id, paperId, b.type, b.blockIndex, b.content, b.processedContent,
          b.sectionTitle, b.pageNumber, b.bbox ? JSON.stringify(b.bbox) : null,
          b.assetPath, b.caption, b.charCount, b.translation,
        ],
      );
    }
  } else {
    localStorage.setItem(`offline:blocks_struct:${paperId}`, JSON.stringify(blocks));
  }
}

async function saveTranslationsOffline(translations: ManifestTranslation[]): Promise<void> {
  if (connection) {
    for (const t of translations) {
      await connection.run(
        `INSERT OR REPLACE INTO offline_translations(source_type,source_id,translated_text) VALUES(?,?,?)`,
        [t.sourceType, t.sourceId, t.translatedText],
      );
    }
  } else {
    const existing = JSON.parse(localStorage.getItem('offline:translations') || '[]') as ManifestTranslation[];
    const map = new Map(existing.map((t) => [`${t.sourceType}:${t.sourceId}`, t]));
    for (const t of translations) {
      map.set(`${t.sourceType}:${t.sourceId}`, t);
    }
    localStorage.setItem('offline:translations', JSON.stringify([...map.values()]));
  }
}

async function downloadAssetOffline(paperId: string, url: string, label: string): Promise<void> {
  try {
    const response = await authorizedFetch(resolveApiUrl(url));
    if (!response.ok) return;
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);
    await putCachedJson(`asset:${paperId}:${label}`, { data: base64, type: blob.type });
  } catch (e) {
    console.warn(`[离线] 资产下载失败 (${label}):`, e);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ============================================================
// Offline reading: load data from local SQLite
// ============================================================

export async function getOfflineBlocks(paperId: string): Promise<DocumentBlock[] | null> {
  await initOfflineDb();

  if (connection) {
    const result = await connection.query(
      'SELECT * FROM offline_blocks WHERE paper_id = ? ORDER BY block_index ASC',
      [paperId],
    );
    if (!result.values || result.values.length === 0) return null;
    return result.values.map((row) => ({
      id: row.id as number,
      blockIndex: row.block_index as number,
      type: row.block_type as DocumentBlock['type'],
      sectionTitle: (row.section_title as string) || null,
      content: (row.content as string) || null,
      processedContent: (row.processed_content as string) || null,
      pageNumber: (row.page_number as number) || null,
      bbox: row.bbox ? JSON.parse(row.bbox as string) : null,
      assetUrl: row.asset_path ? `/api/images/block/${row.id}` : null,
      caption: (row.caption as string) || null,
      translation: (row.translation as string) || null,
    }));
  }

  // localStorage fallback
  const blocks = localStorage.getItem(`offline:blocks_struct:${paperId}`);
  if (blocks) {
    const parsed = JSON.parse(blocks) as ManifestBlock[];
    return parsed.map((b) => ({
      id: b.id,
      blockIndex: b.blockIndex,
      type: b.type as DocumentBlock['type'],
      sectionTitle: b.sectionTitle,
      content: b.content,
      processedContent: b.processedContent,
      pageNumber: b.pageNumber,
      bbox: b.bbox,
      assetUrl: b.assetUrl,
      caption: b.caption,
      translation: b.translation,
    }));
  }

  // Try legacy cache
  const legacy = await getCachedJson<{ blocks: DocumentBlock[] }>(`blocks:${paperId}`);
  return legacy?.blocks || null;
}

export async function getOfflineTranslations(paperId: string): Promise<Record<number, string>> {
  await initOfflineDb();
  const result: Record<number, string> = {};

  if (connection) {
    const rows = await connection.query(
      "SELECT source_id, translated_text FROM offline_translations WHERE source_type = 'block'",
      [],
    );
    for (const row of rows.values || []) {
      result[row.source_id as number] = row.translated_text as string;
    }
  } else {
    const translations = JSON.parse(localStorage.getItem('offline:translations') || '[]') as ManifestTranslation[];
    for (const t of translations) {
      if (t.sourceType === 'block') {
        result[t.sourceId] = t.translatedText;
      }
    }
  }

  return result;
}

export async function isPaperDownloadedOffline(paperId: string): Promise<boolean> {
  await initOfflineDb();
  if (connection) {
    const result = await connection.query(
      'SELECT id FROM offline_papers WHERE id = ?',
      [paperId],
    );
    return (result.values?.length || 0) > 0;
  }
  const papers = JSON.parse(localStorage.getItem('offline:papers') || '{}');
  return !!papers[paperId];
}

export async function getOfflinePaperVersion(paperId: string): Promise<number | null> {
  await initOfflineDb();
  if (connection) {
    const result = await connection.query(
      'SELECT content_version FROM offline_papers WHERE id = ?',
      [paperId],
    );
    return result.values?.[0]?.content_version as number || null;
  }
  const papers = JSON.parse(localStorage.getItem('offline:papers') || '{}');
  return papers[paperId]?.contentVersion || null;
}

// ============================================================
// Review events: offline-first with UUID dedup
// ============================================================

export async function saveOfflineReviewEvent(
  eventId: string,
  vocabId: number,
  grade: string,
  responseTimeMs: number | undefined,
  reviewedAt: string,
): Promise<void> {
  await initOfflineDb();
  if (connection) {
    await connection.run(
      `INSERT OR IGNORE INTO offline_review_events(id,vocab_id,grade,response_time_ms,reviewed_at,synced,created_at)
       VALUES(?,?,?,?,?,?,?)`,
      [eventId, vocabId, grade, responseTimeMs || null, reviewedAt, 0, new Date().toISOString()],
    );
  } else {
    const events = JSON.parse(localStorage.getItem('offline:review_events') || '[]') as unknown[];
    events.push({ id: eventId, vocabId, grade, responseTimeMs, reviewedAt, synced: false, createdAt: new Date().toISOString() });
    localStorage.setItem('offline:review_events', JSON.stringify(events));
  }
}

// ============================================================
// Vocab offline queue
// ============================================================

export async function saveOfflineVocabAddition(payload: Record<string, unknown>): Promise<string> {
  const id = crypto.randomUUID();
  await initOfflineDb();
  if (connection) {
    await connection.run(
      'INSERT OR REPLACE INTO offline_vocab_queue(id,payload,synced,created_at) VALUES(?,?,?,?)',
      [id, JSON.stringify(payload), 0, new Date().toISOString()],
    );
  } else {
    const queue = JSON.parse(localStorage.getItem('offline:vocab_queue') || '[]') as unknown[];
    queue.push({ id, payload, synced: false, createdAt: new Date().toISOString() });
    localStorage.setItem('offline:vocab_queue', JSON.stringify(queue));
  }
  return id;
}

// ============================================================
// Sync: push offline data to server when back online
// ============================================================

export async function syncOfflineData(): Promise<{ synced: number; failed: number }> {
  await initOfflineDb();
  let synced = 0;
  let failed = 0;

  // 1. Sync review events
  try {
    const events = await getUnsyncedReviewEvents();
    for (const event of events) {
      try {
        await api.post(`/vocab/review/${event.vocabId}`, {
          grade: event.grade,
          responseTimeMs: event.responseTimeMs,
          eventId: event.id,
          reviewedAt: event.reviewedAt,
        });
        await markReviewEventSynced(event.id);
        synced++;
      } catch (e) {
        console.warn('[同步] 复习事件同步失败:', e);
        failed++;
      }
    }
  } catch (e) {
    console.warn('[同步] 获取复习事件失败:', e);
  }

  // 2. Sync vocab additions
  try {
    const vocabs = await getUnsyncedVocabQueue();
    for (const item of vocabs) {
      try {
        await api.post('/vocab/add', item.payload);
        await markVocabQueueSynced(item.id);
        synced++;
      } catch (e) {
        console.warn('[同步] 生词同步失败:', e);
        failed++;
      }
    }
  } catch (e) {
    console.warn('[同步] 获取生词队列失败:', e);
  }

  // 3. Sync legacy offline actions
  try {
    const actions = await getLegacyOfflineActions();
    for (const action of actions) {
      try {
        if (action.type === 'add_vocab') {
          await api.post('/vocab/add', action.payload);
        } else if (action.type === 'review') {
          const payload = action.payload as { vocabId: number; grade: string };
          await api.post(`/vocab/review/${payload.vocabId}`, action.payload);
        }
        await removeLegacyAction(action.id);
        synced++;
      } catch (e) {
        console.warn('[同步] 旧队列同步失败:', e);
        failed++;
      }
    }
  } catch (e) {
    console.warn('[同步] 获取旧队列失败:', e);
  }

  return { synced, failed };
}

// ============================================================
// Internal helpers for sync
// ============================================================

interface UnsyncedEvent {
  id: string;
  vocabId: number;
  grade: string;
  responseTimeMs: number | null;
  reviewedAt: string;
}

async function getUnsyncedReviewEvents(): Promise<UnsyncedEvent[]> {
  if (connection) {
    const result = await connection.query(
      'SELECT id, vocab_id, grade, response_time_ms, reviewed_at FROM offline_review_events WHERE synced = 0 ORDER BY created_at ASC',
      [],
    );
    return (result.values || []).map((row) => ({
      id: row.id as string,
      vocabId: row.vocab_id as number,
      grade: row.grade as string,
      responseTimeMs: row.response_time_ms as number | null,
      reviewedAt: row.reviewed_at as string,
    }));
  }
  const events = JSON.parse(localStorage.getItem('offline:review_events') || '[]') as (UnsyncedEvent & { synced: boolean })[];
  return events.filter((e) => !e.synced);
}

async function markReviewEventSynced(id: string): Promise<void> {
  if (connection) {
    await connection.run('UPDATE offline_review_events SET synced = 1 WHERE id = ?', [id]);
  } else {
    const events = JSON.parse(localStorage.getItem('offline:review_events') || '[]') as (UnsyncedEvent & { synced: boolean })[];
    const updated = events.map((e) => (e.id === id ? { ...e, synced: true } : e));
    localStorage.setItem('offline:review_events', JSON.stringify(updated));
  }
}

interface UnsyncedVocab {
  id: string;
  payload: Record<string, unknown>;
}

async function getUnsyncedVocabQueue(): Promise<UnsyncedVocab[]> {
  if (connection) {
    const result = await connection.query(
      'SELECT id, payload FROM offline_vocab_queue WHERE synced = 0 ORDER BY created_at ASC',
      [],
    );
    return (result.values || []).map((row) => ({
      id: row.id as string,
      payload: JSON.parse(row.payload as string),
    }));
  }
  const queue = JSON.parse(localStorage.getItem('offline:vocab_queue') || '[]') as (UnsyncedVocab & { synced: boolean })[];
  return queue.filter((v) => !v.synced);
}

async function markVocabQueueSynced(id: string): Promise<void> {
  if (connection) {
    await connection.run('UPDATE offline_vocab_queue SET synced = 1 WHERE id = ?', [id]);
  } else {
    const queue = JSON.parse(localStorage.getItem('offline:vocab_queue') || '[]') as (UnsyncedVocab & { synced: boolean })[];
    const updated = queue.map((v) => (v.id === id ? { ...v, synced: true } : v));
    localStorage.setItem('offline:vocab_queue', JSON.stringify(updated));
  }
}

interface LegacyAction {
  id: string;
  type: string;
  payload: unknown;
}

async function getLegacyOfflineActions(): Promise<LegacyAction[]> {
  if (connection) {
    const result = await connection.query(
      'SELECT id, action_type, payload FROM offline_actions ORDER BY created_at ASC',
      [],
    );
    return (result.values || []).map((row) => ({
      id: row.id as string,
      type: row.action_type as string,
      payload: JSON.parse(row.payload as string),
    }));
  }
  return JSON.parse(localStorage.getItem('offline:actions') || '[]');
}

async function removeLegacyAction(id: string): Promise<void> {
  if (connection) {
    await connection.run('DELETE FROM offline_actions WHERE id = ?', [id]);
  } else {
    const actions = JSON.parse(localStorage.getItem('offline:actions') || '[]') as (LegacyAction & { createdAt: string })[];
    const filtered = actions.filter((a) => a.id !== id);
    localStorage.setItem('offline:actions', JSON.stringify(filtered));
  }
}

// ============================================================
// Network status helper
// ============================================================

export function isOnline(): boolean {
  return navigator.onLine;
}

export function onOnlineChange(callback: (online: boolean) => void): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
