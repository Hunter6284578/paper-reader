import { ENV } from '../config.js';
import { sqlite } from './connection.js';

const applied = sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as { count: number };
console.log(`Database migrations ready: ${ENV.DB_PATH} (${applied.count} recorded)`);
sqlite.close();
