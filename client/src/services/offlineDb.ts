import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection, type capSQLiteSet } from '@capacitor-community/sqlite';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { api, resolveApiUrl, authorizedFetch } from './api';
import type { DocumentBlock } from '../types';
import type { OutboxAction, OutboxStatus, OutboxStore, PaperSnapshotStore } from './offline/contracts';

let connection: SQLiteDBConnection | null = null;
let initPromise: Promise<void> | null = null;

// ============================================================
// Schema version — bump when adding breaking changes
// ============================================================
const SCHEMA_VERSION = 3;

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

    CREATE TABLE IF NOT EXISTS offline_outbox (
      id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      next_attempt_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_offline_outbox_created ON offline_outbox(created_at);
  `);

  const outboxColumns = await connection.query('PRAGMA table_info(offline_outbox)');
  const names = new Set((outboxColumns.values || []).map((column) => column.name as string));
  if (!names.has('status')) await connection.execute("ALTER TABLE offline_outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
  if (!names.has('next_attempt_at')) await connection.execute('ALTER TABLE offline_outbox ADD COLUMN next_attempt_at TEXT');

  await migrateLegacyOutbox();
}

export async function initOfflineDb(): Promise<void> {
  if (!Capacitor.isNativePlatform()) migrateLegacyWebOutbox();
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

export async function queueOfflineAction(type: string, payload: unknown, id: string = crypto.randomUUID()): Promise<string> {
  await initOfflineDb();
  await putOutboxItem(id, type, payload);
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

    // Download assets before publishing the new Paper Snapshot.
    onProgress?.('下载 PDF...');
    await downloadAssetOffline(paperId, manifest.pdfUrl, 'pdf');

    onProgress?.('下载图表资源...');
    const localAssets = new Map<number, string>();
    for (let i = 0; i < manifest.assets.length; i++) {
      const asset = manifest.assets[i];
      localAssets.set(asset.blockId, await downloadAssetOffline(paperId, asset.url, `block_${asset.blockId}`));
      onProgress?.(`下载图表资源... (${i + 1}/${manifest.assets.length})`);
    }

    // Metadata, Reading Blocks, and translations become visible atomically.
    onProgress?.('提交离线快照...');
    await commitPaperSnapshot(paperId, manifest, localAssets);

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

async function commitPaperSnapshot(paperId: string, manifest: ManifestResponse, localAssets: Map<number, string>): Promise<void> {
  if (connection) {
    const statements: capSQLiteSet[] = [
      {
        statement: "DELETE FROM offline_translations WHERE source_type = 'block' AND source_id IN (SELECT id FROM offline_blocks WHERE paper_id = ?)",
        values: [paperId],
      },
      { statement: 'DELETE FROM offline_blocks WHERE paper_id = ?', values: [paperId] },
      ...manifest.blocks.map((block) => ({
        statement: `INSERT INTO offline_blocks(id,paper_id,block_type,block_index,content,processed_content,section_title,page_number,bbox,asset_path,asset_local_path,caption,char_count,translation)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        values: [
          block.id, paperId, block.type, block.blockIndex, block.content, block.processedContent,
          block.sectionTitle, block.pageNumber, block.bbox ? JSON.stringify(block.bbox) : null,
          block.assetPath, localAssets.get(block.id) || null, block.caption, block.charCount, block.translation,
        ],
      })),
      ...manifest.translations.map((translation) => ({
        statement: 'INSERT OR REPLACE INTO offline_translations(source_type,source_id,translated_text) VALUES(?,?,?)',
        values: [translation.sourceType, translation.sourceId, translation.translatedText],
      })),
      {
        statement: `INSERT INTO offline_papers(id,title,status,content_version,last_synced) VALUES(?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET title=excluded.title,status=excluded.status,content_version=excluded.content_version,last_synced=excluded.last_synced`,
        values: [paperId, manifest.title, 'downloaded', manifest.contentVersion, new Date().toISOString()],
      },
    ];
    await connection.executeSet(statements, true);
    return;
  }

  localStorage.setItem(`offline:snapshot:${paperId}`, JSON.stringify({
    paper: { id: paperId, title: manifest.title, status: 'downloaded', contentVersion: manifest.contentVersion, lastSynced: new Date().toISOString() },
    blocks: manifest.blocks.map((block) => ({ ...block, assetUrl: localAssets.get(block.id) || block.assetUrl })),
    translations: manifest.translations,
  }));
}

async function downloadAssetOffline(paperId: string, url: string, label: string): Promise<string> {
  try {
    const response = await authorizedFetch(resolveApiUrl(url));
    if (!response.ok) throw new Error(`asset download failed: HTTP ${response.status}`);
    const blob = await response.blob();
    if (Capacitor.isNativePlatform()) {
      const data = (await blobToBase64(blob)).replace(/^data:[^;]+;base64,/, '');
      const path = `paper-reader/${paperId}/${label}`;
      await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
      return Capacitor.convertFileSrc((await Filesystem.getUri({ path, directory: Directory.Data })).uri);
    }
    await putBrowserAsset(`${paperId}:${label}`, blob);
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn(`[离线] 资产下载失败 (${label}):`, e);
    throw e;
  }
}

function openBrowserAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('paper_reader_assets', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putBrowserAsset(key: string, blob: Blob): Promise<void> {
  const database = await openBrowserAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('assets', 'readwrite');
    transaction.objectStore('assets').put(blob, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function getBrowserAssetUrl(key: string): Promise<string | null> {
  if (typeof indexedDB === 'undefined') return null;
  const database = await openBrowserAssetDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction('assets', 'readonly').objectStore('assets').get(key);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return blob ? URL.createObjectURL(blob) : null;
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
      assetUrl: (row.asset_local_path as string) || (row.asset_path ? `/api/images/block/${row.id}` : null),
      caption: (row.caption as string) || null,
      translation: (row.translation as string) || null,
    }));
  }

  // localStorage fallback
  const snapshot = localStorage.getItem(`offline:snapshot:${paperId}`);
  if (snapshot) {
    const parsed = JSON.parse(snapshot) as { blocks: ManifestBlock[] };
    return Promise.all(parsed.blocks.map(async (b) => ({
      id: b.id,
      blockIndex: b.blockIndex,
      type: b.type as DocumentBlock['type'],
      sectionTitle: b.sectionTitle,
      content: b.content,
      processedContent: b.processedContent,
      pageNumber: b.pageNumber,
      bbox: b.bbox,
      assetUrl: b.assetPath ? (await getBrowserAssetUrl(`${paperId}:block_${b.id}`) || b.assetUrl) : null,
      caption: b.caption,
      translation: b.translation,
    })));
  }
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
      `SELECT t.source_id, t.translated_text
       FROM offline_translations t JOIN offline_blocks b ON b.id = t.source_id
       WHERE t.source_type = 'block' AND b.paper_id = ?`,
      [paperId],
    );
    for (const row of rows.values || []) {
      result[row.source_id as number] = row.translated_text as string;
    }
  } else {
    const snapshot = localStorage.getItem(`offline:snapshot:${paperId}`);
    const translations = snapshot
      ? (JSON.parse(snapshot) as { translations: ManifestTranslation[] }).translations
      : JSON.parse(localStorage.getItem('offline:translations') || '[]') as ManifestTranslation[];
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
  if (localStorage.getItem(`offline:snapshot:${paperId}`)) return true;
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
  const snapshot = localStorage.getItem(`offline:snapshot:${paperId}`);
  if (snapshot) return (JSON.parse(snapshot) as { paper: { contentVersion: number } }).paper.contentVersion;
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
  await putOutboxItem(eventId, 'review', { eventId, vocabId, grade, responseTimeMs, reviewedAt });
}

// ============================================================
// Vocab offline queue
// ============================================================

export async function saveOfflineVocabAddition(payload: Record<string, unknown>): Promise<string> {
  const id = crypto.randomUUID();
  await initOfflineDb();
  await putOutboxItem(id, 'add_vocab', payload);
  return id;
}

// ============================================================
// Sync: push offline data to server when back online
// ============================================================

export async function syncOfflineData(): Promise<{ synced: number; failed: number }> {
  await initOfflineDb();
  let synced = 0;
  let failed = 0;

  const items = await getOutboxItems();
  for (const item of items) {
    try {
      if (item.type === 'add_vocab') {
        await api.post('/vocab/add', item.payload);
      } else if (item.type === 'review') {
        const payload = item.payload as { vocabId: number };
        await api.post(`/vocab/review/${payload.vocabId}`, item.payload);
      } else {
        throw new Error(`未知离线操作: ${item.type}`);
      }
      await removeOutboxItem(item.id);
      synced++;
    } catch (error) {
      await recordOutboxFailure(item.id, error instanceof Error ? error.message : String(error));
      failed++;
    }
  }

  return { synced, failed };
}

interface OutboxItem {
  id: string;
  type: string;
  payload: unknown;
  attempts?: number;
  status?: 'pending' | 'retrying' | 'dead';
  nextAttemptAt?: string;
  lastError?: string;
}

async function putOutboxItem(id: string, type: string, payload: unknown): Promise<void> {
  if (connection) {
    await connection.run(
      'INSERT OR IGNORE INTO offline_outbox(id,action_type,payload,created_at) VALUES(?,?,?,?)',
      [id, type, JSON.stringify(payload), new Date().toISOString()],
    );
    return;
  }
  const items = JSON.parse(localStorage.getItem('offline:outbox') || '[]') as Array<OutboxItem & { attempts: number; createdAt: string }>;
  if (!items.some((item) => item.id === id)) {
    items.push({ id, type, payload, attempts: 0, createdAt: new Date().toISOString() });
    localStorage.setItem('offline:outbox', JSON.stringify(items));
  }
}

async function getOutboxItems(): Promise<OutboxItem[]> {
  if (connection) {
    const result = await connection.query("SELECT id, action_type, payload, attempts, status, next_attempt_at, last_error FROM offline_outbox WHERE status != 'dead' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at", [new Date().toISOString()]);
    return (result.values || []).map((row) => ({ id: row.id as string, type: row.action_type as string, payload: JSON.parse(row.payload as string), attempts: row.attempts as number, status: row.status as OutboxItem['status'], nextAttemptAt: row.next_attempt_at as string | undefined, lastError: row.last_error as string | undefined }));
  }
  const now = Date.now();
  return (JSON.parse(localStorage.getItem('offline:outbox') || '[]') as OutboxItem[])
    .filter((item) => item.status !== 'dead' && (!item.nextAttemptAt || new Date(item.nextAttemptAt).getTime() <= now));
}

async function removeOutboxItem(id: string): Promise<void> {
  if (connection) {
    await connection.executeSet([
      { statement: 'DELETE FROM offline_outbox WHERE id = ?', values: [id] },
      { statement: 'DELETE FROM offline_actions WHERE id = ?', values: [id] },
      { statement: 'DELETE FROM offline_review_events WHERE id = ?', values: [id] },
      { statement: 'DELETE FROM offline_vocab_queue WHERE id = ?', values: [id] },
    ], true);
    return;
  }
  const items = JSON.parse(localStorage.getItem('offline:outbox') || '[]') as OutboxItem[];
  localStorage.setItem('offline:outbox', JSON.stringify(items.filter((item) => item.id !== id)));
}

async function recordOutboxFailure(id: string, message: string): Promise<void> {
  const current = await getOutboxItem(id);
  const attempts = (current?.attempts || 0) + 1;
  const status = attempts >= 5 ? 'dead' : 'retrying';
  const nextAttemptAt = new Date(Date.now() + Math.min(60_000, 1000 * (2 ** attempts))).toISOString();
  if (connection) {
    await connection.run('UPDATE offline_outbox SET attempts = ?, last_error = ?, status = ?, next_attempt_at = ? WHERE id = ?', [attempts, message.slice(0, 500), status, nextAttemptAt, id]);
    return;
  }
  const items = JSON.parse(localStorage.getItem('offline:outbox') || '[]') as Array<OutboxItem & { attempts?: number; lastError?: string }>;
  localStorage.setItem('offline:outbox', JSON.stringify(items.map((item) => item.id === id ? { ...item, attempts, status, nextAttemptAt, lastError: message.slice(0, 500) } : item)));
}

async function getOutboxItem(id: string): Promise<OutboxItem | null> {
  if (connection) {
    const result = await connection.query('SELECT id, action_type, payload, attempts, status, next_attempt_at, last_error FROM offline_outbox WHERE id = ?', [id]);
    const row = result.values?.[0];
    return row ? { id: row.id as string, type: row.action_type as string, payload: JSON.parse(row.payload as string), attempts: row.attempts as number, status: row.status as OutboxItem['status'], nextAttemptAt: row.next_attempt_at as string | undefined, lastError: row.last_error as string | undefined } : null;
  }
  return (JSON.parse(localStorage.getItem('offline:outbox') || '[]') as OutboxItem[]).find((item) => item.id === id) || null;
}

async function migrateLegacyOutbox(): Promise<void> {
  if (!connection) return;
  const actions = await connection.query('SELECT id, action_type, payload FROM offline_actions', []);
  const reviews = await connection.query('SELECT id, vocab_id, grade, response_time_ms, reviewed_at FROM offline_review_events WHERE synced = 0', []);
  const vocabs = await connection.query('SELECT id, payload FROM offline_vocab_queue WHERE synced = 0', []);
  const statements: capSQLiteSet[] = [];
  for (const row of actions.values || []) statements.push({ statement: 'INSERT OR IGNORE INTO offline_outbox(id,action_type,payload,created_at) VALUES(?,?,?,?)', values: [row.id, row.action_type, row.payload, new Date().toISOString()] });
  for (const row of reviews.values || []) statements.push({
    statement: 'INSERT OR IGNORE INTO offline_outbox(id,action_type,payload,created_at) VALUES(?,?,?,?)',
    values: [row.id, 'review', JSON.stringify({ eventId: row.id, vocabId: row.vocab_id, grade: row.grade, responseTimeMs: row.response_time_ms, reviewedAt: row.reviewed_at }), new Date().toISOString()],
  });
  for (const row of vocabs.values || []) statements.push({ statement: 'INSERT OR IGNORE INTO offline_outbox(id,action_type,payload,created_at) VALUES(?,?,?,?)', values: [row.id, 'add_vocab', row.payload, new Date().toISOString()] });
  if (statements.length > 0) await connection.executeSet(statements, true);
}

function migrateLegacyWebOutbox(): void {
  if (localStorage.getItem('offline:outbox:migrated') === '1') return;
  const outbox = JSON.parse(localStorage.getItem('offline:outbox') || '[]') as OutboxItem[];
  const seen = new Set(outbox.map((item) => item.id));
  const actions = JSON.parse(localStorage.getItem('offline:actions') || '[]') as Array<{ id: string; type: string; payload: unknown }>;
  const reviews = JSON.parse(localStorage.getItem('offline:review_events') || '[]') as Array<{ id: string; vocabId: number; grade: string; responseTimeMs?: number; reviewedAt: string; synced?: boolean }>;
  const vocabs = JSON.parse(localStorage.getItem('offline:vocab_queue') || '[]') as Array<{ id: string; payload: unknown; synced?: boolean }>;
  for (const item of actions) if (!seen.has(item.id)) outbox.push({ id: item.id, type: item.type, payload: item.payload });
  for (const item of reviews) if (!item.synced && !seen.has(item.id)) outbox.push({ id: item.id, type: 'review', payload: { eventId: item.id, vocabId: item.vocabId, grade: item.grade, responseTimeMs: item.responseTimeMs, reviewedAt: item.reviewedAt } });
  for (const item of vocabs) if (!item.synced && !seen.has(item.id)) outbox.push({ id: item.id, type: 'add_vocab', payload: item.payload });
  localStorage.setItem('offline:outbox', JSON.stringify(outbox));
  localStorage.setItem('offline:outbox:migrated', '1');
  localStorage.removeItem('offline:actions');
  localStorage.removeItem('offline:review_events');
  localStorage.removeItem('offline:vocab_queue');
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

export async function getOfflineOutboxStatus(): Promise<OutboxStatus> {
  await initOfflineDb();
  if (connection) {
    const result = await connection.query('SELECT status, count(*) AS count FROM offline_outbox GROUP BY status');
    const status: OutboxStatus = { pending: 0, retrying: 0, dead: 0 };
    for (const row of result.values || []) {
      const key = (row.status || 'pending') as keyof OutboxStatus;
      if (key in status) status[key] = Number(row.count || 0);
    }
    return status;
  }
  const status: OutboxStatus = { pending: 0, retrying: 0, dead: 0 };
  for (const item of JSON.parse(localStorage.getItem('offline:outbox') || '[]') as OutboxItem[]) {
    status[item.status || 'pending']++;
  }
  return status;
}

export const outboxStore: OutboxStore = {
  enqueue: (action: OutboxAction, id?: string) => queueOfflineAction(action.type, action.payload, id),
  sync: syncOfflineData,
  status: getOfflineOutboxStatus,
};

export const paperSnapshotStore: PaperSnapshotStore = {
  download: downloadPaperForOffline,
  blocks: getOfflineBlocks,
  contentVersion: getOfflinePaperVersion,
};
