// ============================================================
// 通用类型
// ============================================================

export interface User {
  id: number;
  username: string;
  displayName: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ============================================================
// 论文
// ============================================================

export interface Paper {
  id: string;
  title: string;
  filePath: string;
  fileSize: number | null;
  pageCount: number | null;
  abstract: string | null;
  authors: string[];
  tags: string[];
  status: 'unread' | 'reading' | 'finished';
  processingStatus: 'pending' | 'processing' | 'ready' | 'error' | 'unsupported_scan';
  paragraphStatus: 'pending' | 'processing' | 'ready' | 'error';
  processingError?: string | null;
  contentVersion?: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// 高亮/批注
// ============================================================

export interface HighlightPosition {
  boundingRect: Rect;
  rects: Rect[];
  pageNumber: number;
}

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
  pageNumber: number;
}

export interface Highlight {
  id: string;
  paperId: string;
  pageNumber: number | null;
  paragraphId: number | null;
  position: HighlightPosition;
  type: 'highlight' | 'area' | 'note';
  color: string;
  comment: string | null;
  selectedText: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// 生词本
// ============================================================

export interface VocabItem {
  id: number;
  word: string;
  phonetic: string | null;
  audioUrl: string | null;
  partOfSpeech: string | null;
  definitionEn: string | null;
  definitionCn: string | null;
  exampleSentence: string | null;
  sourcePaperId: string | null;
  contextSentence: string | null;
  learnedAt: string | null;
  wordRoots: string | null;
  mnemonic: string | null;
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  dueDate: string;
  lastReviewAt: string | null;
  totalReviews: number;
  correctReviews: number;
  status: 'active' | 'suspended' | 'mastered';
  createdAt: string;
  contexts?: VocabContext[];
}

export interface VocabContext {
  id: number;
  vocabId: number;
  paperId: string | null;
  paperTitle: string | null;
  sentence: string;
  pageNumber: number | null;
  blockId: number | null;
  createdAt: string;
}

export type ReviewGrade = 'forgot' | 'hard' | 'good' | 'easy';

export interface VocabStats {
  total: number;
  active: number;
  mastered: number;
  dueToday: number;
  recentReviews: number;
}

export interface StudyDay {
  date: string;
  newWordsCount: number;
  reviewCount: number;
}

export interface StudyCalendarData {
  calendar: StudyDay[];
  streak: number;
  todayStats: { newWords: number; reviews: number };
}

// ============================================================
// AI 聊天
// ============================================================

export interface ChatMessage {
  id: number;
  paperId: string;
  role: 'user' | 'assistant';
  content: string;
  references: ChatReference[];
  createdAt: string;
}

export interface ChatReference {
  index: number;
  chunkId: number;
  sectionTitle: string | null;
  score: number;
  blockId?: number | null;
  pageNumber?: number | null;
  bbox?: number[] | null;
}

// ============================================================
// 沉浸式阅读
// ============================================================

export interface Sentence {
  id: number;
  sentenceIndex: number;
  content: string;
}

export interface Paragraph {
  id: number;
  sectionTitle: string | null;
  paragraphIndex: number;
  content: string;
  processedContent: string | null;
  charCount: number;
  sentences: Sentence[];
  translation: string | null;
  sentenceTranslations: Record<number, string>;
}

export interface StructureSection {
  sectionTitle: string;
  paragraphCount: number;
  startIndex: number;
}

export interface TranslationResult {
  sourceId: number;
  sourceType: 'paragraph' | 'sentence' | 'block';
  originalText: string;
  translatedText: string;
}

export type DocumentBlockType = 'section' | 'text' | 'caption' | 'figure' | 'table' | 'algorithm' | 'formula';

export interface DocumentBlock {
  id: number;
  blockIndex: number;
  type: DocumentBlockType;
  sectionTitle: string | null;
  content: string | null;
  processedContent: string | null;
  pageNumber: number | null;
  bbox: number[] | null;
  assetUrl: string | null;
  caption: string | null;
  translation: string | null;
}

export interface AiSettings {
  configured: boolean;
  keyHint: string;
  model: string;
}

export interface PageImage {
  pageNumber: number;
  imageUrl: string;
  width: number | null;
  height: number | null;
  fileSize: number | null;
}

export type ReaderTheme = 'light' | 'sepia' | 'dark';

export interface ReaderSettings {
  theme: ReaderTheme;
  fontSize: number;
  lineHeight: number;
  translationMode: 'paragraph' | 'sentence';
  showTranslation: boolean;
  translationCollapsed: boolean;
}
