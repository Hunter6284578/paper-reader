import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVocabStore } from '../stores/vocabStore';
import type { ReviewGrade } from '../types';
import ProgressRing from '../components/vocab/ProgressRing';

interface GradeCount { forgot: number; hard: number; good: number; easy: number }

export default function ReviewSession() {
  const { reviewItems, isLoading, fetchReviewToday, submitReview } = useVocabStore();
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [gradeCounts, setGradeCounts] = useState<GradeCount>({ forgot: 0, hard: 0, good: 0, easy: 0 });
  const [slideDir, setSlideDir] = useState<'left' | null>(null);
  const total = useRef(0);

  useEffect(() => {
    fetchReviewToday();
  }, []);

  useEffect(() => {
    if (reviewItems.length > 0 && total.current === 0) {
      total.current = reviewItems.length;
    }
  }, [reviewItems.length]);

  const currentItem = reviewItems[currentIndex];

  // 自动播放发音
  useEffect(() => {
    if (currentItem?.audioUrl && !flipped) {
      const timer = setTimeout(() => {
        new Audio(currentItem.audioUrl!).play().catch(() => {});
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [currentItem?.id, currentItem?.audioUrl, flipped]);

  const handleReview = async (grade: ReviewGrade) => {
    if (!currentItem) return;
    await submitReview(currentItem.id, grade);
    setGradeCounts((prev) => ({ ...prev, [grade]: prev[grade] + 1 }));
    setFlipped(false);
    setCompleted((c) => c + 1);
    setSlideDir('left');
    setTimeout(() => {
      if (currentIndex >= reviewItems.length - 1) {
        setCurrentIndex(Math.max(0, reviewItems.length - 2));
      }
      setSlideDir(null);
    }, 200);
  };

  const playAudio = (url: string) => { new Audio(url).play().catch(() => {}); };

  const totalReviewed = total.current;
  const progress = totalReviewed > 0 ? Math.round((completed / totalReviewed) * 100) : 0;
  const isFinished = reviewItems.length === 0 && !isLoading;

  // 完成界面
  if (isFinished) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-gray-600 hover:text-gray-900">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900">单词复习</h1>
          </div>
        </header>
        <div className="max-w-lg mx-auto px-4 py-12 text-center">
          {completed > 0 ? (
            <>
              <div className="mb-8">
                <ProgressRing progress={100} size={120} strokeWidth={8} color="#22c55e">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{completed}</div>
                    <div className="text-xs text-gray-400">已复习</div>
                  </div>
                </ProgressRing>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">复习完成!</h2>
              <div className="grid grid-cols-4 gap-3 mb-8">
                {(['forgot', 'hard', 'good', 'easy'] as const).map((g) => {
                  const colors = { forgot: 'text-red-500', hard: 'text-orange-500', good: 'text-green-600', easy: 'text-blue-500' };
                  const labels = { forgot: '忘记', hard: '困难', good: '记得', easy: '简单' };
                  return (
                    <div key={g} className="text-center">
                      <div className={`text-lg font-bold ${colors[g]}`}>{gradeCounts[g]}</div>
                      <div className="text-xs text-gray-400">{labels[g]}</div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">今日无需复习</h2>
              <p className="text-sm text-gray-500">所有单词都还没到复习时间</p>
            </>
          )}
          <div className="flex flex-col gap-3 mt-6">
            <button onClick={() => navigate('/learn')} className="btn-primary">学习新单词</button>
            <button onClick={() => navigate('/')} className="text-sm text-gray-500 hover:text-gray-700">返回首页</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-gray-600 hover:text-gray-900">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900">单词复习</h1>
          </div>
          <span className="text-sm text-gray-500">{completed} / {totalReviewed}</span>
        </div>
        <div className="w-full bg-gray-100 h-1">
          <div className="bg-primary-500 h-1 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8">
        {isLoading && !currentItem && (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        )}

        {currentItem && (
          <div className={`space-y-6 transition-all duration-200 ${slideDir === 'left' ? '-translate-x-8 opacity-0' : ''}`}>
            {/* 翻转卡片 */}
            <div className="flashcard-flip cursor-pointer" onClick={() => setFlipped(!flipped)}>
              <div className={`flashcard-flip-inner ${flipped ? 'flipped' : ''}`}>
                {/* 正面 - 单词 */}
                <div className="flashcard-front card min-h-[280px] flex flex-col items-center justify-center p-6">
                  <h2 className="text-3xl font-bold text-gray-900">{currentItem.word}</h2>
                  {currentItem.phonetic && (
                    <p className="text-lg text-gray-500 mt-2">{currentItem.phonetic}</p>
                  )}
                  {currentItem.audioUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); playAudio(currentItem.audioUrl!); }}
                      className="mt-3 w-10 h-10 flex items-center justify-center rounded-full bg-primary-50 text-primary-600 hover:bg-primary-100"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                      </svg>
                    </button>
                  )}
                  {currentItem.contextSentence && (
                    <p className="text-sm text-gray-400 mt-4 text-center italic">
                      "...{currentItem.contextSentence.slice(0, 100)}..."
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-6">点击卡片查看释义</p>
                </div>

                {/* 背面 - 释义 */}
                <div className="flashcard-back card min-h-[280px] flex flex-col items-center justify-center p-6 absolute inset-0">
                  {currentItem.partOfSpeech && (
                    <span className="text-sm bg-gray-100 text-gray-600 px-3 py-1 rounded mb-3">{currentItem.partOfSpeech}</span>
                  )}
                  {currentItem.definitionEn && (
                    <p className="text-base text-gray-800 text-center mb-2">{currentItem.definitionEn}</p>
                  )}
                  {currentItem.definitionCn && (
                    <p className="text-base text-gray-600 text-center mb-2">{currentItem.definitionCn}</p>
                  )}
                  {currentItem.exampleSentence && (
                    <p className="text-sm text-gray-400 italic mt-2 text-center">"{currentItem.exampleSentence}"</p>
                  )}
                  {currentItem.wordRoots && (
                    <div className="mt-3 bg-amber-50 rounded-lg p-2 w-full">
                      <p className="text-xs text-amber-800 text-center">{currentItem.wordRoots}</p>
                    </div>
                  )}
                  {currentItem.mnemonic && (
                    <div className="mt-2 bg-blue-50 rounded-lg p-2 w-full">
                      <p className="text-xs text-blue-800 text-center">{currentItem.mnemonic}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 评分按钮 — 始终显示 */}
            <div className="grid grid-cols-4 gap-2">
              {([
                { grade: 'forgot' as const, label: '忘记', bg: 'bg-red-500', hover: 'hover:bg-red-600', active: 'active:bg-red-700' },
                { grade: 'hard' as const, label: '困难', bg: 'bg-orange-500', hover: 'hover:bg-orange-600', active: 'active:bg-orange-700' },
                { grade: 'good' as const, label: '记得', bg: 'bg-green-500', hover: 'hover:bg-green-600', active: 'active:bg-green-700' },
                { grade: 'easy' as const, label: '简单', bg: 'bg-blue-500', hover: 'hover:bg-blue-600', active: 'active:bg-blue-700' },
              ]).map(({ grade, label, bg, hover, active }) => (
                <button
                  key={grade}
                  onClick={() => handleReview(grade)}
                  className={`py-3 ${bg} text-white rounded-lg text-sm font-medium ${hover} ${active} transition-colors`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 下次复习提示 */}
            <p className="text-xs text-gray-400 text-center">
              已复习 {completed} / {totalReviewed} 个单词
              {currentItem.intervalDays > 0 && ` · 当前间隔 ${Math.round(currentItem.intervalDays)} 天`}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
