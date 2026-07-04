import { beforeAll, expect, test, vi } from 'vitest';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();
let offlineDb: typeof import('./offlineDb');

beforeAll(async () => {
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
  storage.setItem('offline:actions', JSON.stringify([
    { id: 'legacy-1', type: 'add_vocab', payload: { word: 'paper' }, createdAt: new Date().toISOString() },
  ]));
  offlineDb = await import('./offlineDb');
});

test('legacy web queues migrate into the unified outbox', async () => {
  await offlineDb.initOfflineDb();
  const outbox = JSON.parse(storage.getItem('offline:outbox') || '[]') as Array<{ id: string }>;
  expect(outbox.map(({ id }) => id)).toContain('legacy-1');
  expect(storage.getItem('offline:actions')).toBeNull();
});

test('outbox is idempotent and successful sync removes items', async () => {
  await offlineDb.queueOfflineAction('add_vocab', { word: 'reader' }, 'new-1');
  await offlineDb.queueOfflineAction('add_vocab', { word: 'reader' }, 'new-1');
  const before = JSON.parse(storage.getItem('offline:outbox') || '[]') as Array<{ id: string }>;
  expect(before.filter(({ id }) => id === 'new-1')).toHaveLength(1);

  const result = await offlineDb.syncOfflineData();
  expect(result).toEqual({ synced: 2, failed: 0 });
  expect(JSON.parse(storage.getItem('offline:outbox') || '[]')).toEqual([]);
});
