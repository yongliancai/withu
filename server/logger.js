// 系統紀錄：把系統自己解決不了的問題記下來，方便之後 debug。
// level: error（壞掉了）| warn（有問題但有備案）| report（使用者回報）
import { db, now } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  source TEXT NOT NULL,      -- server | scheduler | llm | tts | stt | push | client | user
  message TEXT NOT NULL,
  detail TEXT,               -- JSON: stack, status, request info, client info, recent messages (reports only)
  user_id TEXT,
  rel_id TEXT,
  resolved_at INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(created_at);
`);

const MAX_TEXT = 4000;
const clip = (s, n = MAX_TEXT) => (s == null ? null : String(s).slice(0, n));

// Never store secrets that might appear in error objects.
function scrub(obj) {
  const s = JSON.stringify(obj ?? null, (k, v) => (/key|token|authorization|password|secret|cookie/i.test(k) ? '[hidden]' : v));
  return clip(s, 12000);
}

// Repeated identical errors within a minute are collapsed into one row.
const recent = new Map();

export function logIssue({ level = 'error', source = 'server', message, error, detail, userId, relId }) {
  try {
    const msg = clip(message || error?.message || '（沒有訊息）', 500);
    const key = `${level}|${source}|${msg}|${relId || ''}`;
    const t = now();
    if (recent.has(key) && t - recent.get(key) < 60000) return;
    recent.set(key, t);
    if (recent.size > 500) recent.clear();
    const info = {
      ...(detail || {}),
      ...(error ? { name: error.name, stack: clip(error.stack, 3000), status: error.status, code: error.code, type: error.type } : {}),
    };
    db.prepare('INSERT INTO logs (level,source,message,detail,user_id,rel_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(level, source, msg, scrub(info), userId || null, relId || null, t);
    if (level === 'error') console.error(`[${source}] ${msg}`, error?.stack || '');
  } catch (e) {
    console.error('logger failed', e);
  }
}

// Keep 30 days.
export function purgeOldLogs() {
  db.prepare('DELETE FROM logs WHERE created_at < ?').run(now() - 30 * 864e5);
}
