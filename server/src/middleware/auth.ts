import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { SignJWT, jwtVerify } from 'jose';
import { createHash, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { ENV } from '../config.js';
import { db, sqlite } from '../db/connection.js';
import { deviceTokens } from '../db/schema.js';

const secret = new TextEncoder().encode(ENV.JWT_SECRET);

export interface DevicePrincipal {
  deviceId: string;
  label: string;
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function signDeviceToken(deviceId: string, label: string): Promise<string> {
  return new SignJWT({ deviceId, label, tokenType: 'device' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setJti(deviceId)
    .setExpirationTime(ENV.DEVICE_TOKEN_EXPIRES_IN)
    .sign(secret);
}

function tokenHashesMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export const authMiddleware = createMiddleware<{
  Variables: { device: DevicePrincipal };
}>(async (c, next) => {
  // 本地开发若未配置配对码，保持开箱即用；生产环境必须携带设备令牌。
  if (ENV.NODE_ENV !== 'production' && !ENV.DEVICE_PAIRING_CODE) {
    c.set('device', { deviceId: 'development', label: 'Development device' });
    return next();
  }

  const authorization = c.req.header('Authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) throw new HTTPException(401, { message: '设备尚未配对' });

  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
  try {
    ({ payload } = await jwtVerify(token, secret));
  } catch {
    throw new HTTPException(401, { message: '设备令牌无效或已过期' });
  }

  if (payload.tokenType !== 'device' || typeof payload.deviceId !== 'string' || typeof payload.label !== 'string') {
    throw new HTTPException(401, { message: '设备令牌格式无效' });
  }

  const record = db.select().from(deviceTokens).where(eq(deviceTokens.id, payload.deviceId)).get();
  if (!record || record.revoked || !tokenHashesMatch(hashDeviceToken(token), record.tokenHash)) {
    throw new HTTPException(401, { message: '设备令牌已撤销或无效' });
  }

  sqlite.prepare(`
    UPDATE device_tokens SET last_seen_at = datetime('now')
    WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-1 hour'))
  `).run(record.id);
  c.set('device', { deviceId: record.id, label: record.label });
  await next();
});
