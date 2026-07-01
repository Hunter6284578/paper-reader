import { create } from 'zustand';
import type { VocabItem, VocabStats, ReviewGrade, StudyCalendarData } from '../types';
import { api } from '../services/api';
import { queueOfflineAction } from '../services/offlineDb';

interface VocabState {
  vocabItems: VocabItem[];
  reviewItems: VocabItem[];
  learnItems: VocabItem[];
  stats: VocabStats | null;
  studyCalendar: StudyCalendarData | null;
  dailyGoal: number;
  isLoading: boolean;
  error: string | null;
  fetchVocabList: () => Promise<void>;
  fetchReviewToday: () => Promise<void>;
  fetchLearnBatch: (size?: number) => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchStudyCalendar: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  setDailyGoal: (n: number) => Promise<void>;
  markAsLearned: (vocabId: number) => Promise<void>;
  addVocab: (word: string, context?: string, paperId?: string, pageNumber?: number | null, blockId?: number | null) => Promise<VocabItem>;
  submitReview: (vocabId: number, grade: ReviewGrade) => Promise<void>;
  deleteVocab: (id: number) => Promise<void>;
}

export const useVocabStore = create<VocabState>((set, get) => ({
  vocabItems: [],
  reviewItems: [],
  learnItems: [],
  stats: null,
  studyCalendar: null,
  dailyGoal: 20,
  isLoading: false,
  error: null,

  fetchVocabList: async () => {
    set({ isLoading: true });
    try {
      const res = await api.get<{ vocabItems: VocabItem[] }>('/vocab');
      set({ vocabItems: res.vocabItems, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  fetchReviewToday: async () => {
    set({ isLoading: true });
    try {
      const res = await api.get<{ reviewItems: VocabItem[] }>('/vocab/review/today');
      set({ reviewItems: res.reviewItems, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  fetchLearnBatch: async (size = 10) => {
    set({ isLoading: true });
    try {
      const res = await api.get<{ items: VocabItem[] }>(`/vocab/learn/batch?size=${size}`);
      set({ learnItems: res.items, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  fetchStats: async () => {
    try {
      const res = await api.get<{ stats: VocabStats }>('/vocab/stats');
      set({ stats: res.stats });
    } catch (e) {
      console.error('获取统计失败:', e);
    }
  },

  fetchStudyCalendar: async () => {
    try {
      const res = await api.get<StudyCalendarData>('/vocab/study-calendar');
      set({ studyCalendar: res });
    } catch (e) {
      console.error('获取打卡日历失败:', e);
    }
  },

  fetchSettings: async () => {
    try {
      const res = await api.get<{ dailyGoal: number }>('/vocab/settings');
      set({ dailyGoal: res.dailyGoal });
    } catch (e) {
      console.error('获取设置失败:', e);
    }
  },

  setDailyGoal: async (n) => {
    try {
      await api.put('/vocab/settings', { dailyGoal: n });
      set({ dailyGoal: n });
    } catch (e: any) {
      console.error('设置每日目标失败:', e);
    }
  },

  markAsLearned: async (vocabId) => {
    try {
      await api.post(`/vocab/learn/${vocabId}`, {});
      set((state) => ({
        learnItems: state.learnItems.map((v) =>
          v.id === vocabId ? { ...v, learnedAt: new Date().toISOString() } : v
        ),
      }));
    } catch (e: any) {
      console.error('标记学习失败:', e);
    }
  },

  addVocab: async (word, context, paperId, pageNumber, blockId) => {
    const payload = {
      word,
      sentence: context,
      contextSentence: context,
      sourcePaperId: paperId,
      pageNumber: pageNumber ?? undefined,
      blockId: blockId ?? undefined,
    };
    try {
      const res = await api.post<{ vocabItem: VocabItem; addedContext?: boolean }>('/vocab/add', payload);
      const item = res.vocabItem;
      set((state) => {
        const existing = state.vocabItems.findIndex((v) => v.id === item.id);
        if (existing >= 0) {
          const updated = [...state.vocabItems];
          updated[existing] = item;
          return { vocabItems: updated };
        }
        return { vocabItems: [item, ...state.vocabItems] };
      });
      return item;
    } catch (e: any) {
      console.warn('[生词] 离线收藏生词:', e.message);
      await queueOfflineAction('add_vocab', {
        ...payload,
        addedAt: new Date().toISOString(),
      });
      const localItem: VocabItem = {
        id: -Date.now(),
        word: word.toLowerCase().trim(),
        phonetic: null,
        audioUrl: null,
        partOfSpeech: null,
        definitionEn: null,
        definitionCn: null,
        exampleSentence: null,
        sourcePaperId: paperId || null,
        contextSentence: context || null,
        learnedAt: null,
        wordRoots: null,
        mnemonic: null,
        repetitions: 0,
        intervalDays: 0,
        easeFactor: 2.5,
        dueDate: new Date().toISOString(),
        lastReviewAt: null,
        totalReviews: 0,
        correctReviews: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
        contexts: context ? [{
          id: -1,
          vocabId: -Date.now(),
          paperId: paperId || null,
          paperTitle: null,
          sentence: context,
          pageNumber: pageNumber ?? null,
          blockId: blockId ?? null,
          createdAt: new Date().toISOString(),
        }] : [],
      };
      set((state) => ({ vocabItems: [localItem, ...state.vocabItems] }));
      return localItem;
    }
  },

  submitReview: async (vocabId, grade) => {
    const res = await api.post<{ vocabItem: VocabItem }>(`/vocab/review/${vocabId}`, { grade });
    set((state) => ({
      reviewItems: state.reviewItems.filter((v) => v.id !== vocabId),
      vocabItems: state.vocabItems.map((v) => (v.id === vocabId ? res.vocabItem : v)),
    }));
  },

  deleteVocab: async (id) => {
    await api.delete(`/vocab/${id}`);
    set((state) => ({
      vocabItems: state.vocabItems.filter((v) => v.id !== id),
    }));
  },
}));
