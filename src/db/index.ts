import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

// Use an in-memory db or a file based one. Let's use a file so we can view it.
const dbPath = path.join(process.cwd(), 'marine.db');
const sqlite = new Database(dbPath);

export const db = drizzle(sqlite, { schema });
