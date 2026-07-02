import { useEffect, useRef, useState } from 'react';
import type { DocumentBlock, Highlight } from '../../types';
import { useReaderStore } from '../../stores/readerStore';
import { usePaperStore } from '../../stores/paperStore';
import { useTranslationStore } from '../../stores/translationStore';
import { resolveApiUrl } from '../../services/api';
import MathText from './MathText';

interface Props {
  block: DocumentBlock;
  highlights: Highlight[];
  onVisible: (index: number, id: number) => void;
  onOpenOriginal: (pageNumber: number, bbox: number[] | null) => void;
}

export default function DocumentBlockView({ block, highlights, onVisible, onOpenOriginal }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const settings = useReaderStore((state) => state.settings);
  const deleteHighlight = usePaperStore((state) => state.deleteHighlight);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const translated = useTranslationStore((state) => state.getParagraphTranslation('', block.id));
  const paperTranslation = useTranslationStore((state) => {
    for (const values of Object.values(state.cache)) if (values[block.id]) return values[block.id];
    return null;
  });
  const isTranslating = useTranslationStore((state) => state.isTranslating(block.id));
  const [expanded, setExpanded] = useState(!settings.translationCollapsed);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onVisible(block.blockIndex, block.id);
    }, { rootMargin: '0px 0px -45% 0px', threshold: 0.1 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [block.blockIndex, block.id, onVisible]);

  if (block.type === 'section') {
    return <h2 ref={ref} data-block-id={block.id} data-block-index={block.blockIndex} className="text-xl font-bold mt-10 mb-4 border-b pb-2">{block.content}</h2>;
  }

  if (['figure', 'table', 'algorithm'].includes(block.type)) {
    return (
      <figure ref={ref} data-block-id={block.id} data-block-index={block.blockIndex} className="my-6">
        <button className="block w-full" onClick={() => block.pageNumber && onOpenOriginal(block.pageNumber, block.bbox)}>
          {block.assetUrl ? (
            <img src={resolveApiUrl(block.assetUrl)} className="w-full h-auto rounded-lg border shadow-sm bg-white" loading="lazy" alt={`${block.type} on page ${block.pageNumber}`} />
          ) : (
            <div className="w-full p-4 rounded-lg border bg-gray-50 text-center text-sm text-gray-400">[{block.type} · 第 {block.pageNumber} 页]</div>
          )}
        </button>
        {block.caption && <figcaption className="text-xs text-gray-500 mt-2 text-center">{block.caption}</figcaption>}
        <p className="text-xs text-gray-400 text-center mt-1">点击查看原页</p>
      </figure>
    );
  }

  if (block.type === 'formula') {
    const hasLatex = block.processedContent && block.processedContent.includes('$');
    return (
      <figure ref={ref} data-block-id={block.id} data-block-index={block.blockIndex} className="my-4">
        {hasLatex ? (
          <div className="overflow-x-auto py-2"><MathText text={block.processedContent!} /></div>
        ) : block.assetUrl ? (
          <button className="block w-full" onClick={() => block.pageNumber && onOpenOriginal(block.pageNumber, block.bbox)}>
            <img src={resolveApiUrl(block.assetUrl)} className="w-full h-auto rounded-lg border shadow-sm bg-white" loading="lazy" alt={`formula on page ${block.pageNumber}`} />
          </button>
        ) : (
          <pre className="text-sm overflow-x-auto p-3 bg-gray-50 rounded-lg">{block.content}</pre>
        )}
        {block.caption && <figcaption className="text-xs text-gray-500 mt-1 text-center">{block.caption}</figcaption>}
      </figure>
    );
  }

  const text = block.content || '';
  const blockHighlights = highlights.filter((highlight) => {
    const position = highlight.position as unknown as { mode?: string; paragraphId?: number };
    return position.mode === 'text' && position.paragraphId === block.id;
  });
  const renderText = () => {
    if (!blockHighlights.length) return <MathText text={block.processedContent || text} />;
    const ranges = blockHighlights.map((highlight) => {
      const position = highlight.position as unknown as { startOffset: number; endOffset: number };
      return { start: position.startOffset, end: position.endOffset, color: highlight.color };
    }).sort((a, b) => a.start - b.start);
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    ranges.forEach((range, index) => {
      if (range.start > cursor) nodes.push(<MathText key={`t${index}`} text={text.slice(cursor, range.start)} />);
      nodes.push(
        <span key={`m${index}`} className="relative cursor-pointer" onClick={(e) => { e.stopPropagation(); setActiveHighlightId(blockHighlights[index]?.id || null); }}>
          <mark style={{ backgroundColor: `${range.color}60` }}>{text.slice(range.start, range.end)}</mark>
          {activeHighlightId === blockHighlights[index]?.id && (
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 bg-white rounded-lg shadow-lg border p-1 flex gap-1 whitespace-nowrap">
              <button className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded" onClick={(e) => { e.stopPropagation(); deleteHighlight(activeHighlightId!); setActiveHighlightId(null); }}>删除</button>
              <button className="text-xs px-2 py-1 text-gray-500 hover:bg-gray-50 rounded" onClick={(e) => { e.stopPropagation(); setActiveHighlightId(null); }}>关闭</button>
            </span>
          )}
        </span>
      );
      cursor = Math.max(cursor, range.end);
    });
    if (cursor < text.length) nodes.push(<MathText key="tlast" text={text.slice(cursor)} />);
    return nodes;
  };

  const translation = paperTranslation || translated || block.translation;
  return (
    <div ref={ref} data-block-id={block.id} data-block-index={block.blockIndex} data-page-number={block.pageNumber || ''} className={`reader-paragraph ${block.type === 'caption' ? 'mb-4 text-sm opacity-80' : 'mb-6'}`}>
      <p className="reader-text leading-relaxed" data-paragraph-id={block.id} data-block-text={text}>{renderText()}</p>
      {block.type === 'text' && settings.showTranslation && (
        <div className="mt-2">
          <button className="text-xs opacity-50 mb-1" onClick={() => setExpanded((value) => !value)}>{expanded ? '▼ 收起翻译' : '▶ 显示翻译'}</button>
          {expanded && <div className="reader-translation text-sm opacity-75 leading-relaxed pl-3 border-l-2 border-current/20">{translation ? <MathText text={translation} /> : (isTranslating ? '翻译中…' : '暂无翻译')}</div>}
        </div>
      )}
    </div>
  );
}
