import { useState, useEffect, useCallback, useRef } from 'react';

interface TextSelection {
  text: string;
  paragraphId: number | null;
  startOffset: number;
  endOffset: number;
  rect: DOMRect | null;
  /** The complete sentence from the block containing the selected word */
  fullSentence: string;
  /** Block ID from data-paragraph-id */
  blockId: number | null;
  /** Page number from data-page-number */
  pageNumber: number | null;
}

/**
 * Extract the sentence containing the target word from full block text
 * using simple sentence boundary detection.
 */
function extractSentence(text: string, selectedWord: string): string {
  if (!text) return selectedWord;

  // Split on sentence boundaries: period, question mark, exclamation mark
  // followed by whitespace or end of string.
  const sentenceRegex = /[^.!?]*[.!?]+(?=\s|$)|[^.!?]+$/g;
  const matches = text.match(sentenceRegex);
  if (!matches || matches.length === 0) return text;

  const lowerWord = selectedWord.toLowerCase();
  for (const sentence of matches) {
    const trimmed = sentence.trim();
    if (trimmed && trimmed.toLowerCase().includes(lowerWord)) {
      return trimmed;
    }
  }
  // Fallback: return the full text
  return text;
}

export function useTextSelection(containerRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const selectionRef = useRef<TextSelection | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
    selectionRef.current = null;
  }, []);

  const handleSelection = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();

    if (!text || text.length === 0) {
      clearSelection();
      return;
    }

    const range = sel?.getRangeAt(0);
    if (!range) {
      clearSelection();
      return;
    }

    // 检查选区是否在容器内
    const container = containerRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) {
      return;
    }

    // 找到最近的段落元素
    let node: Node | null = range.commonAncestorContainer;
    let paragraphEl: HTMLElement | null = null;

    while (node && node !== container) {
      if (node instanceof HTMLElement && node.dataset.paragraphId) {
        paragraphEl = node;
        break;
      }
      node = node.parentNode;
    }

    const paragraphId = paragraphEl
      ? parseInt(paragraphEl.dataset.paragraphId || '0', 10)
      : null;

    // 计算字符偏移
    let startOffset = 0;
    let endOffset = text.length;

    if (paragraphEl) {
      const textContent = paragraphEl.textContent || '';
      const fullSelection = text;

      // 简单方式：在段落文本中查找选中文本
      const idx = textContent.indexOf(fullSelection);
      if (idx >= 0) {
        startOffset = idx;
        endOffset = idx + fullSelection.length;
      }
    }

    // Extract full sentence from block text
    let fullSentence = text;
    let blockId: number | null = paragraphId;
    let pageNumber: number | null = null;

    if (paragraphEl) {
      // Get the full block text from data-block-text attribute
      const blockText = paragraphEl.dataset.blockText || paragraphEl.textContent || '';
      if (blockText) {
        const selectedWord = text.split(/\s+/)[0].replace(/[^a-zA-Z'-]/g, '');
        fullSentence = extractSentence(blockText, selectedWord || text);
      }

      // Try to find the parent container with data-page-number
      let parent: HTMLElement | null = paragraphEl.parentElement;
      while (parent && parent !== container) {
        if (parent.dataset.pageNumber) {
          const pn = parseInt(parent.dataset.pageNumber, 10);
          pageNumber = isNaN(pn) ? null : pn;
          break;
        }
        // Also check for data-block-id which wraps the paragraph
        if (parent.dataset.blockId) {
          blockId = parseInt(parent.dataset.blockId, 10) || blockId;
        }
        parent = parent.parentElement;
      }
    }

    const result: TextSelection = {
      text,
      paragraphId,
      startOffset,
      endOffset,
      rect: range.getBoundingClientRect(),
      fullSentence,
      blockId,
      pageNumber,
    };

    setSelection(result);
    selectionRef.current = result;
  }, [containerRef, clearSelection]);

  useEffect(() => {
    const handleMouseUp = () => {
      // 延迟执行，让浏览器完成选区更新
      setTimeout(handleSelection, 10);
    };

    const handleTouchEnd = () => {
      setTimeout(handleSelection, 100);
    };

    // Android WebView: 使用 selectionchange 检测原生文字选择
    const handleSelectionChange = () => {
      setTimeout(handleSelection, 200);
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('keydown', (e) => {
      // Esc 清除选区
      if (e.key === 'Escape') clearSelection();
    });

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [handleSelection, clearSelection]);

  return { selection, clearSelection };
}
