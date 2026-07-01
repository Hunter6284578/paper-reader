import { useNavigate } from 'react-router-dom';
import { useReaderStore } from '../../stores/readerStore';

interface ReaderBottomBarProps {
  showChat: boolean;
  onToggleChat: () => void;
}

export default function ReaderBottomBar({ showChat, onToggleChat }: ReaderBottomBarProps) {
  const navigate = useNavigate();
  const settings = useReaderStore((s) => s.settings);
  const updateSettings = useReaderStore((s) => s.updateSettings);
  const toggleSettings = useReaderStore((s) => s.toggleSettings);
  const isDark = settings.theme === 'dark';
  const isSepia = settings.theme === 'sepia';

  const bgClass = isDark
    ? 'bg-gray-800/95 border-gray-700'
    : isSepia
    ? 'bg-[#f5f0e8]/95 border-[#d6cfc0]'
    : 'bg-white/95 border-gray-200';

  const textClass = isDark ? 'text-gray-200' : 'text-gray-700';
  const mutedClass = isDark ? 'text-gray-400' : 'text-gray-500';

  const handleDec = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateSettings({ fontSize: Math.max(14, settings.fontSize - 1) });
  };
  const handleInc = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateSettings({ fontSize: Math.min(24, settings.fontSize + 1) });
  };
  const handleSpacing = (e: React.MouseEvent) => {
    e.stopPropagation();
    const steps = [1.4, 1.6, 1.75, 2.0, 2.2];
    const idx = steps.indexOf(settings.lineHeight);
    const next = steps[(idx + 1) % steps.length];
    updateSettings({ lineHeight: next });
  };
  const handleBack = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate('/');
  };
  const handleMore = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSettings();
  };
  const handleChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleChat();
  };

  return (
    <div
      className={`backdrop-blur-sm border-t px-4 py-3 ${bgClass}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 max-w-xl mx-auto">
        {/* 返回按钮 */}
        <button onClick={handleBack} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${textClass} active:opacity-70`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
          </svg>
          返回
        </button>

        {/* 字号 A- */}
        <button onClick={handleDec} className={`w-10 h-10 flex items-center justify-center rounded-lg text-lg font-bold ${textClass} active:opacity-70`}>
          A<span className="text-xs ml-0.5">-</span>
        </button>

        {/* 当前字号 */}
        <span className={`text-sm font-mono ${mutedClass} min-w-[32px] text-center`}>{settings.fontSize}</span>

        {/* 字号 A+ */}
        <button onClick={handleInc} className={`w-10 h-10 flex items-center justify-center rounded-lg text-xl font-bold ${textClass} active:opacity-70`}>
          A<span className="text-xs ml-0.5">+</span>
        </button>

        {/* 行间距 */}
        <button onClick={handleSpacing} className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm ${textClass} active:opacity-70`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>
          </svg>
          {settings.lineHeight.toFixed(1)}
        </button>

        {/* AI 问答 */}
        <button
          onClick={handleChat}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            showChat
              ? 'bg-blue-600 text-white'
              : isDark
              ? 'bg-gray-700 text-gray-200 active:bg-gray-600'
              : 'bg-gray-100 text-gray-700 active:bg-gray-200'
          }`}
        >
          AI
        </button>

        {/* 更多设置 */}
        <button onClick={handleMore} className={`w-10 h-10 flex items-center justify-center rounded-lg ${textClass} active:opacity-70`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
