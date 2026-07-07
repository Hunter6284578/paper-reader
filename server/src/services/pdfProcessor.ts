import { existsSync } from 'fs';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { eq } from 'drizzle-orm';
import { db, sqlite } from '../db/connection.js';
import {
  chunks, documentBlocks, pageImages, papers, processingJobs,
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

interface ParserAdapter<TResult> {
  name: 'docling' | 'pdfjs';
  parse: (pdfPath: string, paperId: string, outputDir: string) => Promise<TResult>;
  ingest: (paperId: string, result: TResult) => void;
}

// ---------- Python Docling Parser Invocation ----------

function runDoclingParser(pdfPath: string, outputDir: string): Promise<DoclingResult> {
  return new Promise((resolve, reject) => {
    const pythonExe = ENV.PYTHON_EXECUTABLE;
    const scriptPath = ENV.PYTHON_PARSER_PATH;

    console.log(`[pdfProcessor] Spawning Docling parser: ${pythonExe} ${scriptPath} ${pdfPath} ${outputDir}`);

    const resultPath = join(outputDir, 'docling-result.json');
    const child = spawn(pythonExe, [scriptPath, pdfPath, outputDir, '--json-output', resultPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      // 10 minute timeout for large papers
      timeout: 600_000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-32_768);
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

    child.on('close', async (code) => {
      if (stderr.trim()) {
        console.log(`[pdfProcessor] Python stderr:\n${stderr.trim()}`);
      }

      let trimmed = stdout.trim();
      try {
        trimmed = await readFile(resultPath, 'utf8');
        await unlink(resultPath).catch(() => undefined);
      } catch {
        // Backward-compatible fallback for older parser scripts.
      }
      // Parse from the result file so large papers do not accumulate JSON in stdout.
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

function ingestDoclingResult(paperId: string, result: DoclingResult): void {
  const insertBlock = sqlite.prepare(`
    INSERT INTO document_blocks
      (paper_id, block_index, block_type, section_title, content, processed_content,
       page_number, bbox, asset_path, caption, char_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
    sqlite.prepare('DELETE FROM chunks WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM document_blocks WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM page_images WHERE paper_id = ?').run(paperId);

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
    sqlite.prepare('DELETE FROM chunks WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM document_blocks WHERE paper_id = ?').run(paperId);
    sqlite.prepare('DELETE FROM page_images WHERE paper_id = ?').run(paperId);

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

type PdfjsResult = Awaited<ReturnType<typeof parseWithPdfjs>>;

const doclingAdapter: ParserAdapter<DoclingResult> = {
  name: 'docling',
  parse: (pdfPath, _paperId, outputDir) => runDoclingParser(pdfPath, outputDir),
  ingest: ingestDoclingResult,
};

const pdfjsAdapter: ParserAdapter<PdfjsResult> = {
  name: 'pdfjs',
  parse: (pdfPath, paperId) => parseWithPdfjs(pdfPath, paperId),
  ingest: ingestPdfjsResult,
};

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

async function finalizePaperIngestion(
  paper: typeof papers.$inferSelect,
  pageCount: number,
  blocks: Array<{ type: string; content: string | null }>,
  adapterName: ParserAdapter<unknown>['name'],
): Promise<void> {
  const firstText = blocks.find((block) => block.type === 'text' && block.content)?.content || '';
  db.update(papers).set({
    pageCount,
    abstract: firstText.slice(0, 500),
    processingStatus: 'ready',
    paragraphStatus: 'ready',
    processingError: null,
    contentVersion: (paper.contentVersion || 1) + 1,
    updatedAt: new Date().toISOString(),
  }).where(eq(papers.id, paper.id)).run();

  try {
    const metadata = await extractMetadata(firstText, paper.title);
    const hasNewData = (metadata.title && metadata.title !== paper.title) || metadata.authors || metadata.doi;
    if (hasNewData) {
      db.update(papers).set({
        title: metadata.title || paper.title,
        authors: metadata.authors ? JSON.stringify(metadata.authors) : null,
        doi: metadata.doi || null,
        abstract: metadata.abstract || firstText.slice(0, 500),
      }).where(eq(papers.id, paper.id)).run();
    }
  } catch (error) {
    console.warn(`[Metadata] lookup failed after ${adapterName} ingestion:`, error);
  }

  await generateChunkEmbeddings(paper.id);
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
    const result = await doclingAdapter.parse(filePath, paperId, outputDir);

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
    doclingAdapter.ingest(paperId, result);
    await finalizePaperIngestion(paper, result.pageCount, result.blocks, doclingAdapter.name);

    console.log(`[pdfProcessor] Paper ${paperId} processed: ${result.blocks.length} blocks, ${result.pageCount} pages`);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Fall back to pdfjs-dist parser if Docling is unavailable
    if (message.includes('Python parser') || message.includes('docling') || message.includes('Failed to start') || message.includes('no output')) {
      console.warn(`[pdfProcessor] Docling unavailable, falling back to pdfjs-dist for paper ${paperId}`);
      try {
        const doc = await pdfjsAdapter.parse(filePath, paperId, '');
        pdfjsAdapter.ingest(paperId, doc);
        await finalizePaperIngestion(paper, doc.pageCount, doc.blocks, pdfjsAdapter.name);

        console.log(`[pdfProcessor] Paper ${paperId} processed with pdfjs fallback: ${doc.blocks.length} blocks`);

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
    set: { status: 'pending', attempts: 0, lastError: null, startedAt: null, finishedAt: null },
  }).run();
  db.update(papers).set({
    processingStatus: 'pending', paragraphStatus: 'pending', processingError: null,
  }).where(eq(papers.id, paperId)).run();
  void runNextJob();
}

async function runNextJob(): Promise<void> {
  if (workerRunning) return;
  const job = sqlite.transaction(() => {
    const pending = sqlite.prepare(`
      SELECT id, paper_id AS paperId, attempts FROM processing_jobs
      WHERE status = 'pending' AND created_at <= datetime('now')
      ORDER BY created_at LIMIT 1
    `).get() as { id: number; paperId: string; attempts: number } | undefined;
    if (!pending) return undefined;
    const claimed = sqlite.prepare(`
      UPDATE processing_jobs
      SET status = 'running', attempts = attempts + 1, started_at = datetime('now'), finished_at = NULL
      WHERE id = ? AND status = 'pending'
    `).run(pending.id);
    return claimed.changes === 1 ? { ...pending, attempts: pending.attempts + 1 } : undefined;
  })();
  if (!job) return;

  workerRunning = true;
  try {
    await processPaperAsync(job.paperId);
    db.update(processingJobs).set({
      status: 'done', finishedAt: new Date().toISOString(), lastError: null,
    }).where(eq(processingJobs.id, job.id)).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (job.attempts < ENV.MAX_PROCESSING_ATTEMPTS) {
      sqlite.prepare(`
        UPDATE processing_jobs
        SET status = 'pending', created_at = datetime('now', '+5 seconds'), last_error = ?, finished_at = NULL
        WHERE id = ?
      `).run(message, job.id);
    } else {
      db.update(processingJobs).set({
        status: 'error', finishedAt: new Date().toISOString(), lastError: message,
      }).where(eq(processingJobs.id, job.id)).run();
    }
  } finally {
    workerRunning = false;
    setImmediate(() => void runNextJob());
  }
}

export function startProcessingWorker(): void {
  // Recover only stale leases; another process may legitimately own a fresh running job.
  sqlite.prepare(`
    UPDATE processing_jobs SET status = 'pending', created_at = datetime('now')
    WHERE status = 'running' AND started_at < datetime('now', '-15 minutes')
  `).run();
  if (!workerTimer) {
    workerTimer = setInterval(() => void runNextJob(), 3000);
    workerTimer.unref();
  }
  void runNextJob();
}
