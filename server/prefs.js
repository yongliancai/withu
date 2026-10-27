// 相處偏好：系統從你和所有角色的相處，整理出「你喜歡怎麼被對待、怎麼聊天」，
// 認識新的人時他也會照這個方式跟你相處。
// 只整理說話與相處方式，不帶任何事實或私事（角色之間仍然只知道你親口跟他說的事）；也不會讓關係變快。
import { db, now, j } from './db.js';
import { jsonCall } from './llm.js';
import { logIssue } from './logger.js';

{
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('prefs')) db.exec('ALTER TABLE users ADD COLUMN prefs TEXT');
}

function stats(userId) {
  const rows = db.prepare(`SELECT text, created_at FROM messages WHERE user_id=? AND sender='user' AND kind='text' ORDER BY id DESC LIMIT 300`).all(userId);
  if (rows.length < 15) return null;
  const len = rows.reduce((a, r) => a + (r.text || '').length, 0) / rows.length;
  const emoji = rows.filter(r => /\p{Extended_Pictographic}/u.test(r.text || '')).length / rows.length;
  const laugh = rows.filter(r => /哈哈|笑死|XD|xd|😂|🤣/.test(r.text || '')).length / rows.length;
  const ask = rows.filter(r => /[?？]/.test(r.text || '')).length / rows.length;
  const hours = rows.map(r => Number(new Date(r.created_at).toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: 'numeric', hour12: false })) % 24);
  const night = hours.filter(h => h >= 22 || h < 3).length / rows.length;
  return `平均每則 ${Math.round(len)} 字；用表情符號的比例 ${Math.round(emoji * 100)}%；常笑（哈哈、XD）${Math.round(laugh * 100)}%；會主動問問題 ${Math.round(ask * 100)}%；深夜聊天 ${Math.round(night * 100)}%`;
}

export async function updateUserPrefs(userId) {
  const u = db.prepare('SELECT prefs FROM users WHERE id=?').get(userId);
  const cur = j(u?.prefs, null);
  if (cur && now() - cur.at < 12 * 3600e3) return;
  const chars = db.prepare(`SELECT c.persona FROM relationships r JOIN characters c ON c.id=r.character_id WHERE r.user_id=?`).all(userId).map(r => j(r.persona, {}));
  const more = chars.flatMap(p => p.tuning?.more || []), less = chars.flatMap(p => p.tuning?.less || []);
  const habits = db.prepare(`SELECT content FROM memories WHERE user_id=? AND kind='style'`).all(userId).map(r => r.content);
  const st = stats(userId);
  if (!more.length && !less.length && !habits.length && !st) return;
  const res = await jsonCall({
    userId, kind: 'prefs', tier: 'cheap',
    instructions: `以下是一位使用者和幾個 AI 角色相處時的反應整理。請歸納「這個人喜歡的聊天與相處方式」，讓他之後認識的新角色一開始就用對方喜歡的方式說話。
- likes：3–6 條，每條 20 字內（例如「喜歡對方先分享自己的事」「回覆短一點、多幾則」「喜歡被輕輕吐槽」）。
- dislikes：0–4 條，每條 20 字內（例如「不喜歡一直被問問題」「不喜歡太油的情話」）。
- 只寫說話與相處的方式。絕對不要寫任何關於這個人的事實或私事（工作、住哪、家人、健康、感情經歷、名字都不要）。
- 訊號不夠就少寫，不要猜。只輸出 JSON。`,
    input: [{ role: 'user', content: `對方反應好的：${more.join('；') || '（無）'}\n對方反應冷淡的：${less.join('；') || '（無）'}\n對方明確要求過的相處方式：${habits.join('；') || '（無）'}\n聊天習慣統計：${st || '（不足）'}` }],
    schema: { type: 'object', additionalProperties: false, properties: { likes: { type: 'array', items: { type: 'string' } }, dislikes: { type: 'array', items: { type: 'string' } } }, required: ['likes', 'dislikes'] },
    schemaName: 'prefs',
    mock: { likes: ['喜歡對方先分享自己的事', '回覆短一點、多幾則'], dislikes: ['不喜歡一直被問問題'] },
  }).catch(e => { logIssue({ level: 'warn', source: 'llm', message: `相處偏好整理失敗：${e.message}`, error: e, userId }); return null; });
  if (!res) return;
  db.prepare('UPDATE users SET prefs=? WHERE id=?').run(JSON.stringify({ likes: res.likes.slice(0, 6).map(x => x.slice(0, 30)), dislikes: res.dislikes.slice(0, 4).map(x => x.slice(0, 30)), at: now() }), userId);
}

export function prefsLines(userId) {
  const p = j(db.prepare('SELECT prefs FROM users WHERE id=?').get(userId)?.prefs, null);
  if (!p || (!p.likes?.length && !p.dislikes?.length)) return null;
  return [...(p.likes || []).map(x => `- 喜歡：${x}`), ...(p.dislikes || []).map(x => `- 不喜歡：${x}`)].join('\n');
}

export function prefsOf(userId) {
  return j(db.prepare('SELECT prefs FROM users WHERE id=?').get(userId)?.prefs, null);
}
