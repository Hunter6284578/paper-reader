import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVocabStore } from '../stores/vocabStore';
import WordDetail from '../components/vocab/WordDetail';

type FilterType = 'all' | 'active' | 'mastered';

export default function VocabBook() {
  const { vocabItems, isLoading, fetchVocabList, deleteVocab, dailyGoal, fetchSettings } = useVocabStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetchVocabList();
    fetchSettings();
  }, []);

  const handleDelete = async (id: number, word: string) => {
    if (confirm(`确定删除单词"${word}"？`)) {
      await deleteVocab(id);
    }
  };

  const playAudio = (url: string) => { new Audio(url).play().catch(() => {}); };

  const filtered = vocabItems.filter((item) => {
    if (filter === 'active' && item.status !== 'active') return false;
    if (filter === 'mastered' && item.status !== 'mastered') return false;
    if (search && !item.word.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-gray-600 hover:text-gray-900">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900">生词本</h1>
            <span className="text-sm text-gray-500">({vocabItems.length} 词)</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/learn')} className="text-sm text-primary-600 hover:underline">学习</button>
            <button onClick={() => navigate('/review')} className="btn-primary text-sm py-1.5">复习</button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-4">
        {/* 搜索栏 */}
        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索单词..."
            className="input-field text-sm"
          />
        </div>

        {/* 筛选标签 */}
        <div className="flex gap-2 mb-4">
          {(['all', 'active', 'mastered'] as const).map((f) => {
            const labels = { all: '全部', active: '学习中', mastered: '已掌握' };
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                  filter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {labels[f]}
              </button>
            );
          })}
        </div>

        {isLoading && vocabItems.length === 0 && (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {search ? '未找到匹配的单词' : '生词本为空'}
            {!search && <p className="text-sm mt-1">阅读论文时选中单词即可收藏</p>}
          </div>
        )}

        <div className="space-y-2">
          {filtered.map((item) => (
            <div key={item.id} className="card">
              {/* 摘要行 */}
              <div
                className="flex items-start gap-3 cursor-pointer"
                onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-lg text-gray-900">{item.word}</span>
                    {item.phonetic && <span className="text-sm text-gray-500">{item.phonetic}</span>}
                    {item.audioUrl && (
                      <button
                        onClick={(e) => { e.stopPropagation(); playAudio(item.audioUrl!); }}
                        className="text-primary-600 hover:text-primary-700"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                        </svg>
                      </button>
                    )}
                    {item.partOfSpeech && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{item.partOfSpeech}</span>
                    )}
                    {item.learnedAt && (
                      <span className="text-xs text-green-600">已学</span>
                    )}
                  </div>

                  {item.definitionCn && (
                    <p className="text-sm text-gray-500 mt-0.5 truncate">{item.definitionCn}</p>
                  )}
                  {!item.definitionCn && item.definitionEn && (
                    <p className="text-sm text-gray-500 mt-0.5 truncate">{item.definitionEn}</p>
                  )}

                  {/* 掌握度进度条 */}
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-24">
                      <div
                        className="bg-primary-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.min(100, item.totalReviews * 20)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400">
                      {item.totalReviews}次 · {Math.round(item.intervalDays)}天
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(item.id, item.word); }}
                    className="text-gray-300 hover:text-red-500 p-1"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                  </button>
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`text-gray-400 transition-transform ${expandedId === item.id ? 'rotate-180' : ''}`}
                  >
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>
              </div>

              {/* 展开详情 */}
              {expandedId === item.id && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <WordDetail item={item} />
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
