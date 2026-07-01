interface FloatingToolbarProps {
  selectedText: string;
  rect: DOMRect | null;
  onHighlight: (color: string) => void;
  onAddVocab: () => void;
  onClose: () => void;
}

export default function FloatingToolbar({
  selectedText,
  rect,
  onHighlight,
  onAddVocab,
  onClose,
}: FloatingToolbarProps) {
  if (!rect || !selectedText) return null;

  // 工具栏放在选区下方，避免被 Android 系统复制栏遮盖
  const left = Math.max(10, Math.min(rect.left + rect.width / 2 - 120, window.innerWidth - 250));
  const top = Math.min(rect.bottom + 10, window.innerHeight - 60);

  return (
    <div
      className="fixed z-50 rounded-xl shadow-xl border border-gray-200 bg-white p-1.5 flex items-center gap-1 animate-in"
      style={{ left, top }}
    >
      <button
        onClick={onAddVocab}
        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors"
        title="收藏生词"
      >
        + 生词
      </button>
      <button
        onClick={() => onHighlight('#FFEB3B')}
        className="w-7 h-7 rounded-full bg-yellow-300 hover:ring-2 hover:ring-yellow-400 transition-all"
        title="黄色高亮"
      />
      <button
        onClick={() => onHighlight('#90CAF9')}
        className="w-7 h-7 rounded-full bg-blue-300 hover:ring-2 hover:ring-blue-400 transition-all"
        title="蓝色高亮"
      />
      <button
        onClick={() => onHighlight('#F48FB1')}
        className="w-7 h-7 rounded-full bg-pink-300 hover:ring-2 hover:ring-pink-400 transition-all"
        title="粉色高亮"
      />
      <div className="w-px h-5 bg-gray-200 mx-1" />
      <button
        onClick={onClose}
        className="w-7 h-7 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-sm transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
