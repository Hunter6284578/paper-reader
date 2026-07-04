import { createHash } from 'crypto';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  key: (context: Context) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function clientAddress(context: Context): string {
  const remoteAddress = (context.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming?.socket?.remoteAddress;
  return remoteAddress
    || context.req.header('x-real-ip')
    || context.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

export function authenticatedClientKey(context: Context): string {
  const value = context.req.header('Authorization') || clientAddress(context);
  return createHash('sha256').update(value).digest('hex');
}

export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  return createMiddleware(async (context, next) => {
    const now = Date.now();
    const key = options.key(context);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    context.header('X-RateLimit-Limit', String(options.max));
    context.header('X-RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
    context.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > options.max) {
      context.header('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return context.json({ error: '请求过于频繁，请稍后再试' }, 429);
    }
    if (buckets.size > 10_000) {
      for (const [candidate, value] of buckets) if (value.resetAt <= now) buckets.delete(candidate);
    }
    await next();
  });
}
