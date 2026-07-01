/**
 * 直接创建数据库表结构（绕过 drizzle-kit push 交互式问题）
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const dbPath = './data/db/app.db';
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// 启用 WAL 模式
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const tables = [
  // 用户表
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // 论文表
  `CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    page_count INTEGER,
    abstract TEXT,
    authors TEXT,
    tags TEXT,
    status TEXT NOT NULL DEFAULT 'unread',
    processing_status TEXT NOT NULL DEFAULT 'pending',
    paragraph_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_papers_status ON papers (status)`,

  // 文本分块表（RAG）
  `CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    section_title TEXT,
    page_number INTEGER,
    token_count INTEGER,
    embedding TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_paper ON chunks (paper_id)`,

  // 高亮/批注表
  `CREATE TABLE IF NOT EXISTS highlights (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    page_number INTEGER,
    paragraph_id INTEGER,
    position TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'highlight',
    color TEXT NOT NULL DEFAULT '#FFEB3B',
    comment TEXT,
    selected_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_highlights_paper ON highlights (paper_id)`,

  // 生词表
  `CREATE TABLE IF NOT EXISTS vocab_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    phonetic TEXT,
    audio_url TEXT,
    part_of_speech TEXT,
    definition_en TEXT,
    definition_cn TEXT,
    example_sentence TEXT,
    source_paper_id TEXT REFERENCES papers(id),
    context_sentence TEXT,
    repetitions INTEGER NOT NULL DEFAULT 0,
    interval_days REAL NOT NULL DEFAULT 0,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    due_date TEXT NOT NULL DEFAULT (datetime('now')),
    last_review_at TEXT,
    total_reviews INTEGER NOT NULL DEFAULT 0,
    correct_reviews INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_word ON vocab_items (word)`,
  `CREATE INDEX IF NOT EXISTS idx_vocab_due ON vocab_items (due_date, status)`,

  // 复习记录表
  `CREATE TABLE IF NOT EXISTS review_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vocab_id INTEGER NOT NULL REFERENCES vocab_items(id) ON DELETE CASCADE,
    quality INTEGER NOT NULL,
    prev_interval REAL,
    new_interval REAL,
    prev_ease_factor REAL,
    new_ease_factor REAL,
    response_time_ms INTEGER,
    reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_review_vocab ON review_logs (vocab_id)`,
  `CREATE INDEX IF NOT EXISTS idx_review_date ON review_logs (reviewed_at)`,

  // 词典缓存表
  `CREATE TABLE IF NOT EXISTS dict_cache (
    word TEXT PRIMARY KEY,
    response TEXT NOT NULL,
    cached_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // 聊天历史表
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    "references" TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_paper ON chat_messages (paper_id)`,

  // 自然段落表
  `CREATE TABLE IF NOT EXISTS paragraphs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    section_title TEXT,
    paragraph_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    processed_content TEXT,
    char_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_paragraphs_paper ON paragraphs (paper_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_paragraphs_paper_idx ON paragraphs (paper_id, paragraph_index)`,

  // 句子表
  `CREATE TABLE IF NOT EXISTS sentences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    paragraph_id INTEGER NOT NULL REFERENCES paragraphs(id) ON DELETE CASCADE,
    sentence_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sentences_paragraph ON sentences (paragraph_id)`,

  // 翻译缓存表
  `CREATE TABLE IF NOT EXISTS translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    original_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_translations_source ON translations (source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_translations_paper ON translations (paper_id)`,

  // PDF 页面图片
  `CREATE TABLE IF NOT EXISTS page_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    file_size INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_page_images_paper_page ON page_images (paper_id, page_number)`,
  `CREATE INDEX IF NOT EXISTS idx_page_images_paper ON page_images (paper_id)`,
];

const runAll = db.transaction(() => {
  for (const sql of tables) {
    db.exec(sql);
  }
});

runAll();
console.log('✅ 所有表已创建完成');
db.close();
