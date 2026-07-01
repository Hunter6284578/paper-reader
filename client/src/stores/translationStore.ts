import { create } from 'zustand';
import { translateParagraphs as apiTranslate } from '../services/api';
import { translateBlocks as apiTranslateBlocks } from '../services/api';
import { getCachedJson, putCachedJson, getOfflineTranslations } from '../services/offlineDb';
import type { TranslationResult } from '../types';

interface TranslationState {
  // paperId → paragraphId → translatedText
  cache: Record<string, Record<number, string>>;
  // 正在翻译中的 ID 集合
  translating: Set<number>;
  // 句子翻译缓存
  sentenceCache: Record<string, Record<number, string>>;

  fetchTranslations: (paperId: string, paragraphIds: number[]) => Promise<void>;
  fetchSentenceTranslations: (paperId: string, sentenceIds: number[]) => Promise<void>;
  fetchBlockTranslations: (paperId: string, blockIds: number[]) => Promise<void>;
  getParagraphTranslation: (paperId: string, paraId: number) => string | null;
  getSentenceTranslation: (paperId: string, sentId: number) => string | null;
  isTranslating: (id: number) => boolean;
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  cache: {},
  translating: new Set(),
  sentenceCache: {},

  fetchTranslations: async (paperId, paragraphIds) => {
    const state = get();
    const paperCache = state.cache[paperId] || {};

    // 过滤已有缓存和正在翻译的
    const uncached = paragraphIds.filter(
      (id) => !paperCache[id] && !state.translating.has(id)
    );

    if (uncached.length === 0) return;

    // 标记为翻译中
    set((s) => {
      const newTranslating = new Set(s.translating);
      uncached.forEach((id) => newTranslating.add(id));
      return { translating: newTranslating };
    });

    try {
      const res = await apiTranslate(paperId, uncached, 'paragraph');

      set((s) => {
        const newCache = { ...s.cache };
        if (!newCache[paperId]) newCache[paperId] = {};
        for (const t of res.translations) {
          newCache[paperId][t.sourceId] = t.translatedText;
        }
        const newTranslating = new Set(s.translating);
        uncached.forEach((id) => newTranslating.delete(id));
        return { cache: newCache, translating: newTranslating };
      });
    } catch (e) {
      console.error('[翻译Store] 翻译失败:', e);
      set((s) => {
        const newTranslating = new Set(s.translating);
        uncached.forEach((id) => newTranslating.delete(id));
        return { translating: newTranslating };
      });
    }
  },

  fetchBlockTranslations: async (paperId, blockIds) => {
    const cachedOffline = await getCachedJson<Record<number, string>>(`translations:${paperId}`);
    if (cachedOffline) {
      set((state) => ({ cache: { ...state.cache, [paperId]: { ...(state.cache[paperId] || {}), ...cachedOffline } } }));
    }

    // Also try structured offline translations
    try {
      const offlineTranslations = await getOfflineTranslations(paperId);
      if (Object.keys(offlineTranslations).length > 0) {
        set((state) => ({ cache: { ...state.cache, [paperId]: { ...(state.cache[paperId] || {}), ...offlineTranslations } } }));
      }
    } catch {
      // Ignore offline translation load errors
    }

    const state = get();
    const paperCache = state.cache[paperId] || {};
    const uncached = blockIds.filter((id) => !paperCache[id] && !state.translating.has(id));
    if (!uncached.length) return;
    set((s) => ({ translating: new Set([...s.translating, ...uncached]) }));
    try {
      const res = await apiTranslateBlocks(paperId, uncached);
      set((s) => {
        const nextPaper = { ...(s.cache[paperId] || {}) };
        res.translations.forEach((item) => { nextPaper[item.sourceId] = item.translatedText; });
        void putCachedJson(`translations:${paperId}`, nextPaper);
        const translating = new Set(s.translating);
        uncached.forEach((id) => translating.delete(id));
        return { cache: { ...s.cache, [paperId]: nextPaper }, translating };
      });
    } catch (error) {
      console.warn('[翻译] 当前离线或服务不可用，将使用本地缓存', error);
      // Try loading from structured offline as last resort
      try {
        const offlineTranslations = await getOfflineTranslations(paperId);
        if (Object.keys(offlineTranslations).length > 0) {
          set((s) => {
            const nextPaper = { ...(s.cache[paperId] || {}), ...offlineTranslations };
            return { cache: { ...s.cache, [paperId]: nextPaper } };
          });
        }
      } catch {
        // Ignore
      }
      set((s) => {
        const translating = new Set(s.translating);
        uncached.forEach((id) => translating.delete(id));
        return { translating };
      });
    }
  },

  fetchSentenceTranslations: async (paperId, sentenceIds) => {
    const state = get();
    const sentCache = state.sentenceCache[paperId] || {};

    const uncached = sentenceIds.filter(
      (id) => !sentCache[id] && !state.translating.has(id)
    );

    if (uncached.length === 0) return;

    set((s) => {
      const newTranslating = new Set(s.translating);
      uncached.forEach((id) => newTranslating.add(id));
      return { translating: newTranslating };
    });

    try {
      const res = await apiTranslate(paperId, uncached, 'sentence');

      set((s) => {
        const newCache = { ...s.sentenceCache };
        if (!newCache[paperId]) newCache[paperId] = {};
        for (const t of res.translations) {
          newCache[paperId][t.sourceId] = t.translatedText;
        }
        const newTranslating = new Set(s.translating);
        uncached.forEach((id) => newTranslating.delete(id));
        return { sentenceCache: newCache, translating: newTranslating };
      });
    } catch (e) {
      console.error('[翻译Store] 句子翻译失败:', e);
      set((s) => {
        const newTranslating = new Set(s.translating);
        uncached.forEach((id) => newTranslating.delete(id));
        return { translating: newTranslating };
      });
    }
  },

  getParagraphTranslation: (paperId, paraId) => {
    return get().cache[paperId]?.[paraId] || null;
  },

  getSentenceTranslation: (paperId, sentId) => {
    return get().sentenceCache[paperId]?.[sentId] || null;
  },

  isTranslating: (id) => {
    return get().translating.has(id);
  },
}));
