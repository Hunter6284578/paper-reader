import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { modelSettings } from '../db/schema.js';
import { ENV } from '../config.js';

export interface DeepSeekConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

const encryptionKey = createHash('sha256').update(ENV.SETTINGS_ENCRYPTION_KEY).digest();

function encrypt(value: string): { encrypted: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(encrypted: string, iv: string, tag: string): string {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function saveDeepSeekSettings(apiKey: string | undefined, model: string): void {
  const existing = db.select().from(modelSettings).where(eq(modelSettings.id, 1)).get();
  let values: typeof modelSettings.$inferInsert = {
    id: 1,
    model,
    updatedAt: new Date().toISOString(),
  };

  if (apiKey?.trim()) {
    const sealed = encrypt(apiKey.trim());
    values = {
      ...values,
      encryptedApiKey: sealed.encrypted,
      iv: sealed.iv,
      authTag: sealed.tag,
    };
  } else if (existing) {
    values = {
      ...values,
      encryptedApiKey: existing.encryptedApiKey,
      iv: existing.iv,
      authTag: existing.authTag,
    };
  }

  db.insert(modelSettings).values(values).onConflictDoUpdate({
    target: modelSettings.id,
    set: values,
  }).run();
}

export function getDeepSeekConfig(): DeepSeekConfig {
  const setting = db.select().from(modelSettings).where(eq(modelSettings.id, 1)).get();
  if (setting?.encryptedApiKey && setting.iv && setting.authTag) {
    return {
      apiKey: decrypt(setting.encryptedApiKey, setting.iv, setting.authTag),
      model: setting.model,
      baseUrl: ENV.DEEPSEEK_BASE_URL,
    };
  }
  return {
    apiKey: ENV.DEEPSEEK_API_KEY,
    model: ENV.DEEPSEEK_MODEL,
    baseUrl: ENV.DEEPSEEK_BASE_URL,
  };
}

export function getMaskedDeepSeekSettings() {
  const setting = db.select().from(modelSettings).where(eq(modelSettings.id, 1)).get();
  const configured = Boolean(setting?.encryptedApiKey || ENV.DEEPSEEK_API_KEY);
  let keyHint = '';
  if (configured) {
    try {
      const key = setting?.encryptedApiKey && setting.iv && setting.authTag
        ? decrypt(setting.encryptedApiKey, setting.iv, setting.authTag)
        : ENV.DEEPSEEK_API_KEY;
      keyHint = key.length > 4 ? `••••${key.slice(-4)}` : '••••';
    } catch {
      keyHint = '••••';
    }
  }
  return {
    configured,
    keyHint,
    model: setting?.model || ENV.DEEPSEEK_MODEL,
  };
}
