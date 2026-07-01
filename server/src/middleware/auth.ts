import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { SignJWT, jwtVerify } from 'jose';
import { ENV } from '../config.js';

const secret = new TextEncoder().encode(ENV.JWT_SECRET);

export interface JwtPayload {
  userId: number;
  username: string;
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ENV.JWT_EXPIRES_IN)
    .sign(secret);
}

export async function signDeviceToken(): Promise<string> {
  return new SignJWT({ userId: 1, username: 'paired-device', tokenType: 'device' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('365d')
    .sign(secret);
}

export const authMiddleware = createMiddleware<{
  Variables: { user: JwtPayload };
}>(async (c, next) => {
  // 本地开发若未配置配对码，保持开箱即用；生产环境必须携带设备令牌。
  if (ENV.NODE_ENV !== 'production' && !ENV.DEVICE_PAIRING_CODE) {
    c.set('user', { userId: 1, username: 'dev-device' });
    return next();
  }

  const authorization = c.req.header('Authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) throw new HTTPException(401, { message: '设备尚未配对' });

  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.userId !== 'number' || typeof payload.username !== 'string') {
      throw new Error('invalid payload');
    }
    c.set('user', { userId: payload.userId, username: payload.username });
    await next();
  } catch {
    throw new HTTPException(401, { message: '设备令牌无效或已过期' });
  }
});
