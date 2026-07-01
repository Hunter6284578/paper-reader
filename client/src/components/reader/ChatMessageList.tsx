import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../types';
import ChatMessageContent from './ChatMessageContent';
import ReferenceBadge from './ReferenceBadge';

const SUGGESTED_QUESTIONS = [
  '这篇论文的主要贡献是什么？',
  '论文使用了什么方法？',
  '实验结果如何？',
  '总结论文的核心创新点',
];

interface Props {
  messages: ChatMessage[];
  streamContent: string;
  isStreaming: boolean;
  onNavigate?: () => void;
  onAsk?: (question: string) => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  return (
    <button
      onClick={handleCopy}
      className="text-xs text-gray-400 hover:text-gray-600 mt-1 transition-colors"
      title="复制"
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

export default function ChatMessageList({ messages, streamContent, isStreaming, onNavigate, onAsk }: Props) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className="flex-1 overflow-auto p-3 space-y-3 scroll-container">
      {isEmpty && (
        <div className="py-6 space-y-3">
          <p className="text-center text-gray-400 text-sm">向 AI 提问关于这篇论文的问题</p>
          <div className="flex flex-wrap gap-2 justify-center px-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => onAsk?.(q)}
                className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full hover:bg-gray-200 active:bg-gray-300 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`text-sm ${
            msg.role === 'user'
              ? 'bg-primary-50 text-primary-900 rounded-lg p-3 ml-4'
              : 'bg-gray-50 text-gray-800 rounded-lg p-3 mr-4'
          }`}
        >
          {msg.role === 'user' ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <>
              <ChatMessageContent content={msg.content} references={msg.references} onNavigate={onNavigate} />
              <div className="flex items-center gap-2 mt-1">
                <CopyButton text={msg.content} />
              </div>
            </>
          )}
          {msg.references.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {msg.references.map((ref) => (
                <ReferenceBadge key={ref.index} reference={ref} onNavigate={onNavigate} />
              ))}
            </div>
          )}
        </div>
      ))}

      {isStreaming && (
        <div className="bg-gray-50 rounded-lg p-3 mr-4">
          {streamContent ? (
            <>
              <ChatMessageContent content={streamContent} references={[]} />
              <span className="inline-block w-1.5 h-4 bg-primary-400 animate-pulse ml-0.5 align-text-bottom" />
            </>
          ) : (
            <p className="text-sm text-gray-400">思考中...</p>
          )}
        </div>
      )}
      <div ref={chatEndRef} />
    </div>
  );
}
