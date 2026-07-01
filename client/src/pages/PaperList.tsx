import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePaperStore } from '../stores/paperStore';
import { useVocabStore } from '../stores/vocabStore';
import StudyCalendar from '../components/vocab/StudyCalendar';
import ProgressRing from '../components/vocab/ProgressRing';

export default function PaperList() {
  const { papers, isLoading, fetchPapers, uploadPaper, deletePaper } = usePaperStore();
  const { stats, fetchStats, studyCalendar, fetchStudyCalendar, dailyGoal, fetchSettings } = useVocabStore();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchPapers();
    fetchStats();
    fetchStudyCalendar();
    fetchSettings();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadPaper(file);
    } catch (err: any) {
      alert(err.message || '上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (confirm(`确定删除论文"${title}"？`)) {
      await deletePaper(id);
    }
  };

  const getStatusBadge = (status: string, processingStatus: string) => {
    if (processingStatus === 'processing') return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">处理中</span>;
    if (processingStatus === 'error') return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">处理失败</span>;
    if (processingStatus === 'unsupported_scan') return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">扫描件不支持</span>;
    const labels: Record<string, string> = { unread: '未读', reading: '在读', finished: '已读' };
    const colors: Record<string, string> = { unread: 'bg-gray-100 text-gray-600', reading: 'bg-blue-100 text-blue-700', finished: 'bg-green-100 text-green-700' };
    return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || 'bg-gray-100'}`}>{labels[status] || status}</span>;
  };

  const todayNew = studyCalendar?.todayStats?.newWords || 0;
  const todayReview = studyCalendar?.todayStats?.reviews || 0;
  const todayTotal = todayNew + todayReview;
  const goalProgress = dailyGoal > 0 ? Math.min(100, Math.round((todayTotal / dailyGoal) * 100)) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">论文阅读器</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/settings')} className="text-sm text-gray-600">设置</button>
            <button onClick={() => navigate('/vocab')} className="text-sm text-primary-600 hover:underline">生词本</button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* 学习仪表盘 */}
        <div className="card">
          <div className="flex items-start gap-4">
            {/* 今日进度圆环 */}
            <ProgressRing progress={goalProgress} size={72} strokeWidth={6} color="#4f46e5">
              <div className="text-center">
                <div className="text-lg font-bold text-primary-600">{todayTotal}</div>
                <div className="text-[10px] text-gray-400">/{dailyGoal}</div>
              </div>
            </ProgressRing>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-medium text-gray-900">今日学习</h3>
                {studyCalendar && studyCalendar.streak > 0 && (
                  <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
                    连续 {studyCalendar.streak} 天
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-xl font-bold text-green-600">{todayNew}</div>
                  <div className="text-xs text-gray-400">新学单词</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-blue-600">{todayReview}</div>
                  <div className="text-xs text-gray-400">复习单词</div>
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
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-2">学习打卡</p>
              <StudyCalendar calendar={studyCalendar.calendar} days={56} />
            </div>
          )}
        </div>

        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <div className="card text-center">
              <div className="text-2xl font-bold text-primary-600">{stats.total}</div>
              <div className="text-xs text-gray-500 mt-1">总生词</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-green-600">{stats.mastered}</div>
              <div className="text-xs text-gray-500 mt-1">已掌握</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-purple-600">{stats.recentReviews}</div>
              <div className="text-xs text-gray-500 mt-1">7天复习</div>
            </div>
          </div>
        )}

        {/* 上传按钮 */}
        <div className="flex items-center gap-3">
          <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleUpload} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary flex items-center gap-2"
            disabled={uploading}
          >
            {uploading ? <><span className="animate-spin">⏳</span> 上传中...</> : <>+ 上传论文</>}
          </button>
          <span className="text-sm text-gray-500">支持 PDF 格式</span>
        </div>

        {/* 论文列表 */}
        <div className="space-y-3">
          {isLoading && papers.length === 0 && <div className="text-center py-12 text-gray-500">加载中...</div>}
          {!isLoading && papers.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg mb-2">暂无论文</p>
              <p className="text-sm">点击上方按钮上传你的第一篇论文</p>
            </div>
          )}
          {papers.map((paper) => (
            <div
              key={paper.id}
              className="card hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/paper/${paper.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 truncate">{paper.title}</h3>
                  <div className="flex items-center gap-2 mt-2">
                    {getStatusBadge(paper.status, paper.processingStatus)}
                    {paper.pageCount && <span className="text-xs text-gray-400">{paper.pageCount} 页</span>}
                    <span className="text-xs text-gray-400">{new Date(paper.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                  {paper.abstract && <p className="text-sm text-gray-500 mt-2 line-clamp-2">{paper.abstract}</p>}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(paper.id, paper.title); }}
                  className="text-gray-400 hover:text-red-500 p-1 ml-2"
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
    </div>
  );
}
