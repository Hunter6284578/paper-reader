import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { randomUUID, timingSafeEqual } from 'crypto';
import { db } from '../db/connection.js';
import { deviceTokens } from '../db/schema.js';
import { authMiddleware, hashDeviceToken, signDeviceToken } from '../middleware/auth.js';
import { ENV } from '../config.js';
import { clientAddress, rateLimit } from '../middleware/rateLimit.js';

const auth = new Hono();
const pairRateLimit = rateLimit({ windowMs: 15 * 60_000, max: 5, key: clientAddress });

const pairSchema = z.object({
  code: z.string().min(1).max(256),
  deviceName: z.string().trim().min(1).max(80).optional(),
});

auth.post('/pair', pairRateLimit, zValidator('json', pairSchema), async (c) => {
  const { code, deviceName } = c.req.valid('json');
  if (!ENV.DEVICE_PAIRING_CODE) {
    if (ENV.NODE_ENV === 'production') return c.json({ error: '服务器未配置设备配对码' }, 503);
  } else {
    const supplied = Buffer.from(code);
    const expected = Buffer.from(ENV.DEVICE_PAIRING_CODE);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return c.json({ error: '配对码错误' }, 401);
    }
  }

  const id = randomUUID();
  const label = deviceName || 'Paper Reader device';
  const token = await signDeviceToken(id, label);
  db.insert(deviceTokens).values({ id, label, tokenHash: hashDeviceToken(token) }).run();
  return c.json({ token, device: { id, label } });
});

auth.get('/devices', authMiddleware, (c) => {
  const currentId = c.get('device').deviceId;
  const devices = db.select({
    id: deviceTokens.id,
    label: deviceTokens.label,
    revoked: deviceTokens.revoked,
    createdAt: deviceTokens.createdAt,
    lastSeenAt: deviceTokens.lastSeenAt,
  }).from(deviceTokens).all();
  return c.json({ devices: devices.map((device) => ({ ...device, current: device.id === currentId })) });
});

auth.delete('/devices/:id', authMiddleware, (c) => {
  const id = c.req.param('id');
  const existing = db.select().from(deviceTokens).where(eq(deviceTokens.id, id)).get();
  if (!existing) return c.json({ error: '设备不存在' }, 404);
  db.update(deviceTokens).set({ revoked: true }).where(eq(deviceTokens.id, id)).run();
  return c.json({ success: true, revokedCurrentDevice: c.get('device').deviceId === id });
});

export { auth };
