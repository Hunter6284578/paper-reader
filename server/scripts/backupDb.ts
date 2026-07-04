import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, rmSync } from 'fs';
import { basename, dirname, join } from 'path';
import { ENV } from '../src/config.js';

const backupDir = join(dirname(ENV.DB_PATH), 'backups');
mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = join(backupDir, `${basename(ENV.DB_PATH)}.${timestamp}.bak`);
const database = new Database(ENV.DB_PATH, { readonly: true, fileMustExist: true });

try {
  await database.backup(destination);
  const backups = readdirSync(backupDir)
    .filter((name) => name.endsWith('.bak'))
    .sort()
    .reverse();
  for (const stale of backups.slice(5)) rmSync(join(backupDir, stale));
  console.log(`Database backup written: ${destination}`);
} finally {
  database.close();
}
