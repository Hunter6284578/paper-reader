import { config } from 'dotenv';
config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATA_DIR: process.env.DATA_DIR || './data',
  DB_PATH: process.env.DB_PATH || './data/db/app.db',
  PAPERS_DIR: process.env.PAPERS_DIR || './data/papers',
  UPLOADS_DIR: process.env.UPLOADS_DIR || './data/uploads',

  JWT_SECRET: process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET must be set in production. Set it in .env or environment variables.');
    }
    return 'dev-secret-change-in-production';
  })(),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  DEVICE_TOKEN_EXPIRES_IN: process.env.DEVICE_TOKEN_EXPIRES_IN || '180d',
  DEVICE_PAIRING_CODE: process.env.DEVICE_PAIRING_CODE || '',
  MAX_UPLOAD_BYTES: parseInt(process.env.MAX_UPLOAD_BYTES || String(100 * 1024 * 1024), 10),
  MAX_PROCESSING_ATTEMPTS: parseInt(process.env.MAX_PROCESSING_ATTEMPTS || '3', 10),
  SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: SETTINGS_ENCRYPTION_KEY must be set in production. Generate with: openssl rand -hex 32');
    }
    return process.env.JWT_SECRET || 'dev-settings-key-change-in-production';
  })(),

  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-chat',

  DICT_API_URL: process.env.DICT_API_URL || 'https://api.dictionaryapi.dev/api/v2/entries/en',

  SILICONFLOW_API_KEY: process.env.SILICONFLOW_API_KEY || '',
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',

  PYTHON_EXECUTABLE: process.env.PYTHON_EXECUTABLE || 'python3',
  PYTHON_PARSER_PATH: process.env.PYTHON_PARSER_PATH || './python/docling_parser.py',
  MIGRATIONS_DIR: process.env.MIGRATIONS_DIR || './src/db/migrations',
} as const;
