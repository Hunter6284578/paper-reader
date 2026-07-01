import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { signToken } from '../middleware/auth.js';
import { signDeviceToken } from '../middleware/auth.js';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ENV } from '../config.js';

const auth = new Hono();

const pairSchema = z.object({ code: z.string().min(1), deviceName: z.string().max(80).optional() });

auth.post('/pair', zValidator('json', pairSchema), async (c) => {
  const { code } = c.req.valid('json');
  if (!ENV.DEVICE_PAIRING_CODE) {
    if (ENV.NODE_ENV === 'production') return c.json({ error: '服务器未配置设备配对码' }, 503);
  } else {
    const supplied = Buffer.from(code);
    const expected = Buffer.from(ENV.DEVICE_PAIRING_CODE);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return c.json({ error: '配对码错误' }, 401);
    }
  }
  const token = await signDeviceToken();
  return c.json({ token, user: { id: 1, username: 'paired-device', displayName: '我的设备' } });
});

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(password + salt).digest('hex');
}

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6),
  displayName: z.string().optional(),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

// 注册
auth.post('/register', zValidator('json', registerSchema), async (c) => {
  const { username, password, displayName } = c.req.valid('json');

  const existing = db.select().from(users).where(eq(users.username, username)).get();
  if (existing) {
    return c.json({ error: '用户名已存在' }, 409);
  }

  const salt = randomBytes(16).toString('hex');
  const passwordHash = `${salt}:${hashPassword(password, salt)}`;

  const result = db.insert(users).values({
    username,
    passwordHash,
    displayName: displayName || username,
  }).returning({ id: users.id, username: users.username }).get();

  const token = await signToken({ userId: result.id, username: result.username });

  return c.json({
    token,
    user: { id: result.id, username: result.username, displayName: displayName || username },
  }, 201);
});

// 登录
auth.post('/login', zValidator('json', loginSchema), async (c) => {
  const { username, password } = c.req.valid('json');

  const user = db.select().from(users).where(eq(users.username, username)).get();
  if (!user) {
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  const [salt, hash] = user.passwordHash.split(':');
  if (hashPassword(password, salt) !== hash) {
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  const token = await signToken({ userId: user.id, username: user.username });

  return c.json({
    token,
    user: { id: user.id, username: user.username, displayName: user.displayName },
  });
});

export { auth };
