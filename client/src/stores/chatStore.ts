import { create } from 'zustand';
import type { ChatMessage, ChatReference } from '../types';
import { api, authorizedFetch } from '../services/api';

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamContent: string;
  currentReferences: ChatReference[];
  fetchHistory: (paperId: string) => Promise<void>;
  sendMessage: (paperId: string, question: string) => Promise<void>;
  clearHistory: (paperId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamContent: '',
  currentReferences: [],

  fetchHistory: async (paperId) => {
    try {
      const res = await api.get<{ messages: ChatMessage[] }>(`/chat/history/${paperId}`);
      set({ messages: res.messages });
    } catch (e) {
      console.error('获取聊天历史失败:', e);
    }
  },

  sendMessage: async (paperId, question) => {
    set({ isStreaming: true, streamContent: '', currentReferences: [] });

    // 添加用户消息到列表
    const userMsg: ChatMessage = {
      id: Date.now(),
      paperId,
      role: 'user',
      content: question,
      references: [],
      createdAt: new Date().toISOString(),
    };
    set((state) => ({ messages: [...state.messages, userMsg] }));

    const response = await authorizedFetch('/chat/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paperId, question }),
    });

    if (!response.ok) {
      let msg = `请求失败 (${response.status})`;
      try {
        const error = await response.json();
        if (error.error) msg = error.error;
      } catch { /* use default msg */ }
      set({ isStreaming: false });
      throw new Error(msg);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      set({ isStreaming: false });
      return;
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let references: ChatReference[] = [];
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;
          let eventType = 'chunk';
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              data += line.slice(5);
            }
          }

          if (eventType === 'error') {
            set({ isStreaming: false });
            try {
              const parsed = JSON.parse(data);
              throw new Error(parsed.error || 'AI 服务异常');
            } catch (err: any) {
              throw new Error(err.message || 'AI 服务异常');
            }
          } else if (eventType === 'done') {
            try {
              const parsed = JSON.parse(data);
              if (parsed.references) references = parsed.references;
            } catch { /* ignore */ }
          } else {
            fullContent += data;
            set({ streamContent: fullContent });
          }
        }
      }
    } catch (e: any) {
      set({ isStreaming: false });
      throw e;
    }

    // 添加助手回复到消息列表
    const assistantMsg: ChatMessage = {
      id: Date.now() + 1,
      paperId,
      role: 'assistant',
      content: fullContent,
      references,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, assistantMsg],
      isStreaming: false,
      streamContent: '',
      currentReferences: references,
    }));
  },

  clearHistory: async (paperId) => {
    await api.delete(`/chat/history/${paperId}`);
    set({ messages: [] });
  },
}));
