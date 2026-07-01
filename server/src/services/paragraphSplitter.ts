/**
 * 段落/句子结构化拆分服务
 * 将论文全文拆为 章节 → 段落 → 句子 三级结构，用于沉浸式阅读
 */

export interface StructuredParagraph {
  sectionTitle: string;
  content: string;
  sentences: string[];
  charCount: number;
}

export interface StructuredSection {
  title: string;
  paragraphs: StructuredParagraph[];
}

const MIN_PARAGRAPH_LENGTH = 30;
const MAX_PARAGRAPH_LENGTH = 2000;
const SENTENCES_PER_LONG_PARA = 4;

/**
 * 将论文全文拆为结构化段落
 */
export function splitIntoStructuredText(text: string): StructuredSection[] {
  const cleaned = cleanTextForReading(text);
  const sections = splitBySections(cleaned);

  const result: StructuredSection[] = [];

  for (const section of sections) {
    const paragraphs = splitIntoParagraphs(section.content);
    if (paragraphs.length === 0) continue;

    const structuredParagraphs: StructuredParagraph[] = paragraphs.map((p) => ({
      sectionTitle: section.title,
      content: p,
      sentences: splitIntoSentences(p),
      charCount: p.length,
    }));

    result.push({
      title: section.title,
      paragraphs: structuredParagraphs,
    });
  }

  return result;
}

/**
 * 文本清洗（面向阅读）
 */
function cleanTextForReading(text: string): string {
  return text
    // 去除单独行上的纯数字（页码）
    .replace(/^\s*\d+\s*$/gm, '')
    // 将单独换行符（非双换行）替换为空格（处理 PDF 行尾折行）
    .replace(/(?<!\n)\n(?!\n)/g, ' ')
    // 合并连续多个空格
    .replace(/ {2,}/g, ' ')
    // 合并连续 3+ 空行为 2 个
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 按章节标题分割文本（复用 chunker 的正则）
 */
function splitBySections(text: string): Array<{ title: string; content: string }> {
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
    const content = text.slice(lastIndex).trim();
    if (content.length > 0) {
      sections.push({
        title: matches[matches.length - 1]?.[0] || 'Unknown',
        content,
      });
    }
  }

  return sections;
}

/**
 * 将章节内容按自然段落拆分
 */
function splitIntoParagraphs(sectionContent: string): string[] {
  // 按双换行分割
  const candidates = sectionContent.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  if (candidates.length === 0) return [];

  const merged: string[] = [];

  for (const para of candidates) {
    // 跳过过短的段落（通常是图表标题、页眉残留等）
    if (para.length < 5) continue;

    const lastIdx = merged.length - 1;

    // 如果上一个段落过短，合并到上一个段落
    if (lastIdx >= 0 && merged[lastIdx].length < MIN_PARAGRAPH_LENGTH) {
      merged[lastIdx] = merged[lastIdx] + ' ' + para;
    }
    // 如果当前段落过长，按句子拆分
    else if (para.length > MAX_PARAGRAPH_LENGTH) {
      const subParagraphs = splitLongParagraph(para);
      merged.push(...subParagraphs);
    }
    else {
      merged.push(para);
    }
  }

  // 最后处理：如果合并后仍有过短段落，尝试与前面的合并
  for (let i = merged.length - 1; i >= 1; i--) {
    if (merged[i].length < MIN_PARAGRAPH_LENGTH) {
      merged[i - 1] = merged[i - 1] + ' ' + merged[i];
      merged.splice(i, 1);
    }
  }

  return merged;
}

/**
 * 将过长段落按句子边界拆分
 */
function splitLongParagraph(para: string): string[] {
  const sentences = splitIntoSentences(para);
  if (sentences.length <= SENTENCES_PER_LONG_PARA) return [para];

  const result: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > MAX_PARAGRAPH_LENGTH && current.length > 0) {
      result.push(current.trim());
      current = sentence;
    } else if (
      current.split(/[.!?]/).length > SENTENCES_PER_LONG_PARA + 1 &&
      current.length > MIN_PARAGRAPH_LENGTH * 3
    ) {
      result.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current.trim().length > 0) {
    result.push(current.trim());
  }

  return result;
}

/**
 * 按句子边界分割文本
 */
function splitIntoSentences(text: string): string[] {
  return text
    .replace(/([.!?])\s+/g, '$1|||')
    .split('|||')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
