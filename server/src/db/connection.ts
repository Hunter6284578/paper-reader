import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { ENV } from '../config.js';
import * as schema from './schema.js';

// 确保数据目录存在
mkdirSync(dirname(ENV.DB_PATH), { recursive: true });

const sqlite: DatabaseType = new Database(ENV.DB_PATH);
const db = drizzle(sqlite, { schema });

// 启用 WAL 模式提升并发性能
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Legacy bootstrap helpers are retained only to baseline pre-migration deployments.
function hasTable(name: string): boolean {
  return Boolean(sqlite.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(name));
}

function hasColumn(table: string, column: string): boolean {
  return (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>)
    .some((entry) => entry.name === column);
}

const migrateCoreFeatures = sqlite.transaction(() => {
  if (hasTable('papers') && !hasColumn('papers', 'paragraph_status')) {
    sqlite.exec(`ALTER TABLE papers ADD COLUMN paragraph_status TEXT NOT NULL DEFAULT 'pending'`);
  }
  if (hasTable('papers') && !hasColumn('papers', 'processing_error')) {
    sqlite.exec(`ALTER TABLE papers ADD COLUMN processing_error TEXT`);
  }
  if (hasTable('papers') && !hasColumn('papers', 'content_version')) {
    sqlite.exec(`ALTER TABLE papers ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1`);
  }
  if (hasTable('papers') && !hasColumn('papers', 'doi')) {
    sqlite.exec(`ALTER TABLE papers ADD COLUMN doi TEXT`);
  }

  if (hasTable('paragraphs') && !hasColumn('paragraphs', 'processed_content')) {
    sqlite.exec(`ALTER TABLE paragraphs ADD COLUMN processed_content TEXT`);
  }

  if (hasTable('highlights') && !hasColumn('highlights', 'paragraph_id')) {
    sqlite.exec(`ALTER TABLE highlights ADD COLUMN paragraph_id INTEGER`);
  }
  if (hasTable('chunks') && !hasColumn('chunks', 'block_id')) {
    sqlite.exec(`ALTER TABLE chunks ADD COLUMN block_id INTEGER`);
  }
  if (hasTable('chunks') && !hasColumn('chunks', 'embedding')) {
    sqlite.exec(`ALTER TABLE chunks ADD COLUMN embedding TEXT`);
  }

  if (hasTable('papers')) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS page_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        file_size INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_page_images_paper_page
        ON page_images (paper_id, page_number);
      CREATE INDEX IF NOT EXISTS idx_page_images_paper
        ON page_images (paper_id);

      CREATE TABLE IF NOT EXISTS processing_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id TEXT NOT NULL UNIQUE REFERENCES papers(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT, finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status, created_at);

      CREATE TABLE IF NOT EXISTS document_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        block_index INTEGER NOT NULL, block_type TEXT NOT NULL,
        section_title TEXT, content TEXT, processed_content TEXT,
        page_number INTEGER, bbox TEXT, asset_path TEXT, caption TEXT,
        char_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(paper_id, block_index)
      );
      CREATE INDEX IF NOT EXISTS idx_document_blocks_paper ON document_blocks(paper_id);

      CREATE TABLE IF NOT EXISTS model_settings (
        id INTEGER PRIMARY KEY, encrypted_api_key TEXT, iv TEXT, auth_tag TEXT,
        model TEXT NOT NULL DEFAULT 'deepseek-chat',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS device_tokens (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT 'Android device', revoked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT
      );
      CREATE TABLE IF NOT EXISTS vocab_contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vocab_id INTEGER NOT NULL REFERENCES vocab_items(id) ON DELETE CASCADE,
        paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
        paper_title TEXT, sentence TEXT NOT NULL, page_number INTEGER, block_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_vocab_contexts_vocab ON vocab_contexts(vocab_id);
      CREATE TABLE IF NOT EXISTS review_events (
        id TEXT PRIMARY KEY,
        vocab_id INTEGER NOT NULL REFERENCES vocab_items(id) ON DELETE CASCADE,
        grade TEXT NOT NULL, response_time_ms INTEGER, reviewed_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_review_events_vocab ON review_events(vocab_id);

      CREATE TABLE IF NOT EXISTS study_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        new_words_count INTEGER NOT NULL DEFAULT 0,
        review_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reading_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        blocks_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reading_sessions_paper ON reading_sessions(paper_id);
    `);
  }

  // vocabItems 新增字段迁移
  if (hasTable('vocab_items')) {
    if (!hasColumn('vocab_items', 'learned_at')) {
      sqlite.exec(`ALTER TABLE vocab_items ADD COLUMN learned_at TEXT`);
    }
    if (!hasColumn('vocab_items', 'word_roots')) {
      sqlite.exec(`ALTER TABLE vocab_items ADD COLUMN word_roots TEXT`);
    }
    if (!hasColumn('vocab_items', 'mnemonic')) {
      sqlite.exec(`ALTER TABLE vocab_items ADD COLUMN mnemonic TEXT`);
    }
  }
});

if (hasTable('papers') && !hasTable('__drizzle_migrations')) {
  migrateCoreFeatures();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `);
  sqlite.prepare('INSERT INTO __drizzle_migrations(hash, created_at) VALUES(?, ?)')
    .run('legacy-baseline', 1783070243671);
}

migrate(db, { migrationsFolder: ENV.MIGRATIONS_DIR });

export { db };
export { sqlite };
