// 刪除帳號與所有資料（使用者自己刪，或後台代為處理「刪除我的資料」的請求）
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';

export function deleteAccount(uid) {
  const req = { user: db.prepare('SELECT * FROM users WHERE id=?').get(uid) };
  if (!req.user) return false;
  const files = [
    ...db.prepare('SELECT media FROM messages WHERE user_id=? AND media IS NOT NULL').all(uid).map(r => r.media),
    ...db.prepare('SELECT media FROM user_posts WHERE user_id=? AND media IS NOT NULL').all(uid).map(r => r.media),
    ...(req.user.avatar ? [req.user.avatar] : []),
  ];
  for (const f of files) for (const dir of ['uploads', 'audio']) fs.rmSync(path.join(config.dataDir, dir, path.basename(f)), { force: true });
  db.prepare('DELETE FROM templates WHERE creator_user_id=?').run(uid);
  db.prepare('DELETE FROM events WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM usage WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM messages WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM memories WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM story WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM logs WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM story_views WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM self_topics WHERE rel_id IN (SELECT id FROM relationships WHERE user_id=?)').run(uid);
  db.prepare('DELETE FROM daily_use WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM users WHERE id=?').run(uid); // cascades
  return true;
}
