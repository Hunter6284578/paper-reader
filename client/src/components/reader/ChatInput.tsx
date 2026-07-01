import { useCallback, useState } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('');

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue('');
    onSend(text);
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-3 border-t border-gray-100 safe-area-bottom">
      <div className="flex gap-2 items-end">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题..."
          disabled={disabled}
          rows={1}
          className="input-field text-sm flex-1 resize-none overflow-hidden max-h-32 leading-5 py-2"
          style={{ height: 'auto', minHeight: '36px' }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 128) + 'px';
          }}
        />
        <button
          onClick={handleSend}
          className="btn-primary text-sm px-3 h-9 shrink-0"
          disabled={disabled || !value.trim()}
        >
          发送
        </button>
      </div>
    </div>
  );
}
