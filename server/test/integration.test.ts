import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'paper-reader-test-'));
process.env.NODE_ENV = 'production';
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dataDir, 'app.db');
process.env.PAPERS_DIR = join(dataDir, 'papers');
process.env.UPLOADS_DIR = join(dataDir, 'uploads');
process.env.MIGRATIONS_DIR = resolve('src/db/migrations');
process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
process.env.SETTINGS_ENCRYPTION_KEY = 'test-settings-secret-with-at-least-32-characters';
process.env.DEVICE_PAIRING_CODE = '246810';
process.env.MAX_UPLOAD_BYTES = '16';

const { app } = await import('../src/app.js');
const { sqlite } = await import('../src/db/connection.js');
const { fuseResults } = await import('../src/services/vectorSearch.js');

after(() => {
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('fresh database is migrated and health is public', async () => {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  assert.ok(tables.some(({ name }) => name === 'papers'));
  assert.ok(tables.some(({ name }) => name === '__drizzle_migrations'));
  const response = await app.request('/api/health');
  assert.equal(response.status, 200);
});

test('protected resources reject an unpaired device', async () => {
  const response = await app.request('/api/papers');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: '设备尚未配对' });
  assert.equal((await app.request('/api/dev/reprocess/unknown', { method: 'POST' })).status, 404);
});

test('pairing creates a revocable device token', async () => {
  const wrong = await app.request('/api/auth/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'bad' }),
  });
  assert.equal(wrong.status, 401);

  const paired = await app.request('/api/auth/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '246810', deviceName: 'Test device' }),
  });
  assert.equal(paired.status, 200);
  const { token, device } = await paired.json() as { token: string; device: { id: string } };
  const authorization = { Authorization: `Bearer ${token}` };

  assert.equal((await app.request('/api/papers', { headers: authorization })).status, 200);
  const devices = await app.request('/api/auth/devices', { headers: authorization });
  assert.equal(devices.status, 200);
  assert.equal(((await devices.json()) as { devices: unknown[] }).devices.length, 1);

  const tooLarge = new FormData();
  tooLarge.set('file', new File(['%PDF-' + 'x'.repeat(20)], 'large.pdf', { type: 'application/pdf' }));
  assert.equal((await app.request('/api/papers/upload', { method: 'POST', headers: authorization, body: tooLarge })).status, 413);

  const invalid = new FormData();
  invalid.set('file', new File(['not-pdf'], 'fake.pdf', { type: 'application/pdf' }));
  assert.equal((await app.request('/api/papers/upload', { method: 'POST', headers: authorization, body: invalid })).status, 400);

  const revoke = await app.request(`/api/auth/devices/${device.id}`, { method: 'DELETE', headers: authorization });
  assert.equal(revoke.status, 200);
  assert.equal((await app.request('/api/papers', { headers: authorization })).status, 401);
});

test('retrieval fusion rewards blocks found by both adapters', () => {
  const base = (chunkId: number, score: number) => ({
    chunkId, score, content: `chunk-${chunkId}`, sectionTitle: null, pageNumber: null,
    blockId: null, bbox: null, paperId: 'paper', paperTitle: 'Paper',
  });
  const results = fuseResults([base(1, 10), base(2, 9)], [base(2, 0.9), base(3, 0.8)], 3);
  assert.equal(results[0].chunkId, 2);
  assert.deepEqual(new Set(results.map(({ chunkId }) => chunkId)), new Set([1, 2, 3]));
});

test('pairing endpoint is rate limited', async () => {
  let limited = false;
  for (let index = 0; index < 6; index++) {
    const response = await app.request('/api/auth/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'wrong' }),
    });
    if (response.status === 429) limited = true;
  }
  assert.equal(limited, true);
});
