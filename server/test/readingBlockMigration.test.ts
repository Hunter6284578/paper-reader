import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Reading Block migration preserves legacy highlights and paragraph translations', () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE paragraphs (id INTEGER PRIMARY KEY, paper_id TEXT NOT NULL, paragraph_index INTEGER NOT NULL);
      CREATE TABLE document_blocks (id INTEGER PRIMARY KEY, paper_id TEXT NOT NULL, block_index INTEGER NOT NULL);
      CREATE TABLE highlights (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, paragraph_id INTEGER, position TEXT NOT NULL);
      CREATE TABLE translations (id INTEGER PRIMARY KEY, paper_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id INTEGER NOT NULL, translated_text TEXT NOT NULL);
      CREATE UNIQUE INDEX idx_translations_source ON translations(source_type, source_id);
      INSERT INTO paragraphs VALUES (11, 'paper-1', 3);
      INSERT INTO document_blocks VALUES (42, 'paper-1', 3);
      INSERT INTO highlights VALUES ('highlight-1', 'paper-1', 11, '{"mode":"text","paragraphId":11}');
      INSERT INTO translations VALUES (7, 'paper-1', 'paragraph', 11, '译文');
    `);
    const migration = readFileSync(resolve('src/db/migrations/0001_canonical_reading_blocks.sql'), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement);
    }
    assert.equal((sqlite.prepare("SELECT block_id FROM highlights WHERE id='highlight-1'").get() as { block_id: number }).block_id, 42);
    assert.deepEqual(sqlite.prepare('SELECT source_type, source_id FROM translations WHERE id=7').get(), { source_type: 'block', source_id: 42 });
  } finally {
    sqlite.close();
  }
});
