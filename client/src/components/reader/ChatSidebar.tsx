import { useEffect } from 'react';
import { useChatStore } from '../../stores/chatStore';
import ChatMessageList from './ChatMessageList';
import ChatInput from './ChatInput';

interface ChatSidebarProps {
  paperId: string;
  onClose: () => void;
}

export default function ChatSidebar({ paperId, onClose }: ChatSidebarProps) {
  const { messages, streamContent, isStreaming, fetchHistory, sendMessage, clearHistory } = useChatStore();

  useEffect(() => {
    fetchHistory(paperId);
  }, [paperId]);

  const handleSend = async (text: string) => {
    try {
      await sendMessage(paperId, text);
    } catch (e: any) {
      alert(e.message || 'AI 问答失败');
    }
  };

  const handleClear = async () => {
    if (messages.length === 0) return;
    if (confirm('确定清空对话记录？')) {
      await clearHistory(paperId);
    }
  };

  return (
    <div className="w-full lg:w-96 border-l border-gray-200 bg-white flex flex-col shrink-0">
      <div className="p-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-medium text-sm text-gray-900">AI 论文伴读</h3>
        <div className="flex items-center gap-2">
          <button onClick={handleClear} className="text-gray-400 hover:text-gray-600 text-xs px-2 py-1">清空</button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
        </div>
      </div>
      <ChatMessageList
        messages={messages}
        streamContent={streamContent}
        isStreaming={isStreaming}
        onAsk={handleSend}
      />
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
