import type { StructureSection } from '../../types';
import { useReaderStore } from '../../stores/readerStore';

interface TableOfContentsProps {
  sections: StructureSection[];
  onJump: (paragraphIndex: number) => void;
  onClose: () => void;
}

export default function TableOfContents({ sections, onJump, onClose }: TableOfContentsProps) {
  const settings = useReaderStore((s) => s.settings);
  const isDark = settings.theme === 'dark';

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className={`fixed left-0 top-0 bottom-0 z-50 w-72 shadow-2xl overflow-auto ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
        <div className={`p-4 border-b flex items-center justify-between ${isDark ? 'border-gray-700' : 'border-gray-100'}`}>
          <h3 className={`font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>目录</h3>
          <button onClick={onClose} className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-400'}`}>✕</button>
        </div>
        <div className="p-2">
          {sections.map((section, i) => (
            <button
              key={i}
              onClick={() => {
                onJump(section.startIndex);
                onClose();
              }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors mb-0.5 ${
                isDark
                  ? 'text-gray-300 hover:bg-gray-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="font-medium truncate">{section.sectionTitle}</div>
              <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {section.paragraphCount} 段
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
