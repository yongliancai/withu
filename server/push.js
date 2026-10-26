import webpush from 'web-push';
import { config } from './config.js';
import { db, j } from './db.js';
import { logIssue } from './logger.js';
import { taipeiParts, toMin } from './characters.js';

const enabled = !!(config.vapidPublic && config.vapidPrivate);
if (enabled) webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);

export const pushEnabled = () => enabled;

function inDnd(settings) {
  const m = taipeiParts().minutes;
  const s = toMin(settings.dndStart || '23:30'), e = toMin(settings.dndEnd || '07:30');
  return s <= e ? (m >= s && m < e) : (m >= s || m < e);
}

export async function notify(user, { name, text, relId }) {
  if (!enabled) return;
  const settings = j(user.settings, {});
  const discreet = settings.notifyPreview === 'discreet';
  // 未讀數：這個聊天室幾則、全部幾則（App 圖示上的數字）
  const unreadRel = db.prepare(`SELECT COUNT(*) n FROM messages m JOIN relationships r ON r.id=m.rel_id WHERE r.id=? AND m.sender='char' AND m.kind!='card' AND m.id>r.last_read_id`).get(relId).n;
  const total = db.prepare(`SELECT COUNT(*) n FROM messages m JOIN relationships r ON r.id=m.rel_id WHERE r.user_id=? AND r.status='active' AND m.sender='char' AND m.id>r.last_read_id`).get(user.id).n;
  const silent = inDnd(settings);
  const body = discreet ? (unreadRel > 1 ? `你有 ${unreadRel} 則新訊息` : '你有一則新訊息')
    : (unreadRel > 1 ? `${unreadRel} 則新訊息・${text}` : text).slice(0, 90);
  const payload = JSON.stringify({
    title: discreet ? '新訊息' : name,
    body,
    url: `/#/chat/${relId}`,
    tag: relId,
    badge: total,
    silent,
  });
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id=?').all(user.id);
  for (const s of subs) {
    try {
      await webpush.sendNotification(JSON.parse(s.sub), payload, { TTL: 3600 });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(s.endpoint);
      else logIssue({ level: 'warn', source: 'push', message: `推播送出失敗（${e.statusCode || e.message}）`, error: e, userId: user.id });
    }
  }
}
