import type { ChatReference } from '../../types';
import MarkdownText from './MarkdownText';

interface Props {
  content: string;
  references: ChatReference[];
  onNavigate?: () => void;
}

export default function ChatMessageContent({ content, references, onNavigate }: Props) {
  return (
    <MarkdownText
      text={content}
      references={references}
      onCitationClick={() => onNavigate?.()}
    />
  );
}
