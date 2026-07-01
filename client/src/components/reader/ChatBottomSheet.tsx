import { useEffect } from 'react';
import { useChatStore } from '../../stores/chatStore';
import ChatMessageList from './ChatMessageList';
import ChatInput from './ChatInput';

interface ChatBottomSheetProps {
  paperId: string;
  onClose: () => void;
}

export default function ChatBottomSheet({ paperId, onClose }: ChatBottomSheetProps) {
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
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 h-[65vh] bg-white rounded-t-2xl shadow-2xl flex flex-col">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>
        <div className="px-4 pb-2 flex items-center justify-between border-b border-gray-100">
          <h3 className="font-medium text-sm text-gray-900">AI 论文伴读</h3>
          <div className="flex items-center gap-2">
            <button onClick={handleClear} className="text-gray-400 hover:text-gray-600 text-xs px-2 py-1">清空</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm px-2 py-1">✕</button>
          </div>
        </div>
        <ChatMessageList
          messages={messages}
          streamContent={streamContent}
          isStreaming={isStreaming}
          onNavigate={onClose}
          onAsk={handleSend}
        />
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>
    </>
  );
}
