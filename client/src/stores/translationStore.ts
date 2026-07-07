import { create } from 'zustand';
import { translateBlocks } from '../services/api';
import { getCachedJson, getOfflineTranslations, putCachedJson } from '../services/offlineDb';

interface TranslationState {
  cache: Record<string, Record<number, string>>;
  translating: Set<number>;
  fetchBlockTranslations: (paperId: string, blockIds: number[]) => Promise<void>;
  getBlockTranslation: (paperId: string, blockId: number) => string | null;
  isTranslating: (id: number) => boolean;
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  cache: {},
  translating: new Set(),

  fetchBlockTranslations: async (paperId, blockIds) => {
    const [legacyCache, offlineCache] = await Promise.all([
      getCachedJson<Record<number, string>>(`translations:${paperId}`),
      getOfflineTranslations(paperId).catch(() => ({})),
    ]);
    if (legacyCache || Object.keys(offlineCache).length > 0) {
      set((state) => ({
        cache: {
          ...state.cache,
          [paperId]: { ...(state.cache[paperId] || {}), ...(legacyCache || {}), ...offlineCache },
        },
      }));
    }

    const state = get();
    const paperCache = state.cache[paperId] || {};
    const uncached = blockIds.filter((id) => !paperCache[id] && !state.translating.has(id));
    if (!uncached.length) return;
    set((current) => ({ translating: new Set([...current.translating, ...uncached]) }));

    try {
      const response = await translateBlocks(paperId, uncached);
      set((current) => {
        const nextPaper = { ...(current.cache[paperId] || {}) };
        response.translations.forEach((item) => { nextPaper[item.sourceId] = item.translatedText; });
        void putCachedJson(`translations:${paperId}`, nextPaper);
        const translating = new Set(current.translating);
        uncached.forEach((id) => translating.delete(id));
        return { cache: { ...current.cache, [paperId]: nextPaper }, translating };
      });
    } catch (error) {
      console.warn('[翻译] 当前离线或服务不可用，将使用本地缓存', error);
      set((current) => {
        const translating = new Set(current.translating);
        uncached.forEach((id) => translating.delete(id));
        return { translating };
      });
    }
  },

  getBlockTranslation: (paperId, blockId) => get().cache[paperId]?.[blockId] || null,
  isTranslating: (id) => get().translating.has(id),
}));
