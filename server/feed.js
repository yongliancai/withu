// 動態牆：他自己發的生活動態（文字＋寫實照片），你可以按讚、留言，他會回你的留言。
import { db, now, j, logEvent } from './db.js';
import { jsonCall } from './llm.js';
import { personaBlock } from './prompt.js';
import { PHOTO_TAGS, pickPhoto, photoById } from './photos.js';
import { taipeiParts, describeNow, charStatus } from './characters.js';
import { toldOf, addTold } from './memory.js';
import { presenceOf } from './presence.js';
import { logIssue } from './logger.js';

for (const [col, def] of [['photo_id', 'INTEGER'], ['liked', 'INTEGER NOT NULL DEFAULT 0'], ['photo_tag', 'TEXT']]) {
  const cols = db.prepare('PRAGMA table_info(posts)').all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE posts ADD COLUMN ${col} ${def}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,          -- user | char
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL    -- 他的回覆可能是「未來」的時間：到了才顯示
)`);

const TAG_LIST = Object.keys(PHOTO_TAGS);

export function addPost(rel, text, tag, { story = false } = {}) {
  const photo = tag && PHOTO_TAGS[tag] ? pickPhoto(tag) : null;
  return db.prepare('INSERT INTO posts (rel_id,text,photo_id,photo_tag,story,expires_at,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(rel.id, String(text).slice(0, 120), photo?.id || null, tag || null, story ? 1 : 0, story ? now() + 24 * 3600e3 : null, now()).lastInsertRowid;
}

/** He posts something on his own (no message to the user). */
export async function generatePost(rel, persona, moment) {
  const recent = db.prepare('SELECT text FROM posts WHERE rel_id=? ORDER BY id DESC LIMIT 8').all(rel.id).map(r => r.text);
  const res = await jsonCall({
    userId: rel.user_id, kind: 'post', tier: 'cheap',
    instructions: `${personaBlock(persona)}

你要在自己的社群帳號（像 IG、Threads）發一則動態。現在是 ${describeNow()}，你此刻：${charStatus(persona).label}。時機：${moment}。
- 第一人稱，20–60 字，像真人發文：具體、有畫面、有一點心情，可以有一兩個表情符號或 hashtag。
- 內容是你自己的生活（可以延續「你生活中正在進行的事」，要有新進展），不要提到和你聊天的那個人，也不要寫對方的任何私事。
- photo_tag 從這些類別挑一個最符合的照片：${TAG_LIST.join('、')}；這則不適合配照片就填 null。
- 不要和最近發過的重複：${recent.join('｜') || '（還沒發過）'}
- told：用 20 字內摘要這則動態講的事，讓你之後聊天不會重講。
只輸出 JSON。`,
    input: [{ role: 'user', content: '發一則動態' }],
    schema: { type: 'object', additionalProperties: false, properties: {
      text: { type: 'string' }, photo_tag: { type: ['string', 'null'], enum: [...TAG_LIST, null] }, told: { type: 'string' },
    }, required: ['text', 'photo_tag', 'told'] },
    schemaName: 'post',
    mock: () => {
      const opts = [['今天的拉花終於有一點像天鵝了 🦢', 'latte'], ['下班路上的天空，紫色的。', 'sunset'], ['午餐吃了巷口的牛肉麵，湯頭好濃。', 'noodles'], ['週末去河濱騎車，風好舒服。', 'river'], ['家裡的植物冒新芽了 🌱', 'plants']];
      const [text, photo_tag] = opts[Math.floor(Math.random() * opts.length)];
      return { text, photo_tag, told: text.slice(0, 18) };
    },
  });
  if (!res.text) return null;
  addTold(rel.id, res.told);
  // 有照片的有時候發成限時動態（24 小時後消失）
  const id = addPost(rel, res.text, res.photo_tag, { story: !!res.photo_tag && Math.random() < 0.45 });
  logEvent(rel.user_id, 'post', { rel: rel.id });
  return id;
}

// 一天最多兩則：午休、下班後、休假的午後
export function postMoment(persona, rel, t) {
  const s = persona.schedule || { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };
  const workday = s.days.includes(t.weekday);
  const toMin = (x) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; };
  const m = t.minutes, end = toMin(s.end);
  if (workday && m >= 12 * 60 && m < 13 * 60 + 30) return '午休時間，分享午餐或工作空檔看到的東西';
  if (workday && m >= end + 40 && m < end + 180 && m < 23 * 60 + 30) return '下班後，分享今天的一件事或回家路上看到的東西';
  if (!workday && m >= 14 * 60 && m < 18 * 60) return `休假的午後（${persona.weekend || '在家休息'}）`;
  return null;
}

export function feedFor(userId) {
  const rows = db.prepare(`SELECT p.*, r.id rel_id2, c.persona FROM posts p JOIN relationships r ON r.id=p.rel_id JOIN characters c ON c.id=r.character_id
    WHERE r.user_id=? AND r.status='active' AND r.blocked=0 AND COALESCE(p.story,0)=0 ORDER BY p.id DESC LIMIT 60`).all(userId);
  const com = db.prepare('SELECT id, sender, text, created_at FROM post_comments WHERE post_id=? AND created_at<=? ORDER BY id');
  return rows.map(p => ({
    id: p.id, relId: p.rel_id, text: p.text, at: p.created_at, liked: !!p.liked,
    photo: p.photo_id ? photoById(p.photo_id) : null,
    comments: com.all(p.id, now()).map(c => ({ id: c.id, sender: c.sender, text: c.text, at: c.created_at })),
    persona: j(p.persona, {}),
  }));
}

export function likePost(userId, postId) {
  const p = db.prepare(`SELECT p.* FROM posts p JOIN relationships r ON r.id=p.rel_id WHERE p.id=? AND r.user_id=?`).get(postId, userId);
  if (!p) return null;
  const liked = p.liked ? 0 : 1;
  db.prepare('UPDATE posts SET liked=? WHERE id=?').run(liked, p.id);
  if (liked) logEvent(userId, 'post_like', { rel: p.rel_id });
  return { liked: !!liked };
}

/** Her comment + his reply (shown after a human-like delay). */
export async function commentPost(user, postId, text) {
  const p = db.prepare(`SELECT p.*, r.user_id uid FROM posts p JOIN relationships r ON r.id=p.rel_id WHERE p.id=? AND r.user_id=?`).get(postId, user.id);
  if (!p) return null;
  text = String(text || '').trim().slice(0, 200);
  if (!text) return null;
  db.prepare('INSERT INTO post_comments (post_id,sender,text,created_at) VALUES (?,?,?,?)').run(p.id, 'user', text, now());
  logEvent(user.id, 'post_comment', { rel: p.rel_id });
  const rel = db.prepare('SELECT * FROM relationships WHERE id=?').get(p.rel_id);
  const persona = { ...j(db.prepare('SELECT persona FROM characters WHERE id=?').get(rel.character_id).persona, {}) };
  try {
    const res = await jsonCall({
      userId: user.id, kind: 'comment', tier: 'cheap',
      instructions: `${personaBlock(persona)}\n\n${user.call_name}在你的動態「${p.text}」底下留言。用你的口吻回一則留言（25 字內，像社群上的回覆，可以有表情符號），依你們的關係（${['認識', '朋友', '曖昧', '交往', '長期伴侶'][rel.stage]}）決定親密程度。只輸出 JSON。`,
      input: [{ role: 'user', content: text }],
      schema: { type: 'object', additionalProperties: false, properties: { reply: { type: 'string' } }, required: ['reply'] },
      schemaName: 'comment',
      mock: { reply: '哈哈被你發現了 😆' },
    });
    const pr = presenceOf(rel, persona);
    const delay = pr.code === 'online' ? 30e3 + Math.random() * 90e3 : pr.code === 'dnd' ? Math.max(0, (pr.wakeAt || now()) - now()) : 3 * 60e3 + Math.random() * 15 * 60e3;
    db.prepare('INSERT INTO post_comments (post_id,sender,text,created_at) VALUES (?,?,?,?)').run(p.id, 'char', res.reply.slice(0, 80), Math.round(now() + delay));
  } catch (e) {
    logIssue({ level: 'warn', source: 'llm', message: `動態留言回覆失敗：${e.message}`, error: e, userId: user.id, relId: rel.id });
  }
  return { ok: true };
}
