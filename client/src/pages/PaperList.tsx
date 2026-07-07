import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePaperStore } from '../stores/paperStore';
import { useVocabStore } from '../stores/vocabStore';
import { useReaderStore } from '../stores/readerStore';
import { getReadingStats, authorizedFetch, askGlobalQuestion } from '../services/api';
import StudyCalendar from '../components/vocab/StudyCalendar';
import ProgressRing from '../components/vocab/ProgressRing';

export default function PaperList() {
  const { papers, isLoading, fetchPapers, uploadPaper, deletePaper } = usePaperStore();
  const { stats, fetchStats, studyCalendar, fetchStudyCalendar, dailyGoal, fetchSettings } = useVocabStore();
  const theme = useReaderStore((s) => s.settings.theme);
  const isDark = theme === 'dark';
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [readingTimes, setReadingTimes] = useState<Record<string, number>>({});

  // Global search state
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [globalQuestion, setGlobalQuestion] = useState('');
  const [globalAnswer, setGlobalAnswer] = useState('');
  const [globalReferences, setGlobalReferences] = useState<Array<{ index: number; paperId: string; paperTitle: string; sectionTitle: string | null; pageNumber: number | null; score: number }>>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const globalAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchPapers();
    fetchStats();
    fetchStudyCalendar();
    fetchSettings();
  }, []);

  // Fetch reading stats for all papers
  useEffect(() => {
    if (papers.length === 0) return;
    const times: Record<string, number> = {};
    Promise.all(
      papers.map(async (paper) => {
        try {
          const stats = await getReadingStats(paper.id);
          times[paper.id] = stats.totalReadingTime;
        } catch {
          times[paper.id] = 0;
        }
      })
    ).then(() => setReadingTimes({ ...times }));
  }, [papers]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        if (files.length > 1) {
          setUploadProgress(`上传中 ${i + 1}/${files.length}...`);
        }
        await uploadPaper(files[i]);
      }
    } catch (err: any) {
      alert(err.message || '上传失败');
    } finally {
      setUploading(false);
      setUploadProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const exportHighlights = async (paperId: string, title: string) => {
    const res = await authorizedFetch(`/highlights/export/${paperId}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}-笔记.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id: string, title: string) => {
    if (confirm(`确定删除论文"${title}"？`)) {
      await deletePaper(id);
    }
  };

  const handleGlobalAsk = async () => {
    const q = globalQuestion.trim();
    if (!q || globalLoading) return;

    // Abort previous request if any
    if (globalAbortRef.current) globalAbortRef.current.abort();
    const controller = new AbortController();
    globalAbortRef.current = controller;

    setGlobalAnswer('');
    setGlobalReferences([]);
    setGlobalLoading(true);

    try {
      await askGlobalQuestion(q, {
        onChunk: (text) => setGlobalAnswer((prev) => prev + text),
        onDone: (data) => {
          setGlobalReferences(data.references);
          setGlobalLoading(false);
        },
        onError: (error) => {
          setGlobalAnswer((prev) => prev + `\n\n[错误: ${error}]`);
          setGlobalLoading(false);
        },
      }, controller.signal);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setGlobalAnswer((prev) => prev + `\n\n[错误: ${e.message}]`);
        setGlobalLoading(false);
      }
    }
  };

  const getStatusBadge = (status: string, processingStatus: string) => {
    if (processingStatus === 'processing') return <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-yellow-900/40 text-yellow-300' : 'bg-yellow-100 text-yellow-700'}`}>处理中</span>;
    if (processingStatus === 'error') return <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-red-900/40 text-red-300' : 'bg-red-100 text-red-700'}`}>处理失败</span>;
    if (processingStatus === 'unsupported_scan') return <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-orange-900/40 text-orange-300' : 'bg-orange-100 text-orange-700'}`}>扫描件不支持</span>;
    const labels: Record<string, string> = { unread: '未读', reading: '在读', finished: '已读' };
    const colors: Record<string, string> = {
      unread: isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600',
      reading: isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700',
      finished: isDark ? 'bg-green-900/40 text-green-300' : 'bg-green-100 text-green-700',
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || (isDark ? 'bg-gray-700' : 'bg-gray-100')}`}>{labels[status] || status}</span>;
  };

  const todayNew = studyCalendar?.todayStats?.newWords || 0;
  const todayReview = studyCalendar?.todayStats?.reviews || 0;
  const todayTotal = todayNew + todayReview;
  const goalProgress = dailyGoal > 0 ? Math.min(100, Math.round((todayTotal / dailyGoal) * 100)) : 0;

  const filteredPapers = papers.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      (p.abstract || '').toLowerCase().includes(q) ||
      (p.authors || []).join(' ').toLowerCase().includes(q)
    );
  });

  return (
    <div className={`min-h-screen ${isDark ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      <header className={`sticky top-0 z-10 border-b ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className={`text-lg font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>论文阅读器</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/settings')} className={`text-sm ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'}`}>设置</button>
            <button onClick={() => navigate('/vocab')} className="text-sm text-primary-400 hover:underline">生词本</button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* 学习仪表盘 */}
        <div className={`rounded-xl shadow-sm border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <div className="flex items-start gap-4">
            {/* 今日进度圆环 */}
            <ProgressRing progress={goalProgress} size={72} strokeWidth={6} color="#4f46e5">
              <div className="text-center">
                <div className={`text-lg font-bold ${isDark ? 'text-primary-400' : 'text-primary-600'}`}>{todayTotal}</div>
                <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>/{dailyGoal}</div>
              </div>
            </ProgressRing>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <h3 className={`text-sm font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>今日学习</h3>
                {studyCalendar && studyCalendar.streak > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-orange-900/40 text-orange-300' : 'bg-orange-100 text-orange-600'}`}>
                    连续 {studyCalendar.streak} 天
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-xl font-bold text-green-500">{todayNew}</div>
                  <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>新学单词</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-blue-500">{todayReview}</div>
                  <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>复习单词</div>
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2">
                <button
                  onClick={() => navigate('/learn')}
                  className="btn-primary text-sm py-1.5 px-3"
                >
                  学习
                </button>
                <button
                  onClick={() => navigate('/review')}
                  className={`text-sm py-1.5 px-3 rounded-lg font-medium transition-colors ${
                    (stats?.dueToday || 0) > 0
                      ? 'bg-orange-500 text-white hover:bg-orange-600'
                      : isDark
                        ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  复习{stats?.dueToday ? ` (${stats.dueToday})` : ''}
                </button>
              </div>
            </div>
          </div>

          {/* 打卡日历 */}
          {studyCalendar && studyCalendar.calendar.length > 0 && (
            <div className={`mt-4 pt-3 border-t ${isDark ? 'border-gray-700' : 'border-gray-100'}`}>
              <p className={`text-xs mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>学习打卡</p>
              <StudyCalendar calendar={studyCalendar.calendar} days={56} />
            </div>
          )}
        </div>

        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <div className={`rounded-xl shadow-sm border p-4 text-center ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
              <div className={`text-2xl font-bold ${isDark ? 'text-primary-400' : 'text-primary-600'}`}>{stats.total}</div>
              <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>总生词</div>
            </div>
            <div className={`rounded-xl shadow-sm border p-4 text-center ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
              <div className="text-2xl font-bold text-green-500">{stats.mastered}</div>
              <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>已掌握</div>
            </div>
            <div className={`rounded-xl shadow-sm border p-4 text-center ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
              <div className="text-2xl font-bold text-purple-500">{stats.recentReviews}</div>
              <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>7天复习</div>
            </div>
          </div>
        )}

        {/* 上传按钮 */}
        <div className="flex items-center gap-3">
          <input ref={fileInputRef} type="file" accept=".pdf" multiple onChange={handleUpload} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary flex items-center gap-2"
            disabled={uploading}
          >
            {uploading ? <><span className="animate-spin">⏳</span> {uploadProgress || '上传中...'}</> : <>+ 上传论文</>}
          </button>
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>支持 PDF 格式，可批量上传</span>
        </div>

        {/* 搜索框 */}
        <div>
          <input
            type="text"
            placeholder="搜索论文..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full px-4 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${isDark ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500' : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'}`}
          />
        </div>

        {/* 论文列表 */}
        <div className="space-y-3">
          {isLoading && papers.length === 0 && <div className={`text-center py-12 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>加载中...</div>}
          {!isLoading && filteredPapers.length === 0 && (
            <div className={`text-center py-12 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {searchQuery ? (
                <p className="text-lg mb-2">未找到匹配的论文</p>
              ) : (
                <>
                  <p className="text-lg mb-2">暂无论文</p>
                  <p className="text-sm">点击上方按钮上传你的第一篇论文</p>
                </>
              )}
            </div>
          )}
          {filteredPapers.map((paper) => (
            <div
              key={paper.id}
              className={`rounded-xl shadow-sm border p-4 transition-shadow cursor-pointer ${isDark ? 'bg-gray-800 border-gray-700 hover:shadow-md hover:border-gray-600' : 'bg-white border-gray-100 hover:shadow-md'}`}
              onClick={() => navigate(`/paper/${paper.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className={`font-medium truncate ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{paper.title}</h3>
                  {paper.authors && paper.authors.length > 0 && (
                    <p className={`text-xs mt-1 truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {paper.authors.join(', ')}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {getStatusBadge(paper.status, paper.processingStatus)}
                    {paper.doi && (
                      <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className={`text-xs px-1.5 py-0.5 rounded font-mono ${isDark ? 'bg-indigo-900/40 text-indigo-300 hover:bg-indigo-900/60' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                      >
                        DOI
                      </a>
                    )}
                    {paper.pageCount && <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{paper.pageCount} 页</span>}
                    <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{new Date(paper.createdAt).toLocaleDateString('zh-CN')}</span>
                    {readingTimes[paper.id] > 0 && (
                      <span className={`text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                        阅读 {Math.round(readingTimes[paper.id] / 60)} 分钟
                      </span>
                    )}
                  </div>
                  {paper.abstract && <p className={`text-sm mt-2 line-clamp-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{paper.abstract}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); exportHighlights(paper.id, paper.title); }}
                      className={`text-xs px-2 py-1 rounded-lg transition-colors ${isDark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      导出笔记
                    </button>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(paper.id, paper.title); }}
                  className={`p-1 ml-2 ${isDark ? 'text-gray-500 hover:text-red-400' : 'text-gray-400 hover:text-red-500'}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Floating Global Search Button */}
      <button
        aria-label="打开全局问答"
        onClick={() => setShowGlobalSearch(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary-500 text-white shadow-lg flex items-center justify-center hover:bg-primary-600 transition-colors z-20"
        title="全局问答"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
          <path d="M8 11h6M11 8v6" />
        </svg>
      </button>

      {/* Global Search Modal */}
      {showGlobalSearch && (
        <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center">
          <button type="button" aria-label="关闭全局问答" className="absolute inset-0 bg-black/40" onClick={() => setShowGlobalSearch(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="global-search-title"
            className={`relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden overscroll-contain ${isDark ? 'bg-gray-800' : 'bg-white'}`}
          >
            {/* Modal Header */}
            <div className={`flex items-center justify-between px-5 py-3 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
              <h2 id="global-search-title" className={`text-base font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>全局问答</h2>
              <button
                aria-label="关闭"
                onClick={() => {
                  setShowGlobalSearch(false);
                  if (globalAbortRef.current) globalAbortRef.current.abort();
                  setGlobalLoading(false);
                }}
                className={`p-1 rounded-lg ${isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Question Input */}
            <div className={`px-5 py-3 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className="flex gap-2">
                <input
                  aria-label="跨论文提问"
                  type="text"
                  placeholder="跨论文提问..."
                  value={globalQuestion}
                  onChange={(e) => setGlobalQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleGlobalAsk()}
                  className={`flex-1 px-4 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${isDark ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-500' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'}`}
                  disabled={globalLoading}
                />
                <button
                  onClick={handleGlobalAsk}
                  disabled={globalLoading || !globalQuestion.trim()}
                  className="btn-primary text-sm px-4 py-2 whitespace-nowrap disabled:opacity-50"
                >
                  {globalLoading ? '思考中...' : '提问'}
                </button>
              </div>
            </div>

            {/* Results Area */}
            <div className="flex-1 overflow-y-auto px-5 py-4 min-h-[200px]">
              {globalAnswer ? (
                <div>
                  <div className={`text-sm whitespace-pre-wrap leading-relaxed ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    {globalAnswer}
                  </div>
                  {globalLoading && (
                    <span className={`inline-block w-2 h-4 ml-0.5 animate-pulse ${isDark ? 'bg-gray-400' : 'bg-gray-500'}`} />
                  )}
                  {globalReferences.length > 0 && (
                    <div className={`mt-4 pt-3 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                      <p className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>参考来源:</p>
                      <div className="space-y-1.5">
                        {globalReferences.map((ref, i) => (
                          <button
                            type="button"
                            key={i}
                            className={`w-full text-left text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 ${isDark ? 'bg-gray-700/50 hover:bg-gray-700 text-gray-300' : 'bg-gray-50 hover:bg-gray-100 text-gray-600'}`}
                            onClick={() => navigate(`/paper/${ref.paperId}`)}
                          >
                            <span className={`font-medium ${isDark ? 'text-primary-400' : 'text-primary-600'}`}>[{ref.index}]</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${isDark ? 'bg-indigo-900/40 text-indigo-300' : 'bg-indigo-50 text-indigo-600'}`}>
                              {ref.paperTitle.length > 30 ? ref.paperTitle.slice(0, 30) + '...' : ref.paperTitle}
                            </span>
                            <span className={`truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              {ref.sectionTitle || '未分类'}{ref.pageNumber ? ` p.${ref.pageNumber}` : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : globalLoading ? (
                <div className={`flex items-center justify-center py-8 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  <span className="animate-spin mr-2">&#9203;</span> 正在搜索所有论文...
                </div>
              ) : (
                <div className={`text-center py-8 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  <p className="text-sm">在所有已处理的论文中搜索答案</p>
                  <p className="text-xs mt-1">AI 将综合多篇论文内容给出回答</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
