/**
 * PDF 页面图片渲染服务
 * 使用 pdfjs-dist + @napi-rs/canvas 将 PDF 每页渲染为 JPEG
 */

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ENV } from '../config.js';
import { db } from '../db/connection.js';
import { pageImages } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * 渲染 PDF 所有页面为 JPEG 图片
 */
export async function renderPageImages(
  pdfBuffer: Buffer,
  paperId: string
): Promise<void> {
  console.log(`[页面渲染] 开始渲染论文页面: ${paperId}`);

  try {
    // 必须先加载 canvas 并统一全局构造器。若 PDF.js 先通过 CommonJS
    // 初始化 Path2D，再用 ESM canvas 创建上下文，两套原生 Path 类型不兼容。
    const canvasModule = await import('@napi-rs/canvas');
    (globalThis as any).DOMMatrix = canvasModule.DOMMatrix;
    (globalThis as any).ImageData = canvasModule.ImageData;
    (globalThis as any).Path2D = canvasModule.Path2D;

    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = canvasModule;

    // 加载 PDF
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      disableFontFace: true,
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    console.log(`[页面渲染] PDF 共 ${numPages} 页`);

    // 创建输出目录
    const outputDir = join(ENV.UPLOADS_DIR, paperId);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // 清空旧的页面图片记录
    db.delete(pageImages).where(eq(pageImages.paperId, paperId)).run();

    // 逐页渲染（串行，避免内存溢出）
    const scale = 2.0; // 2x 缩放 ≈ 144 DPI
    let renderedPages = 0;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      let page: Awaited<ReturnType<typeof pdfDoc.getPage>> | undefined;
      try {
        page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        const canvas = createCanvas(
          Math.floor(viewport.width),
          Math.floor(viewport.height)
        );
        const context = canvas.getContext('2d');

        // 设置白色背景
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        const renderContext = {
          canvas: canvas as any,
          canvasContext: context as any,
          viewport,
        };

        await (page.render(renderContext) as any).promise;

        // 导出为 JPEG
        const jpegBuffer = canvas.toBuffer('image/jpeg', 85);

        const fileName = `page_${pageNum}.jpg`;
        const filePath = join(outputDir, fileName);
        writeFileSync(filePath, jpegBuffer);

        // 写入数据库
        db.insert(pageImages).values({
          paperId,
          pageNumber: pageNum,
          imagePath: `${paperId}/${fileName}`,
          width: Math.floor(viewport.width),
          height: Math.floor(viewport.height),
          fileSize: jpegBuffer.length,
        }).run();
        renderedPages++;

        if (pageNum % 5 === 0 || pageNum === numPages) {
          console.log(`[页面渲染] 进度: ${pageNum}/${numPages}`);
        }
      } catch (e) {
        console.error(`[页面渲染] 第 ${pageNum} 页渲染失败:`, e);
      } finally {
        // 成功和失败都释放单页缓存，避免在 512MB 容器中逐页累积。
        page?.cleanup();
      }
    }

    await pdfDoc.destroy();

    if (renderedPages !== numPages) {
      throw new Error(`仅成功渲染 ${renderedPages}/${numPages} 页`);
    }

    console.log(`[页面渲染] 论文页面渲染完成: ${paperId} (${renderedPages} 页)`);
  } catch (error) {
    console.error(`[页面渲染] 渲染失败: ${paperId}`, error);
    throw error;
  }
}
