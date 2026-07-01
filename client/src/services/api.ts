import type { AiSettings, DocumentBlock, PageImage, Paragraph, StructureSection, TranslationResult } from '../types';

function normalizeApiBase(value: string): string {
  const base = value.trim().replace(/\/+$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
}

export function getApiBase(): string {
  return normalizeApiBase(localStorage.getItem('serverUrl') || import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000');
}

export function setServerUrl(url: string): void {
  localStorage.setItem('serverUrl', url.trim().replace(/\/+$/, ''));
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const base = getApiBase();
  if (path.startsWith('/api/')) return `${base.replace(/\/api$/, '')}${path}`;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

function getToken(): string | null {
  return localStorage.getItem('token');
}

export function setToken(token: string): void {
  localStorage.setItem('token', token);
}

export function clearToken(): void {
  localStorage.removeItem('token');
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 不自动设置 Content-Type，让浏览器处理 multipart/form-data
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
};

// ============================================================
// 阅读 API
// ============================================================

export async function fetchStructure(paperId: string) {
  return api.get<{
    sections: StructureSection[];
    totalParagraphs: number;
    paragraphStatus: string;
  }>(`/reading/${paperId}/structure`);
}

export async function fetchParagraphs(paperId: string, offset: number, limit: number = 20) {
  return api.get<{
    paragraphs: Paragraph[];
    total: number;
    offset: number;
    limit: number;
  }>(`/reading/${paperId}/paragraphs?offset=${offset}&limit=${limit}`);
}

export async function translateParagraphs(paperId: string, ids: number[], mode: 'paragraph' | 'sentence' = 'paragraph') {
  return api.post<{ translations: TranslationResult[] }>(`/reading/${paperId}/translate`, { ids, mode });
}

export function authorizedFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  return fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export async function fetchPageImages(paperId: string) {
  return api.get<{ images: PageImage[] }>(`/images/${paperId}`);
}

export async function fetchBlocks(paperId: string, offset: number, limit = 30) {
  return api.get<{ blocks: DocumentBlock[]; total: number; offset: number; limit: number }>(
    `/reading/${paperId}/blocks?offset=${offset}&limit=${limit}`,
  );
}

export async function translateBlocks(paperId: string, ids: number[]) {
  return api.post<{ translations: TranslationResult[] }>(`/reading/${paperId}/translate`, { ids, mode: 'block' });
}

export async function getAiSettings() {
  return api.get<AiSettings>('/settings/ai');
}

export async function saveAiSettings(apiKey: string | undefined, model: string) {
  return request<AiSettings>('/settings/ai', { method: 'PUT', body: JSON.stringify({ apiKey, model }) });
}
