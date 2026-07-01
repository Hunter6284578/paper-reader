/**
 * 重新处理所有已上传论文
 * 部署后运行：docker exec paper-reader node dist/scripts/reprocessAll.js
 *
 * 作用：对每篇论文重新执行 processPaperAsync，
 *       从而生成 processedContent（公式标记）与 page_images（页面图片）。
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { papers } from '../db/schema.js';
import { processPaperAsync } from '../services/pdfProcessor.js';

async function main() {
  const all = db.select().from(papers).all();
  console.log(`[reprocess] 共 ${all.length} 篇论文需要重新处理`);

  let ok = 0;
  let fail = 0;

  for (const paper of all) {
    console.log(`\n[reprocess] >>> ${paper.id} | ${paper.title}`);
    try {
      // 重置状态，确保 processPaperAsync 完整执行
      db.update(papers)
        .set({ processingStatus: 'processing', paragraphStatus: 'pending' })
        .where(eq(papers.id, paper.id))
        .run();

      await processPaperAsync(paper.id);
      ok++;
      console.log(`[reprocess] ✅ 完成: ${paper.title}`);
    } catch (e) {
      fail++;
      console.error(`[reprocess] ❌ 失败: ${paper.title}`, e);
    }
  }

  console.log(`\n[reprocess] 全部结束 — 成功 ${ok}，失败 ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[reprocess] 致命错误:', e);
  process.exit(1);
});
