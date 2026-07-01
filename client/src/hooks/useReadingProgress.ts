import { useReaderStore } from '../stores/readerStore';

/**
 * 阅读进度 hook
 * 返回当前阅读进度百分比
 */
export function useReadingProgress() {
  const currentParagraphIndex = useReaderStore((s) => s.currentParagraphIndex);
  const totalParagraphs = useReaderStore((s) => s.totalParagraphs);

  const progress = totalParagraphs > 0
    ? Math.min(100, Math.round((currentParagraphIndex / totalParagraphs) * 100))
    : 0;

  return {
    progress,
    currentParagraphIndex,
    totalParagraphs,
  };
}
