import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'audio'), { recursive: true });

export const db = new Database(path.join(config.dataDir, 'companion.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  call_name TEXT NOT NULL,
  recovery_code TEXT UNIQUE NOT NULL,
  invite_code TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_active_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- official | shared
  data TEXT NOT NULL,              -- persona frame JSON
  creator_user_id TEXT,
  creator_name TEXT,
  uses INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  reports INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT,
  origin TEXT NOT NULL,            -- official | shared | custom
  persona TEXT NOT NULL,           -- JSON: frame + emergent traits
  persona_locked INTEGER NOT NULL DEFAULT 0,
  shaped_at_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',   -- active | ended
  stage INTEGER NOT NULL DEFAULT 0,
  affection REAL NOT NULL DEFAULT 5,
  understanding REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'practice',   -- practice | real
  pinned INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  start_type TEXT NOT NULL DEFAULT 'stranger',
  scenario TEXT,
  status_line TEXT,
  status_line_at INTEGER,
  outing_active INTEGER NOT NULL DEFAULT 0,
  outing_started_at INTEGER,
  user_busy_until INTEGER,
  unanswered INTEGER NOT NULL DEFAULT 0,
  proactive_log TEXT NOT NULL DEFAULT '{}',
  meal_proposed_date TEXT,
  meal_declined INTEGER NOT NULL DEFAULT 0,
  stage_changed_at INTEGER,
  user_msg_count INTEGER NOT NULL DEFAULT 0,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  last_user_msg_at INTEGER,
  last_char_msg_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  sender TEXT NOT NULL,            -- user | char | system
  kind TEXT NOT NULL DEFAULT 'text', -- text | voice | photo | card | scene
  text TEXT,
  media TEXT,
  card TEXT,
  proactive INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_rel ON messages(rel_id, id);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'real', -- real | setting
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS story (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,              -- milestone | photo | travelogue | letter
  title TEXT,
  body TEXT,
  place TEXT,
  media TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  due_at INTEGER NOT NULL,
  topic TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS world_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  kind TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  cached_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  units REAL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  name TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  author TEXT NOT NULL,            -- user | char
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  days INTEGER NOT NULL,
  done TEXT NOT NULL DEFAULT '[]',   -- 做到的日期（不用連續）
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sub TEXT NOT NULL
);
`);

// Migrations for databases created by earlier versions (safe to run repeatedly).
for (const [table, col, def] of [
  ['users', 'cohort', "TEXT NOT NULL DEFAULT 'f'"],   // f = 女性向測試群, m = 男性向測試群
  ['users', 'gender', 'TEXT'],                        // female | male | other
  ['users', 'seeks', "TEXT NOT NULL DEFAULT 'male'"],  // male | female | any
  ['relationships', 'walk_started_at', 'INTEGER'],    // 一起散步中
  ['story', 'scene', 'TEXT'],                         // 他寄的風景明信片用的插圖
  ['messages', 'suggest', 'TEXT'],                    // 建議回覆（JSON 陣列）
  ['relationships', 'pending_reply_at', 'INTEGER'],   // 他在忙／睡覺：預計回覆的時間
  ['relationships', 'activity', 'TEXT'],              // 一起做的事（JSON：type, title, started_at, ends_at）
  ['relationships', 'summary', 'TEXT'],               // 較早對話的摘要
  ['relationships', 'summary_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['story', 'photo_id', 'INTEGER'],
  ['relationships', 'theme', 'TEXT'],                 // 聊天室主題                  // 他寄的明信片用的寫實照片
  ['relationships', 'char_read_id', 'INTEGER NOT NULL DEFAULT 0'], // 他讀到哪一則（已讀）
]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export const now = () => Date.now();
export const j = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export function logEvent(userId, name, data) {
  db.prepare('INSERT INTO events (user_id,name,data,created_at) VALUES (?,?,?,?)')
    .run(userId || null, name, data ? JSON.stringify(data) : null, now());
}
