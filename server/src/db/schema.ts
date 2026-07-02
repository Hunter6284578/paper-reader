import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================================
// 用户表
// ============================================================
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ============================================================
// 论文表
// ============================================================
export const papers = sqliteTable('papers', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  filePath: text('file_path').notNull(),
  fileSize: integer('file_size'),
  pageCount: integer('page_count'),
  abstract: text('abstract'),
  authors: text('authors'),           // JSON array
  doi: text('doi'),                   // CrossRef DOI
  tags: text('tags'),                 // JSON array
  status: text('status').notNull().default('unread'),
  processingStatus: text('processing_status').notNull().default('pending'),
  paragraphStatus: text('paragraph_status').notNull().default('pending'),
  processingError: text('processing_error'),
  contentVersion: integer('content_version').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_papers_status').on(table.status),
]);

// ============================================================
// 论文文本分块表（用于 RAG）
// ============================================================
export const chunks = sqliteTable('chunks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  sectionTitle: text('section_title'),
  pageNumber: integer('page_number'),
  blockId: integer('block_id'),
  tokenCount: integer('token_count'),
  embedding: text('embedding'), // JSON-serialized float32 array (1024-dim from bge-m3)
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_chunks_paper').on(table.paperId),
]);

// ============================================================
// 高亮/批注表
// ============================================================
export const highlights = sqliteTable('highlights', {
  id: text('id').primaryKey(),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  pageNumber: integer('page_number'),
  paragraphId: integer('paragraph_id'),
  position: text('position').notNull(),  // JSON: { boundingRect, rects } or { mode:'text', paragraphId, startOffset, endOffset }
  type: text('type').notNull().default('highlight'),
  color: text('color').notNull().default('#FFEB3B'),
  comment: text('comment'),
  selectedText: text('selected_text'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_highlights_paper').on(table.paperId),
]);

// ============================================================
// 生词表（含 SM-2 复习状态）
// ============================================================
export const vocabItems = sqliteTable('vocab_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  word: text('word').notNull(),
  phonetic: text('phonetic'),
  audioUrl: text('audio_url'),
  partOfSpeech: text('part_of_speech'),
  definitionEn: text('definition_en'),
  definitionCn: text('definition_cn'),
  exampleSentence: text('example_sentence'),
  sourcePaperId: text('source_paper_id').references(() => papers.id),
  contextSentence: text('context_sentence'),
  // 学习增强字段
  learnedAt: text('learned_at'),
  wordRoots: text('word_roots'),           // JSON: 词根词缀分析
  mnemonic: text('mnemonic'),              // 助记方法
  // SM-2 状态
  repetitions: integer('repetitions').notNull().default(0),
  intervalDays: real('interval_days').notNull().default(0),
  easeFactor: real('ease_factor').notNull().default(2.5),
  dueDate: text('due_date').notNull().default(sql`(datetime('now'))`),
  lastReviewAt: text('last_review_at'),
  totalReviews: integer('total_reviews').notNull().default(0),
  correctReviews: integer('correct_reviews').notNull().default(0),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_vocab_word').on(table.word),
  index('idx_vocab_due').on(table.dueDate, table.status),
]);

// ============================================================
// 复习记录表
// ============================================================
export const reviewLogs = sqliteTable('review_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vocabId: integer('vocab_id').notNull().references(() => vocabItems.id, { onDelete: 'cascade' }),
  quality: integer('quality').notNull(),
  prevInterval: real('prev_interval'),
  newInterval: real('new_interval'),
  prevEaseFactor: real('prev_ease_factor'),
  newEaseFactor: real('new_ease_factor'),
  responseTimeMs: integer('response_time_ms'),
  reviewedAt: text('reviewed_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_review_vocab').on(table.vocabId),
  index('idx_review_date').on(table.reviewedAt),
]);

// ============================================================
// 词典缓存表
// ============================================================
export const dictCache = sqliteTable('dict_cache', {
  word: text('word').primaryKey(),
  response: text('response').notNull(),
  cachedAt: text('cached_at').notNull().default(sql`(datetime('now'))`),
});

// ============================================================
// 聊天历史表
// ============================================================
export const chatMessages = sqliteTable('chat_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),          // user | assistant
  content: text('content').notNull(),
  references: text('references'),         // JSON: [{ chunkId, score }]
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_chat_paper').on(table.paperId),
]);

// ============================================================
// 自然段落表（用于沉浸式阅读）
// ============================================================
export const paragraphs = sqliteTable('paragraphs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  sectionTitle: text('section_title'),
  paragraphIndex: integer('paragraph_index').notNull(),
  content: text('content').notNull(),
  processedContent: text('processed_content'),  // 含公式标记的处理后文本
  charCount: integer('char_count').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_paragraphs_paper').on(table.paperId),
  uniqueIndex('idx_paragraphs_paper_idx').on(table.paperId, table.paragraphIndex),
]);

// ============================================================
// 句子表（段落内句子，用于逐句翻译）
// ============================================================
export const sentences = sqliteTable('sentences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  paragraphId: integer('paragraph_id').notNull().references(() => paragraphs.id, { onDelete: 'cascade' }),
  sentenceIndex: integer('sentence_index').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_sentences_paragraph').on(table.paragraphId),
]);

// ============================================================
// 翻译缓存表
// ============================================================
export const translations = sqliteTable('translations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),  // 'paragraph' | 'sentence'
  sourceId: integer('source_id').notNull(),
  originalText: text('original_text').notNull(),
  translatedText: text('translated_text').notNull(),
  model: text('model'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_translations_source').on(table.sourceType, table.sourceId),
  index('idx_translations_paper').on(table.paperId),
]);

// ============================================================
// PDF 页面图片表
// ============================================================
export const pageImages = sqliteTable('page_images', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  pageNumber: integer('page_number').notNull(),
  imagePath: text('image_path').notNull(),    // 相对路径，如 "page_1.jpg"
  width: integer('width'),
  height: integer('height'),
  fileSize: integer('file_size'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_page_images_paper_page').on(table.paperId, table.pageNumber),
  index('idx_page_images_paper').on(table.paperId),
]);

// ============================================================
// 持久化解析任务
// ============================================================
export const processingJobs = sqliteTable('processing_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'), // pending | running | done | error
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
}, (table) => [
  uniqueIndex('idx_processing_jobs_paper').on(table.paperId),
  index('idx_processing_jobs_status').on(table.status, table.createdAt),
]);

// ============================================================
// 统一阅读流：文本、图、表、算法和复杂公式
// ============================================================
export const documentBlocks = sqliteTable('document_blocks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  blockIndex: integer('block_index').notNull(),
  blockType: text('block_type').notNull(),
  sectionTitle: text('section_title'),
  content: text('content'),
  processedContent: text('processed_content'),
  pageNumber: integer('page_number'),
  bbox: text('bbox'),
  assetPath: text('asset_path'),
  caption: text('caption'),
  charCount: integer('char_count').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_document_blocks_paper_idx').on(table.paperId, table.blockIndex),
  index('idx_document_blocks_paper').on(table.paperId),
]);

// ============================================================
// 单设备 DeepSeek 设置（API Key 仅保存密文）
// ============================================================
export const modelSettings = sqliteTable('model_settings', {
  id: integer('id').primaryKey(),
  encryptedApiKey: text('encrypted_api_key'),
  iv: text('iv'),
  authTag: text('auth_tag'),
  model: text('model').notNull().default('deepseek-chat'),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const deviceTokens = sqliteTable('device_tokens', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull().default('Android device'),
  revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  lastSeenAt: text('last_seen_at'),
});

// 一个单词可关联多个论文语境
export const vocabContexts = sqliteTable('vocab_contexts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vocabId: integer('vocab_id').notNull().references(() => vocabItems.id, { onDelete: 'cascade' }),
  paperId: text('paper_id').references(() => papers.id, { onDelete: 'set null' }),
  paperTitle: text('paper_title'),
  sentence: text('sentence').notNull(),
  pageNumber: integer('page_number'),
  blockId: integer('block_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_vocab_contexts_vocab').on(table.vocabId),
]);

// 离线复习上报使用 UUID 保证幂等
export const reviewEvents = sqliteTable('review_events', {
  id: text('id').primaryKey(),
  vocabId: integer('vocab_id').notNull().references(() => vocabItems.id, { onDelete: 'cascade' }),
  grade: text('grade').notNull(),
  responseTimeMs: integer('response_time_ms'),
  reviewedAt: text('reviewed_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_review_events_vocab').on(table.vocabId),
]);

// ============================================================
// 学习日志表（记录每日学习量，用于打卡日历）
// ============================================================
export const studyLogs = sqliteTable('study_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),            // YYYY-MM-DD
  newWordsCount: integer('new_words_count').notNull().default(0),
  reviewCount: integer('review_count').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_study_logs_date').on(table.date),
]);

// ============================================================
// 用户设置表（每日目标等）
// ============================================================
export const userSettings = sqliteTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),           // JSON 值
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ============================================================
// 阅读会话表（跟踪阅读时间）
// ============================================================
export const readingSessions = sqliteTable('reading_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  blocksRead: integer('blocks_read').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_reading_sessions_paper').on(table.paperId),
]);
