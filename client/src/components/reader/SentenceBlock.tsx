import { useState } from 'react';
import type { Sentence } from '../../types';
import { useTranslationStore } from '../../stores/translationStore';
import { useReaderStore } from '../../stores/readerStore';
import MathText from './MathText';

interface SentenceBlockProps {
  sentence: Sentence;
  paperId: string;
}

export default function SentenceBlock({ sentence, paperId }: SentenceBlockProps) {
  const settings = useReaderStore((s) => s.settings);
  const translation = useTranslationStore((s) => s.getSentenceTranslation(paperId, sentence.id));
  const [expanded, setExpanded] = useState(!settings.translationCollapsed);

  if (!settings.showTranslation) {
    return (
      <span className="reader-sentence">
        <MathText text={sentence.content} />{' '}
      </span>
    );
  }

  return (
    <span className="reader-sentence-group inline">
      <span
        className="reader-sentence cursor-pointer border-b border-dashed border-gray-300 hover:border-primary-400 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <MathText text={sentence.content} />
      </span>
      {expanded && translation && (
        <span className="reader-translation text-sm opacity-80 ml-0 block mt-1 italic">
          {translation}
        </span>
      )}
      {expanded && !translation && settings.showTranslation && (
        <span className="reader-translation text-sm opacity-40 ml-0 block mt-1">
          翻译加载中...
        </span>
      )}
      {' '}
    </span>
  );
}
