export interface Chunk {
  content: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  tokenCount: number;
}

const CHUNK_SIZE = 500;      // 目标 token 数
const CHUNK_OVERLAP = 50;    // 重叠 token 数
const CHAR_PER_TOKEN = 4;    // 粗略估算：1 token ≈ 4 个英文字符

/**
 * 将论文全文智能分块
 */
export function splitIntoChunks(text: string): Chunk[] {
  // 1. 文本清洗
  const cleaned = cleanText(text);

  // 2. 按章节标题分割
  const sections = splitBySections(cleaned);

  // 3. 每个章节内按段落/句子边界进一步分块
  const chunks: Chunk[] = [];
  let globalIndex = 0;

  for (const section of sections) {
    const sectionChunks = splitSection(section.content, section.title, globalIndex);
    chunks.push(...sectionChunks);
    globalIndex += sectionChunks.length;
  }

  return chunks;
}

/**
 * 文本清洗：去除页眉页脚、页码等噪音
 */
function cleanText(text: string): string {
  return text
    // 去除单独行上的纯数字（页码）
    .replace(/^\s*\d+\s*$/gm, '')
    // 去除连续多个空行
    .replace(/\n{3,}/g, '\n\n')
    // 去除行首尾空白
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * 按章节标题分割文本
 */
function splitBySections(text: string): Array<{ title: string; content: string }> {
  // 匹配常见论文章节标题模式
  const sectionPattern = /^(?:\d+\.?\s*)?(Abstract|Introduction|Background|Related Work|Method|Methodology|Approach|Experiment|Results|Discussion|Conclusion|References|Acknowledgement|Appendix|Preliminaries|Problem (?:Statement|Definition|Formulation))\s*$/gim;

  const matches = [...text.matchAll(sectionPattern)];

  if (matches.length === 0) {
    return [{ title: 'Full Text', content: text }];
  }

  const sections: Array<{ title: string; content: string }> = [];
  let lastIndex = 0;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index!;

    if (start > lastIndex) {
      const content = text.slice(lastIndex, start).trim();
      if (content.length > 0) {
        sections.push({
          title: i === 0 ? 'Preamble' : (matches[i - 1]?.[0] || 'Unknown'),
          content,
        });
      }
    }

    lastIndex = start + match[0].length;
  }

  // 最后一个章节
  if (lastIndex < text.length) {
    sections.push({
      title: matches[matches.length - 1]?.[0] || 'Unknown',
      content: text.slice(lastIndex).trim(),
    });
  }

  return sections;
}

/**
 * 将单个章节内容按句子边界分块
 */
function splitSection(content: string, sectionTitle: string, startIndex: number): Chunk[] {
  const targetChars = CHUNK_SIZE * CHAR_PER_TOKEN;
  const overlapChars = CHUNK_OVERLAP * CHAR_PER_TOKEN;

  if (content.length <= targetChars) {
    return [{
      content: content.trim(),
      sectionTitle,
      pageNumber: null,
      tokenCount: Math.ceil(content.length / CHAR_PER_TOKEN),
    }];
  }

  // 按句子分割
  const sentences = splitIntoSentences(content);
  const chunks: Chunk[] = [];
  let currentContent = '';
  let chunkIndex = startIndex;

  for (const sentence of sentences) {
    if (currentContent.length + sentence.length > targetChars && currentContent.length > 0) {
      chunks.push({
        content: currentContent.trim(),
        sectionTitle,
        pageNumber: null,
        tokenCount: Math.ceil(currentContent.length / CHAR_PER_TOKEN),
      });

      // 保留重叠部分
      const overlapStart = Math.max(0, currentContent.length - overlapChars);
      currentContent = currentContent.slice(overlapStart) + ' ' + sentence;
      chunkIndex++;
    } else {
      currentContent += (currentContent ? ' ' : '') + sentence;
    }
  }

  // 最后一块
  if (currentContent.trim().length > 0) {
    chunks.push({
      content: currentContent.trim(),
      sectionTitle,
      pageNumber: null,
      tokenCount: Math.ceil(currentContent.length / CHAR_PER_TOKEN),
    });
  }

  return chunks;
}

/**
 * 按句子边界分割文本
 */
function splitIntoSentences(text: string): string[] {
  // 英文句子分割，保留缩写等特殊情况
  return text
    .replace(/([.!?])\s+/g, '$1|||')
    .split('|||')
    .filter((s) => s.trim().length > 0);
}
