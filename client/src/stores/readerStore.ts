import { create } from 'zustand';
import type { ReaderSettings } from '../types';

const STORAGE_KEY = 'reader-settings';

const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  fontSize: 17,
  lineHeight: 1.75,
  translationMode: 'paragraph',
  showTranslation: true,
  translationCollapsed: false,
};

function loadSettings(): ReaderSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

interface ReaderState {
  settings: ReaderSettings;
  currentParagraphIndex: number;
  totalParagraphs: number;
  showSettings: boolean;
  showToc: boolean;
  updateSettings: (patch: Partial<ReaderSettings>) => void;
  setCurrentParagraph: (index: number) => void;
  setTotalParagraphs: (total: number) => void;
  toggleSettings: () => void;
  toggleToc: () => void;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  settings: loadSettings(),
  currentParagraphIndex: 0,
  totalParagraphs: 0,
  showSettings: false,
  showToc: false,

  updateSettings: (patch) => {
    const updated = { ...get().settings, ...patch };
    saveSettings(updated);
    set({ settings: updated });
  },

  setCurrentParagraph: (index) => set({ currentParagraphIndex: index }),
  setTotalParagraphs: (total) => set({ totalParagraphs: total }),
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  toggleToc: () => set((s) => ({ showToc: !s.showToc })),
}));
