import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerDateKey } from '../src/services/ownerClock.js';

test('ownerDateKey uses the configured owner timezone across UTC midnight', () => {
  assert.equal(ownerDateKey(new Date('2026-07-06T16:30:00.000Z'), 'Asia/Shanghai'), '2026-07-07');
  assert.equal(ownerDateKey(new Date('2026-07-06T15:30:00.000Z'), 'Asia/Shanghai'), '2026-07-06');
});
