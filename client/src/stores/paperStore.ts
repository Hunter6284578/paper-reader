import { create } from 'zustand';
import type { Paper, Highlight } from '../types';
import { api } from '../services/api';

interface PaperState {
  papers: Paper[];
  currentPaper: Paper | null;
  highlights: Highlight[];
  isLoading: boolean;
  error: string | null;
  fetchPapers: () => Promise<void>;
  fetchPaper: (id: string) => Promise<void>;
  uploadPaper: (file: File, title?: string) => Promise<Paper>;
  deletePaper: (id: string) => Promise<void>;
  updatePaper: (id: string, data: Partial<Paper>) => Promise<void>;
  fetchHighlights: (paperId: string) => Promise<void>;
  addHighlight: (data: Omit<Highlight, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Highlight>;
  deleteHighlight: (id: string) => Promise<void>;
}

export const usePaperStore = create<PaperState>((set, get) => ({
  papers: [],
  currentPaper: null,
  highlights: [],
  isLoading: false,
  error: null,

  fetchPapers: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<{ papers: Paper[] }>('/papers');
      set({ papers: res.papers, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  fetchPaper: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const paper = await api.get<Paper>(`/papers/${id}`);
      set({ currentPaper: paper, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  uploadPaper: async (file, title) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);

    const paper = await api.post<Paper>('/papers/upload', formData);
    set((state) => ({ papers: [paper, ...state.papers] }));
    return paper;
  },

  deletePaper: async (id) => {
    await api.delete(`/papers/${id}`);
    set((state) => ({
      papers: state.papers.filter((p) => p.id !== id),
      currentPaper: state.currentPaper?.id === id ? null : state.currentPaper,
    }));
  },

  updatePaper: async (id, data) => {
    const updated = await api.patch<Paper>(`/papers/${id}`, data);
    set((state) => ({
      papers: state.papers.map((p) => (p.id === id ? updated : p)),
      currentPaper: state.currentPaper?.id === id ? updated : state.currentPaper,
    }));
  },

  fetchHighlights: async (paperId) => {
    const res = await api.get<{ highlights: Highlight[] }>(`/highlights/paper/${paperId}`);
    set({ highlights: res.highlights });
  },

  addHighlight: async (data) => {
    const highlight = await api.post<Highlight>('/highlights', data);
    set((state) => ({ highlights: [...state.highlights, highlight] }));
    return highlight;
  },

  deleteHighlight: async (id) => {
    await api.delete(`/highlights/${id}`);
    set((state) => ({
      highlights: state.highlights.filter((h) => h.id !== id),
    }));
  },
}));
