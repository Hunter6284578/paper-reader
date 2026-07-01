import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVocabStore } from '../stores/vocabStore';
import ProgressRing from '../components/vocab/ProgressRing';
import WordCard from '../components/vocab/WordCard';

type Phase = 'assess' | 'detail' | 'done';

export default function LearnSession() {
  const { learnItems, isLoading, fetchLearnBatch, markAsLearned } = useVocabStore();
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('assess');
  const [completed, setCompleted] = useState(0);
  const [knewCount, setKnewCount] = useState(0);
  const [slideDir, setSlideDir] = useState<'left' | 'right' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLearnBatch(10);
  }, []);

  const currentItem = learnItems[currentIndex];

  const goNext = useCallback(() => {
    setSlideDir('left');
    setTimeout(() => {
      if (currentIndex >= learnItems.length - 1) {
        setPhase('done');
      } else {
        setCurrentIndex((i) => i + 1);
        setPhase('assess');
      }
      setSlideDir(null);
    }, 200);
  }, [currentIndex, learnItems.length]);

  const handleAssess = async (knew: boolean) => {
    if (!currentItem) return;
    if (knew) setKnewCount((c) => c + 1);
    await markAsLearned(currentItem.id);
    setCompleted((c) => c + 1);
    setPhase('detail');
  };

  const handleNext = () => {
    goNext();
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setPhase('assess');
    setCompleted(0);
    setKnewCount(0);
    fetchLearnBatch(10);
  };

  // 手势支持
  const touchStartX = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(diff) > 60) {
      if (phase === 'assess') {
        // 左滑 = 不认识，右滑 = 认识
        handleAssess(diff < 0);
      } else if (phase === 'detail') {
        handleNext();
      }
    }
  };

  if (isLoading && learnItems.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (!isLoading && learnItems.length === 0 && phase !== 'done') {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-gray-600 hover:text-gray-900">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900">学习单词</h1>
          </div>
        </header>
        <div className="max-w-lg mx-auto px-4 py-16 text-center">
          <div className="text-5xl mb-4">📚</div>
          <p className="text-lg font-medium text-gray-700">暂无待学习的单词</p>
          <p className="text-sm text-gray-500 mt-2">阅读论文时选中单词即可收藏到生词本</p>
          <button onClick={() => navigate('/')} className="btn-primary mt-6">返回首页</button>
        </div>
      </div>
    );
  }

  // 完成界面
  if (phase === 'done') {
    const progress = learnItems.length > 0 ? Math.round((completed / learnItems.length) * 100) : 100;
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-gray-600 hover:text-gray-900">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900">学习单词</h1>
          </div>
        </header>
        <div className="max-w-lg mx-auto px-4 py-12 text-center">
          <div className="mb-8">
            <ProgressRing progress={progress} size={120} strokeWidth={8} color="#22c55e">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{completed}</div>
                <div className="text-xs text-gray-400">已学</div>
              </div>
            </ProgressRing>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">学习完成!</h2>
          <div className="flex justify-center gap-6 mb-8 text-sm text-gray-500">
            <span>认识 <strong className="text-green-600">{knewCount}</strong> 个</span>
            <span>不认识 <strong className="text-orange-500">{completed - knewCount}</strong> 个</span>
          </div>
          <div className="flex flex-col gap-3">
            <button onClick={handleRestart} className="btn-primary">再学一组</button>
            <button onClick={() => navigate('/review')} className="btn-secondary">开始复习</button>
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
            <h1 className="text-lg font-bold text-gray-900">学习单词</h1>
          </div>
          <span className="text-sm text-gray-500">{completed} / {learnItems.length}</span>
        </div>
        {/* 进度条 */}
        <div className="w-full bg-gray-100 h-1">
          <div
            className="bg-primary-500 h-1 transition-all duration-300"
            style={{ width: `${(completed / learnItems.length) * 100}%` }}
          />
        </div>
      </header>

      <main
        className="max-w-lg mx-auto px-4 py-8"
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {currentItem && (
          <div className={`transition-all duration-200 ${slideDir === 'left' ? '-translate-x-8 opacity-0' : ''}`}>
            {/* Step 1: 认识评估 */}
            {phase === 'assess' && (
              <div className="space-y-6">
                <div className="card min-h-[300px] flex flex-col items-center justify-center p-8">
                  <h2 className="text-3xl font-bold text-gray-900 mb-2">{currentItem.word}</h2>
                  {currentItem.phonetic && (
                    <p className="text-lg text-gray-500 mb-4">{currentItem.phonetic}</p>
                  )}
                  {currentItem.audioUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); new Audio(currentItem.audioUrl!).play().catch(() => {}); }}
                      className="w-10 h-10 flex items-center justify-center rounded-full bg-primary-50 text-primary-600 hover:bg-primary-100 mb-4"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                      </svg>
                    </button>
                  )}
                  {currentItem.contextSentence && (
                    <p className="text-sm text-gray-400 text-center italic mt-2">
                      "...{currentItem.contextSentence.slice(0, 80)}..."
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-6">你还记得这个单词的意思吗?</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleAssess(false)}
                    className="py-4 bg-orange-50 text-orange-600 border border-orange-200 rounded-xl text-base font-medium hover:bg-orange-100 active:bg-orange-200 transition-colors"
                  >
                    不认识
                  </button>
                  <button
                    onClick={() => handleAssess(true)}
                    className="py-4 bg-green-50 text-green-600 border border-green-200 rounded-xl text-base font-medium hover:bg-green-100 active:bg-green-200 transition-colors"
                  >
                    认识
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: 释义展示 */}
            {phase === 'detail' && (
              <div className="space-y-6">
                <WordCard item={currentItem} showDefinition autoPlay />
                <button
                  onClick={handleNext}
                  className="w-full py-4 bg-primary-600 text-white rounded-xl text-base font-medium hover:bg-primary-700 active:bg-primary-800 transition-colors"
                >
                  {currentIndex >= learnItems.length - 1 ? '完成学习' : '下一个'}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
