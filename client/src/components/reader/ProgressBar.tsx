import { useReaderStore } from '../../stores/readerStore';

export default function ProgressBar() {
  const currentParagraphIndex = useReaderStore((s) => s.currentParagraphIndex);
  const totalParagraphs = useReaderStore((s) => s.totalParagraphs);
  const settings = useReaderStore((s) => s.settings);

  if (totalParagraphs === 0) return null;

  const progress = Math.min(100, Math.round((currentParagraphIndex / totalParagraphs) * 100));

  const barBg = settings.theme === 'dark' ? 'bg-gray-700' : 'bg-gray-200';
  const barFg = settings.theme === 'dark' ? 'bg-indigo-400' : 'bg-primary-500';

  return (
    <div className="reader-progress-bar fixed bottom-0 left-0 right-0 z-40">
      <div className={`h-1 ${barBg}`}>
        <div
          className={`h-full ${barFg} transition-all duration-300`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
