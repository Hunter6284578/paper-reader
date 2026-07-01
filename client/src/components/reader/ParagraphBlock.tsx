import { useState, useRef, useEffect } from 'react';
import type { Paragraph, Highlight } from '../../types';
import { useReaderStore } from '../../stores/readerStore';
import { useTranslationStore } from '../../stores/translationStore';
import SentenceBlock from './SentenceBlock';
import MathText from './MathText';

interface ParagraphBlockProps {
  paragraph: Paragraph;
  paperId: string;
  highlights: Highlight[];
  onParagraphVisible: (index: number) => void;
}

export default function ParagraphBlock({
  paragraph,
  paperId,
  highlights,
  onParagraphVisible,
}: ParagraphBlockProps) {
  const settings = useReaderStore((s) => s.settings);
  const paragraphTranslation = useTranslationStore((s) =>
    s.getParagraphTranslation(paperId, paragraph.id)
  );
  const isTranslating = useTranslationStore((s) => s.isTranslating(paragraph.id));
  const [showTranslation, setShowTranslation] = useState(!settings.translationCollapsed);

  const ref = useRef<HTMLDivElement>(null);

  // IntersectionObserver: 追踪段落可见性
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onParagraphVisible(paragraph.paragraphIndex);
          }
        }
      },
      { rootMargin: '0px 0px -50% 0px', threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [paragraph.paragraphIndex, onParagraphVisible]);

  // 渲染高亮文本
  const renderHighlightedText = (text: string) => {
    // 过滤当前段落的高亮
    const paraHighlights = highlights.filter((h) => {
      const pos = h.position as any;
      return pos?.mode === 'text' && pos?.paragraphId === paragraph.id;
    });

    if (paraHighlights.length === 0) return text;

    // 按 startOffset 排序
    const sorted = paraHighlights
      .map((h) => {
        const pos = h.position as any;
        return { start: pos.startOffset, end: pos.endOffset, color: h.color };
      })
      .sort((a, b) => a.start - b.start);

    const parts: React.ReactNode[] = [];
    let lastEnd = 0;

    for (const hl of sorted) {
      if (hl.start > lastEnd) {
        parts.push(text.slice(lastEnd, hl.start));
      }
      parts.push(
        <mark
          key={hl.start}
          className="rounded px-0.5"
          style={{ backgroundColor: hl.color + '60' }}
        >
          {text.slice(hl.start, hl.end)}
        </mark>
      );
      lastEnd = Math.max(lastEnd, hl.end);
    }

    if (lastEnd < text.length) {
      parts.push(text.slice(lastEnd));
    }

    return parts;
  };

  const isSentenceMode = settings.translationMode === 'sentence';

  return (
    <div
      ref={ref}
      data-paragraph-id={paragraph.id}
      className="reader-paragraph mb-6"
    >
      {/* 原文 */}
      <p className="reader-text leading-relaxed" data-paragraph-id={paragraph.id}>
        {isSentenceMode
          ? paragraph.sentences.map((s) => (
              <SentenceBlock key={s.id} sentence={s} paperId={paperId} />
            ))
          : (highlights.filter((h) => {
              const pos = h.position as any;
              return pos?.mode === 'text' && pos?.paragraphId === paragraph.id;
            }).length > 0)
            ? renderHighlightedText(paragraph.content)
            : <MathText text={paragraph.processedContent || paragraph.content} />
        }
      </p>

      {/* 段落翻译（仅在逐段模式下显示）*/}
      {!isSentenceMode && settings.showTranslation && (
        <div className="mt-2">
          <button
            onClick={() => setShowTranslation(!showTranslation)}
            className="text-xs font-medium opacity-50 hover:opacity-80 transition-opacity mb-1"
          >
            {showTranslation ? '▼ 收起翻译' : '▶ 显示翻译'}
          </button>

          {showTranslation && (
            <p className="reader-translation text-sm opacity-75 leading-relaxed italic pl-3 border-l-2 border-current/20">
              {paragraphTranslation || paragraph.translation || (
                isTranslating ? (
                  <span className="skeleton-pulse inline-block w-full h-4 rounded" />
                ) : (
                  <span className="opacity-50">暂无翻译</span>
                )
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
