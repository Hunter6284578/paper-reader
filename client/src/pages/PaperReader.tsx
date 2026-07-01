import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePaperStore } from '../stores/paperStore';
import { useVocabStore } from '../stores/vocabStore';
import { useReaderStore } from '../stores/readerStore';
import { useTextSelection } from '../hooks/useTextSelection';
import { useStatusBar } from '../hooks/useStatusBar';
import type { StructureSection } from '../types';

import ReaderHeader from '../components/reader/ReaderHeader';
import ReadingArea from '../components/reader/ReadingArea';
import ProgressBar from '../components/reader/ProgressBar';
import SettingsPanel from '../components/reader/SettingsPanel';
import TableOfContents from '../components/reader/TableOfContents';
import FloatingToolbar from '../components/reader/FloatingToolbar';
import ChatSidebar from '../components/reader/ChatSidebar';
import ChatBottomSheet from '../components/reader/ChatBottomSheet';
import ReaderBottomBar from '../components/reader/ReaderBottomBar';

export default function PaperReader() {
  const { id } = useParams<{ id: string }>();
  const { currentPaper, highlights, fetchPaper, fetchHighlights, addHighlight, updatePaper } = usePaperStore();
  const { addVocab } = useVocabStore();
  const settings = useReaderStore((s) => s.settings);
  const showToc = useReaderStore((s) => s.showToc);
  const toggleToc = useReaderStore((s) => s.toggleToc);

  const [showChat, setShowChat] = useState(false);
  const [sections, setSections] = useState<StructureSection[]>([]);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const scrollMovedRef = useRef(false);
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const { selection, clearSelection } = useTextSelection(containerRef);

  // 状态栏适配（Android）
  useStatusBar();

  // 响应式检测
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    setIsDesktop(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // 加载论文数据
  useEffect(() => {
    if (id) {
      fetchPaper(id);
      fetchHighlights(id);
    }
  }, [id]);

  // 标记为在读
  useEffect(() => {
    if (currentPaper && currentPaper.status === 'unread') {
      updatePaper(currentPaper.id, { status: 'reading' });
    }
  }, [currentPaper]);

  // 触摸开始 — 记录位置
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    scrollMovedRef.current = false;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, []);

  // 触摸移动 — 标记为滚动
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      scrollMovedRef.current = true;
    }
  }, []);

  // 点击阅读区域切换菜单
  const handleTapContent = useCallback(() => {
    // 如果有选中文本或本次是滚动手势，不切换菜单
    if (selection) return;
    if (scrollMovedRef.current) return;
    setChromeVisible((prev) => {
      const next = !prev;
      // 显示时 6 秒后自动隐藏
      if (next && chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
      if (next) {
        chromeTimerRef.current = setTimeout(() => setChromeVisible(false), 6000);
      }
      return next;
    });
  }, [selection]);

  // 隐藏 chrome（选中文字时）
  useEffect(() => {
    if (selection) {
      setChromeVisible(false);
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    }
  }, [selection]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    };
  }, []);

  // 处理高亮
  const handleHighlight = useCallback(async (color: string) => {
    if (!id || !selection) return;
    await addHighlight({
      paperId: id,
      pageNumber: null,
      paragraphId: selection.paragraphId,
      position: {
        mode: 'text',
        paragraphId: selection.paragraphId,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
      } as any,
      type: 'highlight',
      color,
      comment: null,
      selectedText: selection.text,
    });
    clearSelection();
  }, [id, selection, addHighlight, clearSelection]);

  // 收藏生词
  const handleAddVocab = useCallback(async () => {
    if (!selection) return;
    const word = selection.text.split(/\s+/)[0].replace(/[^a-zA-Z]/g, '');
    if (!word) return;
    try {
      await addVocab(word, selection.fullSentence, id, selection.pageNumber, selection.blockId);
      alert(`已收藏单词: ${word}`);
    } catch (e: any) {
      alert(e.message || '收藏失败');
    }
    clearSelection();
  }, [selection, id, addVocab, clearSelection]);

  // 目录跳转
  const handleJump = useCallback((paragraphIndex: number) => {
    const container = containerRef.current;
    if (container && (container as any).__jumpToParagraph) {
      (container as any).__jumpToParagraph(paragraphIndex);
    }
  }, []);

  if (!currentPaper) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  const isDark = settings.theme === 'dark';
  const isSepia = settings.theme === 'sepia';

  const bgClass = isDark
    ? 'bg-gray-900 text-gray-100'
    : isSepia
    ? 'bg-[#f5f0e8] text-[#3d3529]'
    : 'bg-white text-gray-900';

  return (
    <div className={`h-screen flex flex-col transition-colors relative ${bgClass}`} data-reader-theme={settings.theme}>

      {/* 阅读区域 — 占满全屏 */}
      <div
        className="flex-1 flex overflow-hidden"
        onClick={handleTapContent}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        <ReadingArea
          paperId={currentPaper.id}
          highlights={highlights}
          containerRef={containerRef}
          onSectionsLoaded={setSections}
        />

        {/* AI 问答 — 桌面端侧边栏 */}
        {isDesktop && showChat && (
          <ChatSidebar paperId={currentPaper.id} onClose={() => setShowChat(false)} />
        )}
      </div>

      {/* 进度条 — 始终可见 */}
      <ProgressBar />

      {/* ===== 覆盖式顶栏 ===== */}
      <div
        className={`absolute top-0 left-0 right-0 z-40 transition-transform duration-250 ease-out ${
          chromeVisible ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <ReaderHeader
          title={currentPaper.title}
          isDesktop={isDesktop}
          showChat={showChat}
          onToggleChat={() => setShowChat(!showChat)}
          processingStatus={currentPaper.processingStatus}
        />
      </div>

      {/* ===== 覆盖式底部工具栏 ===== */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-40 transition-transform duration-250 ease-out ${
          chromeVisible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <ReaderBottomBar showChat={showChat} onToggleChat={() => setShowChat(!showChat)} />
      </div>

      {/* 浮动工具栏 */}
      {selection && (
        <FloatingToolbar
          selectedText={selection.text}
          rect={selection.rect}
          onHighlight={handleHighlight}
          onAddVocab={handleAddVocab}
          onClose={clearSelection}
        />
      )}

      {/* 设置面板 */}
      <SettingsPanel />

      {/* 目录 */}
      {showToc && (
        <TableOfContents
          sections={sections}
          onJump={handleJump}
          onClose={toggleToc}
        />
      )}

      {/* AI 问答 — 移动端底部弹窗 */}
      {!isDesktop && showChat && (
        <ChatBottomSheet paperId={currentPaper.id} onClose={() => setShowChat(false)} />
      )}
    </div>
  );
}
