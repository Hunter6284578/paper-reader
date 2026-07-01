import { useNavigate } from 'react-router-dom';
import { useReaderStore } from '../../stores/readerStore';

interface ReaderHeaderProps {
  title: string;
  isDesktop: boolean;
  showChat: boolean;
  onToggleChat: () => void;
  processingStatus: string;
}

export default function ReaderHeader({
  title,
  isDesktop,
  showChat,
  onToggleChat,
  processingStatus,
}: ReaderHeaderProps) {
  const navigate = useNavigate();
  const settings = useReaderStore((s) => s.settings);
  const toggleSettings = useReaderStore((s) => s.toggleSettings);
  const toggleToc = useReaderStore((s) => s.toggleToc);
  const isDark = settings.theme === 'dark';

  const bgClass = isDark
    ? 'bg-gray-800/95 border-gray-700'
    : 'bg-white/95 backdrop-blur-sm border-gray-200';
  const textClass = isDark ? 'text-gray-200' : 'text-gray-700';
  const titleClass = isDark ? 'text-gray-100' : 'text-gray-900';

  return (
    <header
      className={`px-4 py-2.5 flex items-center gap-3 border-b shadow-md ${bgClass}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => navigate('/')}
        className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium active:opacity-70 ${textClass}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
        返回
      </button>

      <button
        onClick={toggleToc}
        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg active:opacity-70 ${textClass}`}
        title="目录"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h18"/><path d="M3 6h18"/><path d="M3 18h12"/></svg>
      </button>

      <h2 className={`font-medium truncate flex-1 text-sm ${titleClass}`}>
        {title}
      </h2>

      {processingStatus === 'processing' && (
        <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded shrink-0">
          处理中...
        </span>
      )}
      {processingStatus === 'unsupported_scan' && (
        <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded shrink-0">
          扫描件不支持
        </span>
      )}

      <button
        onClick={toggleSettings}
        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg active:opacity-70 ${textClass}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); onToggleChat(); }}
        className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          showChat
            ? 'bg-blue-600 text-white'
            : isDark
            ? 'bg-gray-700 text-gray-200 active:bg-gray-600'
            : 'bg-gray-100 text-gray-700 active:bg-gray-200'
        }`}
      >
        {isDesktop ? 'AI 问答' : 'AI'}
      </button>
    </header>
  );
}
