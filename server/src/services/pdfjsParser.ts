/**
 * PDF 解析器 — 纯 Node.js 实现，不依赖 Python/Docling
 *
 * 用 pdfjs-dist 的 getTextContent() 提取文字坐标和字体信息，
 * 做 双栏检测 / 标题检测 / 公式区域检测，
 * 并渲染整页 JPEG 用于"原页视图"。
 *
 * 接口与 doclingParser.ts 完全一致，pdfProcessor.ts 只需改 import。
 */

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { ENV } from '../config.js';

export interface ParsedBlock {
  type: 'section' | 'text' | 'caption' | 'figure' | 'table' | 'algorithm' | 'formula';
  sectionTitle: string | null;
  content: string | null;
  pageNumber: number | null;
  bbox: number[] | null;   // [x0, y0, x1, y1] in PDF coordinate space
  assetPath?: string;       // 相对路径，如 "paperId/page_3.jpg"
}

export interface ParsedDocument {
  pageCount: number;
  blocks: ParsedBlock[];
  pages: Array<{ pageNumber: number; fileName: string; width: number; height: number; fileSize: number }>;
}

// ---------- 内部类型 ----------

interface TextItem {
  str: string;
  transform: number[];   // [a, b, c, d, e, f] — e=x, f=y
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

interface LineGroup {
  y: number;
  items: TextItem[];
  xMin: number;
  xMax: number;
  avgFontSize: number;
  text: string;
}

// ---------- 主入口 ----------

export async function parseWithPdfjs(pdfPath: string, paperId: string): Promise<ParsedDocument> {
  const outputDir = join(ENV.UPLOADS_DIR, paperId);
  mkdirSync(outputDir, { recursive: true });

  // 必须先加载 canvas 并统一全局构造器
  const canvasModule = await import('@napi-rs/canvas');
  (globalThis as any).DOMMatrix = canvasModule.DOMMatrix;
  (globalThis as any).ImageData = canvasModule.ImageData;
  (globalThis as any).Path2D = canvasModule.Path2D;

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = canvasModule;

  const pdfBuffer = readFileSync(pdfPath);
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableFontFace: true,
  });

  const pdfDoc = await loadingTask.promise;
  const pageCount = pdfDoc.numPages;
  console.log(`[pdfjsParser] PDF 共 ${pageCount} 页`);

  const blocks: ParsedBlock[] = [];
  const pages: ParsedDocument['pages'] = [];
  let currentSection: string | null = null;

  // 逐页处理（串行，适配 2G 内存）
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    let page: any;
    try {
      page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;

      // 1. 渲染整页 JPEG（用于"原页视图"）
      const scale = 2.0;
      const renderViewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.floor(renderViewport.width),
        Math.floor(renderViewport.height),
      );
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvas: canvas as any,
        canvasContext: ctx as any,
        viewport: renderViewport,
      } as any).promise;

      const fileName = `page_${pageNum}.jpg`;
      const jpegBuffer = canvas.toBuffer('image/jpeg', 85);
      writeFileSync(join(outputDir, fileName), jpegBuffer);
      pages.push({
        pageNumber: pageNum,
        fileName,
        width: Math.floor(renderViewport.width),
        height: Math.floor(renderViewport.height),
        fileSize: jpegBuffer.length,
      });

      // 2. 提取文字内容
      const textContent = await page.getTextContent();
      const textItems: TextItem[] = textContent.items
        .filter((item: any) => 'str' in item && item.str.trim())
        .map((item: any) => ({
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
          fontName: item.fontName || '',
          hasEOL: item.hasEOL || false,
        }));

      // 扫描件检测：文字项为空
      if (textItems.length === 0) {
        blocks.push({
          type: 'text',
          sectionTitle: currentSection,
          content: `[此页无可提取文字，可能是扫描页面。请切换到"原页视图"查看。]`,
          pageNumber: pageNum,
          bbox: [0, 0, pageWidth, pageHeight],
        });
        continue;
      }

      // 3. 按行聚类
      const lines = clusterIntoLines(textItems);

      // 4. 双栏检测
      const isTwoColumn = detectTwoColumn(lines, pageWidth);

      // 5. 按阅读顺序排序
      const sortedLines = isTwoColumn
        ? sortTwoColumnReadingOrder(lines, pageWidth)
        : lines.sort((a, b) => a.y - b.y);

      // 6. 识别块类型并构建 blocks
      for (const line of sortedLines) {
        const block = classifyLine(line, currentSection, pageNum, pageWidth, pageHeight);
        if (block) {
          if (block.type === 'section' && block.sectionTitle) {
            currentSection = block.sectionTitle;
          }
          blocks.push(block);
        }
      }

      if (pageNum % 5 === 0 || pageNum === pageCount) {
        console.log(`[pdfjsParser] 解析进度: ${pageNum}/${pageCount}`);
      }
    } catch (err) {
      console.error(`[pdfjsParser] 第 ${pageNum} 页解析失败:`, err);
      blocks.push({
        type: 'text',
        sectionTitle: currentSection,
        content: `[第 ${pageNum} 页解析失败]`,
        pageNumber: pageNum,
        bbox: null,
      });
    } finally {
      page?.cleanup();
    }
  }

  await pdfDoc.destroy();

  // 合并相邻同类型的文本块
  const mergedBlocks = mergeAdjacentTextBlocks(blocks);

  console.log(`[pdfjsParser] 解析完成: ${mergedBlocks.length} 个块, ${pages.length} 页`);
  return { pageCount, blocks: mergedBlocks, pages };
}

// ---------- 行聚类 ----------

function clusterIntoLines(items: TextItem[]): LineGroup[] {
  if (items.length === 0) return [];

  // 按 y 坐标排序（PDF 坐标系 y 从下往上，但我们只做相对聚类）
  const sorted = [...items].sort((a, b) => {
    const ya = a.transform[5];
    const yb = b.transform[5];
    if (Math.abs(ya - yb) < 3) return a.transform[4] - b.transform[4]; // 同行按 x 排序
    return yb - ya; // 从上到下
  });

  const lines: LineGroup[] = [];
  let currentLine: TextItem[] = [];
  let currentY = sorted[0].transform[5];
  let currentXMin = sorted[0].transform[4];
  let currentXMax = sorted[0].transform[4] + sorted[0].width;

  for (const item of sorted) {
    const y = item.transform[5];
    const x = item.transform[4];
    const xEnd = x + item.width;

    if (Math.abs(y - currentY) < 3) {
      // 同一行
      currentLine.push(item);
      currentXMin = Math.min(currentXMin, x);
      currentXMax = Math.max(currentXMax, xEnd);
    } else {
      // 新行
      if (currentLine.length > 0) {
        lines.push(makeLine(currentLine, currentY, currentXMin, currentXMax));
      }
      currentLine = [item];
      currentY = y;
      currentXMin = x;
      currentXMax = xEnd;
    }
  }
  if (currentLine.length > 0) {
    lines.push(makeLine(currentLine, currentY, currentXMin, currentXMax));
  }

  return lines;
}

function makeLine(items: TextItem[], y: number, xMin: number, xMax: number): LineGroup {
  const fontSizes = items.map(i => Math.abs(i.transform[3])).filter(f => f > 0);
  const avgFontSize = fontSizes.length > 0
    ? fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length
    : 10;

  // 合并文字，处理空格
  let text = '';
  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      const prevEnd = items[i - 1].transform[4] + items[i - 1].width;
      const currStart = items[i].transform[4];
      if (currStart - prevEnd > 2) text += ' ';
    }
    text += items[i].str;
  }

  return { y, items, xMin, xMax, avgFontSize, text: text.trim() };
}

// ---------- 双栏检测 ----------

function detectTwoColumn(lines: LineGroup[], pageWidth: number): boolean {
  if (lines.length < 10) return false;

  const midX = pageWidth / 2;
  let leftCount = 0;
  let rightCount = 0;
  let crossCount = 0;

  for (const line of lines) {
    const center = (line.xMin + line.xMax) / 2;
    const width = line.xMax - line.xMin;

    // 跨越中线的宽行（标题、全文行）
    if (line.xMin < midX && line.xMax > midX && width > pageWidth * 0.5) {
      crossCount++;
    } else if (center < midX) {
      leftCount++;
    } else {
      rightCount++;
    }
  }

  // 双栏判定：左右两栏都有足够的行，且跨中线行占比低
  const totalLines = lines.length;
  return leftCount > totalLines * 0.2
    && rightCount > totalLines * 0.2
    && crossCount < totalLines * 0.3;
}

function sortTwoColumnReadingOrder(lines: LineGroup[], pageWidth: number): LineGroup[] {
  const midX = pageWidth / 2;
  const fullWidthLines: LineGroup[] = [];
  const leftLines: LineGroup[] = [];
  const rightLines: LineGroup[] = [];

  for (const line of lines) {
    const center = (line.xMin + line.xMax) / 2;
    const width = line.xMax - line.xMin;

    if (line.xMin < midX && line.xMax > midX && width > pageWidth * 0.5) {
      fullWidthLines.push(line);
    } else if (center < midX) {
      leftLines.push(line);
    } else {
      rightLines.push(line);
    }
  }

  // 全宽行按 y 排序，左栏在右栏之前
  // 简化策略：全宽行单独成段，左右栏按 y 各自排序
  // 实际阅读顺序取决于全宽行的位置，这里用简化版：
  // 先按 y 分组，同 y 区间内先左后右
  const result: LineGroup[] = [];
  const allSorted = [...fullWidthLines, ...leftLines, ...rightLines]
    .sort((a, b) => b.y - a.y); // 从上到下

  // 更精确的：按 y 分层，每层内左栏优先
  const sorted = [...lines].sort((a, b) => b.y - a.y);
  const processed = new Set<LineGroup>();

  for (const line of sorted) {
    if (processed.has(line)) continue;
    const yBand = sorted.filter(l => Math.abs(l.y - line.y) < 5 && !processed.has(l));
    const left = yBand.filter(l => (l.xMin + l.xMax) / 2 < midX);
    const right = yBand.filter(l => (l.xMin + l.xMax) / 2 >= midX);
    const full = yBand.filter(l => l.xMin < midX && l.xMax > midX && (l.xMax - l.xMin) > pageWidth * 0.5);

    // 全宽行优先（标题等）
    for (const f of full) { result.push(f); processed.add(f); }
    for (const l of left) { result.push(l); processed.add(l); }
    for (const r of right) { result.push(r); processed.add(r); }
  }

  return result;
}

// ---------- 行类型识别 ----------

function classifyLine(
  line: LineGroup,
  currentSection: string | null,
  pageNum: number,
  pageWidth: number,
  pageHeight: number,
): ParsedBlock | null {
  const text = line.text;
  if (!text) return null;

  const bbox = [line.xMin, line.y - line.avgFontSize, line.xMax, line.y + line.avgFontSize * 0.3];

  // 标题检测：字号明显大于平均 + 较短
  // 论文标题通常 >= 12pt，正文 9-10pt
  if (line.avgFontSize >= 12 && text.length < 100) {
    // 常见论文标题模式
    const isSectionHeader = /^\d+\.?\s/.test(text)
      || /^(Abstract|Introduction|Related Work|Method|Methods|Results|Discussion|Conclusion|References|Acknowledg)/i.test(text)
      || /^(ABSTRACT|INTRODUCTION|RELATED WORK|METHOD|RESULTS|DISCUSSION|CONCLUSION|REFERENCES)/.test(text);

    if (isSectionHeader) {
      return {
        type: 'section',
        sectionTitle: text,
        content: null,
        pageNumber: pageNum,
        bbox,
      };
    }
  }

  // 公式检测：连续使用 Math/CMSY/CMR 等数学字体
  const mathFontRatio = line.items.filter(i =>
    /math|cmsy|cmr|cmmi|symbol|Times-Symbol/i.test(i.fontName)
  ).length / line.items.length;

  if (mathFontRatio > 0.5 && text.length < 200) {
    return {
      type: 'formula',
      sectionTitle: currentSection,
      content: text,
      pageNumber: pageNum,
      bbox,
    };
  }

  // 图表标注检测：Figure N / Table N / Algorithm N
  const captionMatch = /^(Figure|Fig\.?|Table|Tab\.?|Algorithm|Alg\.?)\s+\d+/i.exec(text);
  if (captionMatch) {
    return {
      type: 'caption',
      sectionTitle: currentSection,
      content: text,
      pageNumber: pageNum,
      bbox,
    };
  }

  // 默认：正文段落
  return {
    type: 'text',
    sectionTitle: currentSection,
    content: text,
    pageNumber: pageNum,
    bbox,
  };
}

// ---------- 合并相邻文本块 ----------

function mergeAdjacentTextBlocks(blocks: ParsedBlock[]): ParsedBlock[] {
  const result: ParsedBlock[] = [];
  let pendingText: string[] = [];
  let pendingSection: string | null = null;
  let pendingPage: number | null = null;
  let pendingBbox: number[] | null = null;

  function flushText() {
    if (pendingText.length > 0) {
      const content = pendingText.join('\n').trim();
      if (content) {
        result.push({
          type: 'text',
          sectionTitle: pendingSection,
          content,
          pageNumber: pendingPage,
          bbox: pendingBbox,
        });
      }
      pendingText = [];
    }
  }

  for (const block of blocks) {
    if (block.type === 'text') {
      // 合并到当前缓冲
      if (pendingPage !== block.pageNumber || pendingSection !== block.sectionTitle) {
        flushText();
      }
      pendingSection = block.sectionTitle;
      pendingPage = block.pageNumber;
      pendingBbox = block.bbox;
      pendingText.push(block.content || '');
    } else {
      // 非文本块，先 flush 文本
      flushText();
      result.push(block);
      pendingSection = block.sectionTitle;
      pendingPage = block.pageNumber;
    }
  }
  flushText();

  return result;
}
