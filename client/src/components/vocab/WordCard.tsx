import { useEffect, useRef } from 'react';
import type { VocabItem } from '../../types';

interface Props {
  item: VocabItem;
  showDefinition?: boolean;
  autoPlay?: boolean;
  onClick?: () => void;
}

export default function WordCard({ item, showDefinition = false, autoPlay = false, onClick }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (autoPlay && item.audioUrl) {
      audioRef.current?.play().catch(() => {});
    }
  }, [item.audioUrl, autoPlay, item.id]);

  const playAudio = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.audioUrl) {
      new Audio(item.audioUrl).play().catch(() => {});
    }
  };

  return (
    <div
      className={`card cursor-pointer transition-all duration-200 ${onClick ? 'hover:shadow-md active:scale-[0.98]' : ''}`}
      onClick={onClick}
    >
      {/* 单词头部 */}
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold text-gray-900">{item.word}</h2>
        {item.phonetic && (
          <span className="text-sm text-gray-500">{item.phonetic}</span>
        )}
        {item.audioUrl && (
          <button
            onClick={playAudio}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-50 text-primary-600 hover:bg-primary-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          </button>
        )}
        {item.partOfSpeech && (
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{item.partOfSpeech}</span>
        )}
      </div>

      {audioRef.current && <audio ref={audioRef} src={item.audioUrl || undefined} />}

      {/* 释义（翻转后显示） */}
      {showDefinition && (
        <div className="mt-4 space-y-3 animate-in">
          {item.definitionEn && (
            <p className="text-base text-gray-800">{item.definitionEn}</p>
          )}
          {item.definitionCn && (
            <p className="text-base text-gray-600">{item.definitionCn}</p>
          )}
          {item.exampleSentence && (
            <p className="text-sm text-gray-400 italic border-l-2 border-gray-200 pl-3">
              {item.exampleSentence}
            </p>
          )}
          {item.wordRoots && (
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs font-medium text-amber-700 mb-1">词根词缀</p>
              <p className="text-sm text-amber-900">{item.wordRoots}</p>
            </div>
          )}
          {item.mnemonic && (
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs font-medium text-blue-700 mb-1">助记</p>
              <p className="text-sm text-blue-900">{item.mnemonic}</p>
            </div>
          )}
          {/* 语境 */}
          {item.contexts && item.contexts.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">论文语境</p>
              {item.contexts.slice(0, 2).map((ctx) => (
                <p key={ctx.id} className="text-xs text-gray-500 italic border-l-2 border-primary-200 pl-2">
                  {ctx.sentence.length > 100 ? ctx.sentence.slice(0, 100) + '...' : ctx.sentence}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
