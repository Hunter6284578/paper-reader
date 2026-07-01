import type { ChatReference } from '../../types';

interface Props {
  reference: ChatReference;
  onNavigate?: () => void;
}

export default function ReferenceBadge({ reference, onNavigate }: Props) {
  const handleClick = () => {
    window.dispatchEvent(
      new CustomEvent('reader:navigate', {
        detail: {
          blockId: reference.blockId,
          pageNumber: reference.pageNumber,
          bbox: reference.bbox,
        },
      })
    );
    onNavigate?.();
  };

  const sectionShort = reference.sectionTitle
    ? reference.sectionTitle.length > 15
      ? reference.sectionTitle.slice(0, 15) + '…'
      : reference.sectionTitle
    : '';

  return (
    <button
      onClick={handleClick}
      title={`${reference.sectionTitle || ''}${reference.pageNumber ? ` · 第${reference.pageNumber}页` : ''}`}
      className="text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded cursor-pointer hover:bg-primary-200 active:bg-primary-300 transition-colors"
    >
      [{reference.index}]{reference.pageNumber ? ` p.${reference.pageNumber}` : ''}{sectionShort ? ` ${sectionShort}` : ''}
    </button>
  );
}
