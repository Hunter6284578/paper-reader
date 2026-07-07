import type { AiSettings, DocumentBlock, PageImage, StructureSection, TranslationResult } from '../types';

function normalizeApiBase(value: string): string {
  const base = value.trim().replace(/\/+$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
}

export function getApiBase(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  const stored = localStorage.getItem('serverUrl');
  // Prefer build-time env URL when it's a real server (not localhost dev)
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('10.0.2.2')) {
    return normalizeApiBase(envUrl);
  }
  return normalizeApiBase(stored || envUrl || 'http://localhost:3000');
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

function notifyExpiredSession(): void {
  clearToken();
  window.dispatchEvent(new Event('paper-reader:auth-expired'));
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${getApiBase()}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (response.status === 401 && path !== '/auth/pair') notifyExpiredSession();
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: '请求失败' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (e: any) {
    if (e.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接');
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
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

export async function authorizedFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (response.status === 401) notifyExpiredSession();
  return response;
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

export async function saveReadingPosition(paperId: string, blockIndex: number) {
  return api.post(`/reading/${paperId}/position`, { blockIndex });
}

export async function getReadingPosition(paperId: string) {
  return api.get<{ position: { blockIndex: number; savedAt: string } | null }>(`/reading/${paperId}/position`);
}

// ============================================================
// 全局跨论文问答 (Global Search)
// ============================================================

export interface GlobalSearchCallbacks {
  onChunk: (text: string) => void;
  onDone: (data: { references: Array<{ index: number; chunkId: number; blockId: number | null; sectionTitle: string | null; pageNumber: number | null; bbox: number[] | null; score: number; paperId: string; paperTitle: string }> }) => void;
  onError: (error: string) => void;
}

export async function askGlobalQuestion(
  question: string,
  callbacks: GlobalSearchCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const token = getToken();
  const response = await fetch(`${getApiBase()}/chat/ask-global`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ question }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '请求失败' }));
    callbacks.onError(error.error || `HTTP ${response.status}`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError('无法读取响应流');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '') {
        currentEvent = '';
        continue;
      }

      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.slice(6).trim();
        continue;
      }

      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();

        if (currentEvent === 'chunk') {
          callbacks.onChunk(data);
        } else if (currentEvent === 'done') {
          try {
            callbacks.onDone(JSON.parse(data));
          } catch {
            // ignore parse errors on done event
          }
        } else if (currentEvent === 'error') {
          try {
            const parsed = JSON.parse(data);
            callbacks.onError(parsed.error || '未知错误');
          } catch {
            callbacks.onError(data);
          }
        }
      }
    }
  }
}

// ============================================================
// 阅读统计 API
// ============================================================

export async function saveReadingSession(paperId: string, durationSeconds: number, blocksRead: number) {
  return api.post(`/reading/${paperId}/session`, { durationSeconds, blocksRead });
}

export async function getReadingStats(paperId: string) {
  return api.get<{ totalReadingTime: number; sessionCount: number; blocksRead: number; averageSessionTime: number }>(`/reading/${paperId}/stats`);
}
