import { existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { asc, eq } from 'drizzle-orm';
import { db, sqlite } from '../db/connection.js';
import {
  chunks, documentBlocks, pageImages, papers, paragraphs,
  processingJobs, sentences,
} from '../db/schema.js';
import { ENV } from '../config.js';
import { detectFormulas } from './formulaDetector.js';
import { parseWithPdfjs } from './pdfjsParser.js';
import { generateEmbeddings, isEmbeddingAvailable } from './embeddingService.js';
import { extractMetadata } from './metadataService.js';

let workerRunning = false;
let workerTimer: NodeJS.Timeout | null = null;

// ---------- Types ----------

interface DoclingBBox {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface DoclingBlock {
  type: 'section' | 'text' | 'figure' | 'table' | 'algorithm' | 'formula' | 'caption';
  content: string | null;
  sectionTitle: string | null;
  pageNumber: number | null;
  readingOrder: number;
  bbox: DoclingBBox | null;
  latex: string | null;
  assetPath?: string;
}

interface DoclingPageImage {
  pageNumber: number;
  fileName: string;
  width: number;
  height: number;
  fileSize: number;
}

interface DoclingVisualBlock {
  blockIndex: number;
  type: string;
  pageNumber: number;
  bbox: DoclingBBox;
  assetPath: string;
}

interface DoclingResult {
  status: 'success' | 'error';
  error: string | null;
  title: string | null;
  pageCount: number;
  blocks: DoclingBlock[];
  visualBlocks: DoclingVisualBlock[];
  pageImages: DoclingPageImage[];
}

// ---------- Python Docling Parser Invocation ----------

function runDoclingParser(pdfPath: string, outputDir: string): Promise<DoclingResult> {
  return new Promise((resolve, reject) => {
    const pythonExe = ENV.PYTHON_EXECUTABLE;
    const scriptPath = ENV.PYTHON_PARSER_PATH;

    console.log(`[pdfProcessor] Spawning Docling parser: ${pythonExe} ${scriptPath} ${pdfPath} ${outputDir}`);

    const child = spawn(pythonExe, [scriptPath, pdfPath, outputDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      // 10 minute timeout for large papers
      timeout: 600_000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // Forward progress logs
      process.stderr.write(`[docling] ${text}`);
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start Python parser: ${err.message}. Make sure Python and Docling are installed.`));
    });

    child.on('close', (code) => {
      if (stderr.trim()) {
        console.log(`[pdfProcessor] Python stderr:\n${stderr.trim()}`);
      }

      // Try to parse the JSON output from stdout
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error(
          `Python parser produced no output (exit code ${code}). stderr: ${stderr.slice(-500)}`
        ));
        return;
      }

      try {
        const result: DoclingResult = JSON.parse(trimmed);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(
          `Failed to parse Python output as JSON: ${parseErr}. Raw output (first 500 chars): ${trimmed.slice(0, 500)}`
        ));
      }
    });
  });
}

// ---------- Ingest into Database ----------

function splitSentences(text: string): string[] {
  return text.replace(/([.!?])\s+/g, '$1|||').split('|||').map((s) => s.trim()).filter(Boolean);
}

function ingestDoclingResult(paperId: string, result: DoclingResult): void {
  const insertBlock = sqlite.prepare(`
    INSERT INTO document_blocks
      (paper_id, block_index, block_type, section_title, content, processed_content,
       page_number, bbox, asset_path, caption, char_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertParagraph = sqlite.prepare(`
    INSERT INTO paragraphs
      (paper_id, section_title, paragraph_index, content, processed_content, char_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertSentence = sqlite.prepare(`
    INSERT INTO sentences (paper_id, paragraph_id, sentence_index, content, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const insertChunk = sqlite.prepare(`
    INSERT INTO chunks
      (paper_id, chunk_index, content, section_title, page_number, block_id, token_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertPage = sqlite.prepare(`
    INSERT INTO page_images (paper_id, page_number, image_path, width, height, file_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  sqlite.transaction(() => {
    // Clear previous data for this paper
    sqlite.prepare('DELETE FROM sentences WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM paragraphs WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM chunks WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM document_blocks WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM page_images WHERE paper_id = ?').run(paperId);

    let paragraphIndex = 0;
    let chunkIndex = 0;

    // Insert blocks in reading order
    result.blocks.forEach((block, blockIndex) => {
      const content = block.content?.trim() || null;

      // For formula blocks, prefer the extracted LaTeX source
      let processed: string | null = null;
      if (block.type === 'formula' && block.latex) {
        processed = `$$${block.latex}$$`;
      } else if (content) {
        processed = detectFormulas(content);
      }

      // Serialize bbox -- store as JSON string compatible with the schema
      let bboxJson: string | null = null;
      if (block.bbox) {
        bboxJson = JSON.stringify([block.bbox.x1, block.bbox.y1, block.bbox.x2, block.bbox.y2]);
      }

      // Asset path: prefix with paperId for the uploads directory structure
      const assetPath = block.assetPath ? `${paperId}/${block.assetPath}` : null;

      const insertedBlock = insertBlock.run(
        paperId, blockIndex, block.type, block.sectionTitle, content, processed,
        block.pageNumber, bboxJson, assetPath,
        block.type === 'caption' ? content : null,
        content?.length || 0,
      );

      // Create paragraphs and sentences for text/caption blocks
      if (content && ['text', 'caption'].includes(block.type)) {
        const para = insertParagraph.run(
          paperId, block.sectionTitle, paragraphIndex, content, processed, content.length,
        );
        splitSentences(content).forEach((sentence, sentenceIndex) => {
          insertSentence.run(paperId, para.lastInsertRowid, sentenceIndex, sentence);
        });
        paragraphIndex++;
      }

      // Create chunks for search/FTS
      if (content && content.length > 20) {
        insertChunk.run(
          paperId, chunkIndex++, content, block.sectionTitle, block.pageNumber,
          insertedBlock.lastInsertRowid,
          Math.ceil(content.length / 4),
        );
      }
    });

    // Insert page images
    result.pageImages.forEach((page) => {
      insertPage.run(
        paperId, page.pageNumber, `${paperId}/${page.fileName}`,
        page.width, page.height, page.fileSize,
      );
    });

    // Rebuild FTS5 index
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content, section_title, content='chunks', content_rowid='id', tokenize='porter unicode61'
      );
      INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');
    `);
  })();
}

// ---------- Pdfjs Fallback Ingestion ----------

function ingestPdfjsResult(paperId: string, doc: { pageCount: number; blocks: Array<{ type: string; sectionTitle: string | null; content: string | null; pageNumber: number | null; bbox: number[] | null; assetPath?: string }>; pages: Array<{ pageNumber: number; fileName: string; width: number; height: number; fileSize: number }> }): void {
  const insertBlock = sqlite.prepare(`
    INSERT INTO document_blocks
      (paper_id, block_index, block_type, section_title, content, processed_content,
       page_number, bbox, asset_path, caption, char_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertParagraph = sqlite.prepare(`
    INSERT INTO paragraphs
      (paper_id, section_title, paragraph_index, content, processed_content, char_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertSentence = sqlite.prepare(`
    INSERT INTO sentences (paper_id, paragraph_id, sentence_index, content, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const insertChunk = sqlite.prepare(`
    INSERT INTO chunks
      (paper_id, chunk_index, content, section_title, page_number, block_id, token_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertPage = sqlite.prepare(`
    INSERT INTO page_images (paper_id, page_number, image_path, width, height, file_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM sentences WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM paragraphs WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM chunks WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM document_blocks WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM page_images WHERE paper_id = ?').run(paperId);

    let paragraphIndex = 0;
    let chunkIndex = 0;

    doc.blocks.forEach((block, blockIndex) => {
      const content = block.content?.trim() || null;
      const processed = content ? detectFormulas(content) : null;
      let bboxJson: string | null = null;
      if (block.bbox) {
        bboxJson = JSON.stringify(block.bbox);
      }
      const assetPath = block.assetPath ? `${paperId}/${block.assetPath}` : null;

      const insertedBlock = insertBlock.run(
        paperId, blockIndex, block.type, block.sectionTitle, content, processed,
        block.pageNumber, bboxJson, assetPath,
        block.type === 'caption' ? content : null,
        content?.length || 0,
      );

      if (content && ['text', 'caption'].includes(block.type)) {
        const para = insertParagraph.run(
          paperId, block.sectionTitle, paragraphIndex, content, processed, content.length,
        );
        splitSentences(content).forEach((sentence, sentenceIndex) => {
          insertSentence.run(paperId, para.lastInsertRowid, sentenceIndex, sentence);
        });
        paragraphIndex++;
      }

      if (content && content.length > 20) {
        insertChunk.run(
          paperId, chunkIndex++, content, block.sectionTitle, block.pageNumber,
          insertedBlock.lastInsertRowid,
          Math.ceil(content.length / 4),
        );
      }
    });

    doc.pages.forEach((page) => {
      insertPage.run(
        paperId, page.pageNumber, `${paperId}/${page.fileName}`,
        page.width, page.height, page.fileSize,
      );
    });

    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content, section_title, content='chunks', content_rowid='id', tokenize='porter unicode61'
      );
      INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');
    `);
  })();
}

// ---------- Embedding Generation ----------

/**
 * Generate embeddings for all chunks of a paper.
 * Runs asynchronously after ingestion, does not block paper processing.
 */
async function generateChunkEmbeddings(paperId: string): Promise<void> {
  if (!isEmbeddingAvailable()) {
    console.log(`[Embedding] API unavailable, skipping embedding generation for ${paperId}`);
    return;
  }

  const rows = sqlite.prepare(
    'SELECT id, content FROM chunks WHERE paper_id = ? AND embedding IS NULL'
  ).all(paperId) as Array<{ id: number; content: string }>;

  if (rows.length === 0) return;

  console.log(`[Embedding] generating embeddings for ${rows.length} chunks of paper ${paperId}`);

  const texts = rows.map((r) => r.content);
  try {
    const embeddings = await generateEmbeddings(texts);

    const updateStmt = sqlite.prepare('UPDATE chunks SET embedding = ? WHERE id = ?');
    const updateAll = sqlite.transaction(() => {
      embeddings.forEach((emb, i) => {
        updateStmt.run(JSON.stringify(emb), rows[i].id);
      });
    });
    updateAll();

    console.log(`[Embedding] done: ${embeddings.length} embeddings stored for paper ${paperId}`);
  } catch (err) {
    console.error(`[Embedding] failed for paper ${paperId}:`, err);
  }
}

// ---------- Main Processing Function ----------

/** Process a paper using the Docling Python parser. */
export async function processPaperAsync(paperId: string): Promise<void> {
  const paper = db.select().from(papers).where(eq(papers.id, paperId)).get();
  if (!paper) throw new Error('论文不存在');
  const filePath = join(ENV.PAPERS_DIR, paper.filePath);
  if (!existsSync(filePath)) throw new Error('PDF 文件不存在');

  db.update(papers).set({
    processingStatus: 'processing', paragraphStatus: 'processing', processingError: null,
  }).where(eq(papers.id, paperId)).run();

  try {
    const outputDir = join(ENV.UPLOADS_DIR, paperId);

    console.log(`[pdfProcessor] Processing paper ${paperId} with Docling...`);
    const result = await runDoclingParser(filePath, outputDir);

    // Handle scanned PDF error
    if (result.status === 'error' && result.error?.includes('UNSUPPORTED_SCANNED_PDF')) {
      db.update(papers).set({
        processingStatus: 'unsupported_scan',
        paragraphStatus: 'error',
        processingError: result.error,
        pageCount: result.pageCount || null,
        updatedAt: new Date().toISOString(),
      }).where(eq(papers.id, paperId)).run();
      throw new Error(result.error);
    }

    // Handle other errors
    if (result.status === 'error') {
      throw new Error(result.error || 'Docling parser returned an unknown error');
    }

    // Ingest successful result
    ingestDoclingResult(paperId, result);

    // Extract abstract from first text block
    const firstText = result.blocks.find(
      (block) => block.type === 'text' && block.content
    )?.content || '';

    db.update(papers).set({
      pageCount: result.pageCount,
      abstract: firstText.slice(0, 500),
      processingStatus: 'ready',
      paragraphStatus: 'ready',
      processingError: null,
      contentVersion: (paper.contentVersion || 1) + 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(papers.id, paperId)).run();

    // Try to extract metadata from CrossRef
    try {
      const metadata = await extractMetadata(firstText, paper.title);
      const hasNewData = (metadata.title && metadata.title !== paper.title) || metadata.authors || metadata.doi;
      if (hasNewData) {
        db.update(papers).set({
          title: metadata.title || paper.title,
          authors: metadata.authors ? JSON.stringify(metadata.authors) : null,
          doi: metadata.doi || null,
          abstract: metadata.abstract || firstText.slice(0, 500),
        }).where(eq(papers.id, paperId)).run();
      }
    } catch (e) {
      console.warn('[Metadata] CrossRef lookup failed:', e);
    }

    console.log(`[pdfProcessor] Paper ${paperId} processed: ${result.blocks.length} blocks, ${result.pageCount} pages`);

    // Generate embeddings asynchronously (non-blocking)
    await generateChunkEmbeddings(paperId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Fall back to pdfjs-dist parser if Docling is unavailable
    if (message.includes('Python parser') || message.includes('docling') || message.includes('Failed to start') || message.includes('no output')) {
      console.warn(`[pdfProcessor] Docling unavailable, falling back to pdfjs-dist for paper ${paperId}`);
      try {
        const doc = await parseWithPdfjs(filePath, paperId);
        ingestPdfjsResult(paperId, doc);

        const firstText = doc.blocks.find(
          (block) => block.type === 'text' && block.content
        )?.content || '';

        db.update(papers).set({
          pageCount: doc.pageCount,
          abstract: firstText.slice(0, 500),
          processingStatus: 'ready',
          paragraphStatus: 'ready',
          processingError: null,
          contentVersion: (paper.contentVersion || 1) + 1,
          updatedAt: new Date().toISOString(),
        }).where(eq(papers.id, paperId)).run();

        // Try to extract metadata from CrossRef (pdfjs fallback path)
        try {
          const metadata = await extractMetadata(firstText, paper.title);
          const hasNewData = (metadata.title && metadata.title !== paper.title) || metadata.authors || metadata.doi;
          if (hasNewData) {
            db.update(papers).set({
              title: metadata.title || paper.title,
              authors: metadata.authors ? JSON.stringify(metadata.authors) : null,
              doi: metadata.doi || null,
              abstract: metadata.abstract || firstText.slice(0, 500),
            }).where(eq(papers.id, paperId)).run();
          }
        } catch (e) {
          console.warn('[Metadata] CrossRef lookup failed (pdfjs fallback):', e);
        }

        console.log(`[pdfProcessor] Paper ${paperId} processed with pdfjs fallback: ${doc.blocks.length} blocks`);

        // Generate embeddings asynchronously (non-blocking)
        await generateChunkEmbeddings(paperId);
        return;
      } catch (fallbackError) {
        const fbMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error(`[pdfProcessor] Pdfjs fallback also failed for ${paperId}:`, fbMsg);
        db.update(papers).set({
          processingStatus: 'error', paragraphStatus: 'error', processingError: fbMsg,
          updatedAt: new Date().toISOString(),
        }).where(eq(papers.id, paperId)).run();
        throw fallbackError;
      }
    }

    console.error(`[pdfProcessor] Failed to process paper ${paperId}:`, message);
    db.update(papers).set({
      processingStatus: 'error', paragraphStatus: 'error', processingError: message,
      updatedAt: new Date().toISOString(),
    }).where(eq(papers.id, paperId)).run();
    throw error;
  }
}

// ---------- Job Queue ----------

export function enqueuePaperProcessing(paperId: string): void {
  db.insert(processingJobs).values({ paperId, status: 'pending' }).onConflictDoUpdate({
    target: processingJobs.paperId,
    set: { status: 'pending', lastError: null, finishedAt: null },
  }).run();
  db.update(papers).set({
    processingStatus: 'pending', paragraphStatus: 'pending', processingError: null,
  }).where(eq(papers.id, paperId)).run();
  void runNextJob();
}

async function runNextJob(): Promise<void> {
  if (workerRunning) return;
  const job = db.select().from(processingJobs)
    .where(eq(processingJobs.status, 'pending'))
    .orderBy(asc(processingJobs.createdAt)).get();
  if (!job) return;

  workerRunning = true;
  db.update(processingJobs).set({
    status: 'running', attempts: job.attempts + 1, startedAt: new Date().toISOString(),
  }).where(eq(processingJobs.id, job.id)).run();
  try {
    await processPaperAsync(job.paperId);
    db.update(processingJobs).set({
      status: 'done', finishedAt: new Date().toISOString(), lastError: null,
    }).where(eq(processingJobs.id, job.id)).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.update(processingJobs).set({
      status: 'error', finishedAt: new Date().toISOString(), lastError: message,
    }).where(eq(processingJobs.id, job.id)).run();
  } finally {
    workerRunning = false;
    setImmediate(() => void runNextJob());
  }
}

export function startProcessingWorker(): void {
  db.update(processingJobs).set({ status: 'pending' })
    .where(eq(processingJobs.status, 'running')).run();
  if (!workerTimer) {
    workerTimer = setInterval(() => void runNextJob(), 3000);
    workerTimer.unref();
  }
  void runNextJob();
}
