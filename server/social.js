// 你的主頁與動態：個人狀態、你發的動態／限時動態，以及角色看到後的反應（按讚、留言、看過、私訊關心）。
// 你的動態只有你選的對象看得到；不同使用者之間完全隔離。
import { db, now, j, logEvent } from './db.js';
import { jsonCall } from './llm.js';
import { personaBlock, STAGES } from './prompt.js';
import { presenceOf } from './presence.js';
import { logIssue } from './logger.js';

for (const [col, def] of [['avatar', 'TEXT'], ['bio', 'TEXT'], ['status_text', 'TEXT'], ['status_emoji', 'TEXT'], ['status_at', 'INTEGER']]) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
}
for (const [col, def] of [['story', 'INTEGER NOT NULL DEFAULT 0'], ['expires_at', 'INTEGER']]) {
  const cols = db.prepare('PRAGMA table_info(posts)').all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE posts ADD COLUMN ${col} ${def}`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS user_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story INTEGER NOT NULL DEFAULT 0,
  text TEXT,
  media TEXT,
  audience TEXT NOT NULL DEFAULT 'all',   -- all | lover | JSON array of rel ids
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS user_post_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES user_posts(id) ON DELETE CASCADE,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                      -- view | like | comment
  text TEXT,
  created_at INTEGER NOT NULL              -- 可能是「未來」：他晚一點才看到
);
CREATE TABLE IF NOT EXISTS story_views (
  user_id TEXT NOT NULL, post_id INTEGER NOT NULL, PRIMARY KEY (user_id, post_id)
);
`);

const STATUS_TTL = 24 * 3600e3;
export function userStatus(u) {
  if (!u.status_text || !u.status_at || now() - u.status_at > STATUS_TTL) return null;
  return { emoji: u.status_emoji || '', text: u.status_text, at: u.status_at };
}
export const statusLine = (u) => { const s = userStatus(u); return s ? `${s.emoji} ${s.text}（${Math.max(1, Math.round((now() - s.at) / 3600e3))} 小時內設定）`.trim() : null; };

function audienceRels(userId, audience) {
  const rels = db.prepare(`SELECT * FROM relationships WHERE user_id=? AND status='active' AND blocked=0`).all(userId);
  if (audience === 'lover') return rels.filter(r => r.stage >= 3);
  if (audience === 'all') return rels;
  const ids = j(audience, []);
  return rels.filter(r => ids.includes(r.id));
}

/** Posts of hers he can see (last 48h), for the chat context. */
export function postsVisibleTo(rel) {
  const rows = db.prepare(`SELECT * FROM user_posts WHERE user_id=? AND created_at>? ORDER BY id DESC LIMIT 6`).all(rel.user_id, now() - 48 * 3600e3);
  return rows.filter(p => audienceRels(rel.user_id, p.audience).some(r => r.id === rel.id))
    .map(p => `${p.story ? '限時動態' : '動態'}：${p.text || '（一張照片）'}${p.media ? '（附照片）' : ''}`);
}

export function createUserPost(user, { story, text, media, audience }) {
  const aud = audience === 'lover' || audience === 'all' ? audience : JSON.stringify((Array.isArray(audience) ? audience : []).slice(0, 20));
  const t = now();
  const id = db.prepare('INSERT INTO user_posts (user_id,story,text,media,audience,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
    .run(user.id, story ? 1 : 0, text ? String(text).slice(0, 300) : null, media || null, aud, t, story ? t + 24 * 3600e3 : null).lastInsertRowid;
  logEvent(user.id, story ? 'user_story' : 'user_post', { audience: audience === 'all' || audience === 'lover' ? audience : 'some' });
  reactToPost(user, id).catch(e => logIssue({ level: 'warn', source: 'social', message: `角色看動態失敗：${e.message}`, error: e, userId: user.id }));
  return id;
}

// 他們看到你的動態：依關係決定看不看、按不按讚、留不留言、要不要私訊關心（私訊會經過發送前檢查）
async function reactToPost(user, postId) {
  const p = db.prepare('SELECT * FROM user_posts WHERE id=?').get(postId);
  for (const rel of audienceRels(user.id, p.audience)) {
    const persona = j(db.prepare('SELECT persona FROM characters WHERE id=?').get(rel.character_id).persona, {});
    const pr = presenceOf(rel, persona);
    const seenAt = now() + (pr.code === 'online' ? 20e3 + Math.random() * 120e3 : pr.code === 'dnd' ? Math.max(0, (pr.wakeAt || now()) - now()) : 4 * 60e3 + Math.random() * 40 * 60e3);
    const res = await jsonCall({
      userId: user.id, kind: 'react', tier: 'cheap',
      instructions: `${personaBlock(persona)}

${user.call_name}剛發了一則${p.story ? '限時動態' : '動態'}，你滑手機時看到了。你們的關係：${STAGES[rel.stage]}。
決定你的反應：like（要不要按讚）、comment（要不要在底下留言，25 字內，沒有就空字串）、dm（要不要私下傳訊息給對方，例如對方看起來很累、生病、心情不好、或是你很好奇；沒有就空字串）。
關係還不熟時反應淡一點；交往後比較會留言或私訊。對方的動態看起來心情不好時，私訊關心比公開留言好。只輸出 JSON。`,
      input: [{ role: 'user', content: `動態內容：${p.text || '（沒有文字）'}${p.media ? '\n（附了一張照片）' : ''}` }],
      schema: { type: 'object', additionalProperties: false, properties: { like: { type: 'boolean' }, comment: { type: 'string' }, dm: { type: 'string' } }, required: ['like', 'comment', 'dm'] },
      schemaName: 'react',
      mock: { like: true, comment: rel.stage >= 1 ? '好可愛！' : '', dm: /累|難過|不舒服|好煩/.test(p.text || '') ? '看到你的動態了，還好嗎？' : '' },
    });
    const ins = db.prepare('INSERT INTO user_post_reactions (post_id,rel_id,type,text,created_at) VALUES (?,?,?,?,?)');
    ins.run(p.id, rel.id, 'view', null, Math.round(seenAt));
    if (res.like) ins.run(p.id, rel.id, 'like', null, Math.round(seenAt + 5e3));
    if (res.comment && !p.story) ins.run(p.id, rel.id, 'comment', res.comment.slice(0, 60), Math.round(seenAt + 30e3));
    if (res.dm) db.prepare('INSERT INTO followups (rel_id,due_at,topic) VALUES (?,?,?)')
      .run(rel.id, Math.round(seenAt + 60e3), `你看到對方的${p.story ? '限時動態' : '動態'}「${(p.text || '一張照片').slice(0, 40)}」，想私下跟對方說：${res.dm.slice(0, 60)}`);
  }
}

export function userPostsOut(userId, { stories = false } = {}) {
  const rows = stories
    ? db.prepare('SELECT * FROM user_posts WHERE user_id=? AND story=1 AND expires_at>? ORDER BY id').all(userId, now())
    : db.prepare('SELECT * FROM user_posts WHERE user_id=? AND story=0 ORDER BY id DESC LIMIT 60').all(userId);
  const rx = db.prepare(`SELECT x.*, c.persona FROM user_post_reactions x JOIN relationships r ON r.id=x.rel_id JOIN characters c ON c.id=r.character_id WHERE x.post_id=? AND x.created_at<=? ORDER BY x.id`);
  return rows.map(p => {
    const reactions = rx.all(p.id, now()).map(x => ({ type: x.type, text: x.text, at: x.created_at, relId: x.rel_id, name: j(x.persona, {}).name }));
    return { id: p.id, story: !!p.story, text: p.text, media: p.media ? `/api/media/${p.media}` : null, at: p.created_at, expiresAt: p.expires_at,
      audience: p.audience === 'all' || p.audience === 'lover' ? p.audience : 'some',
      likes: reactions.filter(x => x.type === 'like').map(x => x.name), comments: reactions.filter(x => x.type === 'comment'),
      viewers: [...new Set(reactions.filter(x => x.type === 'view').map(x => x.relId))] };
  });
}

// 角色的限時動態：24 小時內、還沒看過的排前面
export function charStories(userId) {
  const rows = db.prepare(`SELECT p.*, c.persona, r.id rid FROM posts p JOIN relationships r ON r.id=p.rel_id JOIN characters c ON c.id=r.character_id
    WHERE r.user_id=? AND r.status='active' AND r.blocked=0 AND p.story=1 AND p.expires_at>? ORDER BY p.id`).all(userId, now());
  const seen = new Set(db.prepare('SELECT post_id FROM story_views WHERE user_id=?').all(userId).map(r => r.post_id));
  const byRel = new Map();
  for (const p of rows) {
    if (!byRel.has(p.rid)) byRel.set(p.rid, { relId: p.rid, persona: j(p.persona, {}), items: [] });
    byRel.get(p.rid).items.push({ id: p.id, text: p.text, photoId: p.photo_id, at: p.created_at, seen: seen.has(p.id) });
  }
  return [...byRel.values()].sort((a, b) => (a.items.every(i => i.seen) - b.items.every(i => i.seen)) || (b.items.at(-1).at - a.items.at(-1).at));
}

export function markStorySeen(userId, postId) {
  db.prepare('INSERT OR IGNORE INTO story_views (user_id,post_id) VALUES (?,?)').run(userId, postId);
}

export function mediaOwnedBy(userId, file) {
  return db.prepare('SELECT 1 FROM user_posts WHERE user_id=? AND media=?').get(userId, file) || db.prepare('SELECT 1 FROM users WHERE id=? AND avatar=?').get(userId, file);
}
