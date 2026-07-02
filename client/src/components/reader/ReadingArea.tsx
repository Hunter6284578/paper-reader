import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentBlock, Highlight, StructureSection } from '../../types';
import { fetchBlocks, fetchStructure, saveReadingPosition, getReadingPosition, saveReadingSession } from '../../services/api';
import { getCachedJson, putCachedJson, getOfflineBlocks, syncOfflineData, onOnlineChange, isOnline } from '../../services/offlineDb';
import { useReaderStore } from '../../stores/readerStore';
import { useTranslationStore } from '../../stores/translationStore';
import DocumentBlockView from './DocumentBlockView';
import PageImageViewer from './PageImageViewer';

interface Props {
  paperId: string;
  highlights: Highlight[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  onSectionsLoaded: (sections: StructureSection[]) => void;
}

const PAGE_SIZE = 30;
const TRANSLATE_AHEAD = 8;

export default function ReadingArea({ paperId, highlights, containerRef, onSectionsLoaded }: Props) {
  const settings = useReaderStore((state) => state.settings);
  const setTotalParagraphs = useReaderStore((state) => state.setTotalParagraphs);
  const setCurrentParagraph = useReaderStore((state) => state.setCurrentParagraph);
  const fetchBlockTranslations = useTranslationStore((state) => state.fetchBlockTranslations);
  const [blocks, setBlocks] = useState<DocumentBlock[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewMode, setViewMode] = useState<'text' | 'pages'>('text');
  const [pageTarget, setPageTarget] = useState<{ pageNumber: number; bbox: number[] | null } | null>(null);
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const lastSavedIndexRef = useRef(-1);
  const restoredRef = useRef(false);
  const currentIndexRef = useRef(0);
  const blocksReadCountRef = useRef(0);

  const cache = useCallback((next: DocumentBlock[], nextTotal: number) => {
    void putCachedJson(`blocks:${paperId}`, { blocks: next, total: nextTotal });
  }, [paperId]);

  // Auto-sync offline data when coming back online
  useEffect(() => {
    const unsubscribe = onOnlineChange((online) => {
      if (online) {
        console.log('[阅读] 恢复在线，开始同步离线数据...');
        syncOfflineData().then(({ synced, failed }) => {
          if (synced > 0) console.log(`[同步] 成功同步 ${synced} 条数据`);
          if (failed > 0) console.warn(`[同步] ${failed} 条数据同步失败`);
        }).catch((e) => console.error('[同步] 同步出错:', e));
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBlocks([]);
    offsetRef.current = 0;
    (async () => {
      // Try legacy cache first for instant display
      const cached = await getCachedJson<{ blocks: DocumentBlock[]; total: number }>(`blocks:${paperId}`);
      if (cached && !cancelled) {
        setBlocks(cached.blocks);
        setTotal(cached.total);
        offsetRef.current = cached.blocks.length;
        setLoading(false);
      }
      try {
        const [structure, first] = await Promise.all([fetchStructure(paperId), fetchBlocks(paperId, 0, PAGE_SIZE)]);
        if (cancelled) return;
        onSectionsLoaded(structure.sections);
        setTotal(first.total);
        setTotalParagraphs(first.total);
        setBlocks(first.blocks);
        offsetRef.current = first.blocks.length;
        cache(first.blocks, first.total);
        if (settings.showTranslation) {
          void fetchBlockTranslations(paperId, first.blocks.filter((block) => block.type === 'text' && !block.translation).slice(0, TRANSLATE_AHEAD).map((block) => block.id));
        }
      } catch (error) {
        // API failed — try structured offline blocks
        console.warn('[阅读] API 请求失败，尝试离线数据:', error);
        const offlineBlocks = await getOfflineBlocks(paperId);
        if (offlineBlocks && offlineBlocks.length > 0 && !cancelled) {
          const firstPage = offlineBlocks.slice(0, PAGE_SIZE);
          setBlocks(firstPage);
          setTotal(offlineBlocks.length);
          offsetRef.current = firstPage.length;
          cache(firstPage, offlineBlocks.length);

          // Build sections from offline blocks
          const sections: StructureSection[] = [];
          let currentTitle = '';
          for (const block of offlineBlocks) {
            const title = block.sectionTitle || 'Full Text';
            if (title !== currentTitle) {
              sections.push({ sectionTitle: title, paragraphCount: 0, startIndex: block.blockIndex });
              currentTitle = title;
            }
            if (block.type === 'text') sections[sections.length - 1].paragraphCount++;
          }
          onSectionsLoaded(sections);
        } else if (!cached) {
          console.error('[阅读] 无网络且没有离线缓存', error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [paperId]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || offsetRef.current >= total) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const result = await fetchBlocks(paperId, offsetRef.current, PAGE_SIZE);
      setBlocks((current) => {
        const next = [...current, ...result.blocks.filter((block) => !current.some((item) => item.id === block.id))];
        cache(next, result.total);
        return next;
      });
      offsetRef.current += result.blocks.length;
      if (settings.showTranslation) {
        void fetchBlockTranslations(paperId, result.blocks.filter((block) => block.type === 'text' && !block.translation).slice(0, TRANSLATE_AHEAD).map((block) => block.id));
      }
    } catch (error) {
      // Offline: try loading more from structured offline blocks
      console.warn('[阅读] 离线状态下尝试加载更多离线内容', error);
      const offlineBlocks = await getOfflineBlocks(paperId);
      if (offlineBlocks) {
        setBlocks((current) => {
          const remaining = offlineBlocks.filter((block) => !current.some((item) => item.id === block.id));
          const nextPage = remaining.slice(0, PAGE_SIZE);
          if (nextPage.length > 0) {
            const next = [...current, ...nextPage];
            offsetRef.current += nextPage.length;
            cache(next, offlineBlocks.length);
            return next;
          }
          return current;
        });
      }
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [paperId, total, settings.showTranslation, fetchBlockTranslations, cache]);

  const handleVisible = useCallback((index: number, id: number) => {
    setCurrentParagraph(index);
    currentIndexRef.current = index;
    blocksReadCountRef.current += 1;
    if (total - index <= 8) void loadMore();
    if (settings.showTranslation) {
      const candidates = blocks.filter((block) => block.type === 'text' && block.blockIndex >= index && block.blockIndex <= index + TRANSLATE_AHEAD).map((block) => block.id);
      if (!candidates.includes(id)) candidates.unshift(id);
      void fetchBlockTranslations(paperId, candidates);
    }
  }, [blocks, total, loadMore, settings.showTranslation, paperId, fetchBlockTranslations, setCurrentParagraph]);

  // Auto-load: fill viewport + scroll-position-based trigger
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Auto-fill when content doesn't overflow
    if (!loading && !loadingMore && viewMode === 'text' && offsetRef.current < total) {
      const timer = setTimeout(() => {
        if (el.scrollHeight <= el.clientHeight + 50 && offsetRef.current < total) {
          void loadMore();
        }
      }, 400);
    }

    // Scroll-position-based loadMore: triggers when user is near bottom
    const onScroll = () => {
      if (loadingRef.current || offsetRef.current >= total || viewMode !== 'text') return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distFromBottom < 300) {
        void loadMore();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); };
  }, [loading, loadingMore, blocks.length, total, viewMode, loadMore, containerRef]);

  const openOriginal = useCallback((pageNumber: number, bbox: number[] | null) => {
    setPageTarget({ pageNumber, bbox });
    setViewMode('pages');
  }, []);

  const jumpToIndex = useCallback(async (index: number) => {
    let target = blocks.find((block) => block.blockIndex === index);
    if (!target) {
      // Try online first, then offline
      if (isOnline()) {
        const result = await fetchBlocks(paperId, index, PAGE_SIZE);
        setBlocks(result.blocks);
        offsetRef.current = index + result.blocks.length;
        target = result.blocks[0];
      } else {
        const offlineBlocks = await getOfflineBlocks(paperId);
        if (offlineBlocks) {
          target = offlineBlocks.find((b) => b.blockIndex === index);
        }
      }
    }
    setViewMode('text');
    setTimeout(() => containerRef.current?.querySelector(`[data-block-id="${target?.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [blocks, paperId, containerRef]);

  useEffect(() => {
    if (containerRef.current) (containerRef.current as HTMLDivElement & { __jumpToParagraph?: (index: number) => void }).__jumpToParagraph = jumpToIndex;
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ blockId?: number; pageNumber?: number; bbox?: number[] | null }>).detail;
      const block = detail.blockId ? blocks.find((item) => item.id === detail.blockId) : null;
      if (block) {
        setViewMode('text');
        setTimeout(() => {
          const el = containerRef.current?.querySelector(`[data-block-id="${block.id}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('chat-citation-highlight');
            setTimeout(() => el.classList.remove('chat-citation-highlight'), 2500);
          }
        }, 50);
      } else if (detail.pageNumber) openOriginal(detail.pageNumber, detail.bbox || null);
    };
    window.addEventListener('reader:navigate', navigate);
    return () => window.removeEventListener('reader:navigate', navigate);
  }, [blocks, containerRef, jumpToIndex, openOriginal]);

  // Fetch saved reading position on mount and restore after blocks load
  useEffect(() => {
    let cancelled = false;
    restoredRef.current = false;
    (async () => {
      try {
        const { position } = await getReadingPosition(paperId);
        if (cancelled || !position) return;
        lastSavedIndexRef.current = position.blockIndex;
        // Wait for blocks to be available, then scroll
        const restoreScroll = () => {
          if (restoredRef.current) return;
          const target = document.querySelector(`[data-block-index="${position.blockIndex}"]`);
          if (target) {
            restoredRef.current = true;
            target.scrollIntoView({ behavior: 'auto', block: 'start' });
          }
        };
        // Try immediately, then retry as blocks load
        restoreScroll();
        const timer = setInterval(() => {
          restoreScroll();
          if (restoredRef.current) clearInterval(timer);
        }, 300);
        setTimeout(() => clearInterval(timer), 5000);
      } catch {
        // Ignore errors - position restore is best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [paperId]);

  // Auto-save reading position every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const idx = currentIndexRef.current;
      if (idx > 0 && idx !== lastSavedIndexRef.current) {
        lastSavedIndexRef.current = idx;
        void saveReadingPosition(paperId, idx);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [paperId]);

  // Track reading session time and save on unmount / paperId change
  useEffect(() => {
    const startTime = Date.now();
    blocksReadCountRef.current = 0;
    return () => {
      const duration = (Date.now() - startTime) / 1000;
      if (duration > 5) {
        saveReadingSession(paperId, duration, blocksReadCountRef.current).catch(() => {});
      }
    };
  }, [paperId]);

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-500">正在准备重排阅读内容…</div>;
  if (!blocks.length) return <div className="flex-1 flex items-center justify-center px-8 text-center text-gray-500">暂无可阅读内容。论文可能仍在处理，或属于暂不支持的扫描版 PDF。</div>;

  return (
    <div className="flex-1 overflow-auto scroll-container" ref={containerRef as React.RefObject<HTMLDivElement>}>
      <div className="sticky top-0 z-10 flex justify-center py-2 bg-inherit/90 backdrop-blur">
        <button className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-600" onClick={() => setViewMode((mode) => mode === 'text' ? 'pages' : 'text')}>
          {viewMode === 'text' ? '📄 查看原页' : '📝 重排阅读'}
        </button>
      </div>
      {viewMode === 'pages' ? (
        <PageImageViewer paperId={paperId} target={pageTarget} />
      ) : (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-20" style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}>
          {blocks.map((block) => <DocumentBlockView key={block.id} block={block} highlights={highlights} onVisible={handleVisible} onOpenOriginal={openOriginal} />)}
          {loadingMore && <div className="py-6 text-center text-sm text-gray-400">加载更多…</div>}
          {offsetRef.current >= total && <div className="py-10 text-center text-sm text-gray-400">— 全文结束 —</div>}
        </div>
      )}
    </div>
  );
}
