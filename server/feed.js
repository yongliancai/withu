// 動態牆：他自己發的生活動態（文字＋寫實照片），你可以按讚、留言，他會回你的留言。
import { db, now, j, logEvent } from './db.js';
import { lifeContext } from './lifelog.js';
import { S } from './settings.js';
import { jsonCall } from './llm.js';
import { personaBlock } from './prompt.js';
import { PHOTO_TAGS, PHOTO_TAG_GUIDE, pickPhoto, photoById } from './photos.js';
import { taipeiParts, describeNow, charStatus } from './characters.js';
import { toldOf, addTold, similarity } from './memory.js';
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

// 共用關卡：不管是排程、聊天中、還是生活連續劇，發動態都要過這一關
// （今天幾則、離上一則多久、內容跟最近的不能太像），避免一分鐘內連發兩則。
const dayStartTpe = () => { const t = taipeiParts(); return now() - t.minutes * 60000; };
export function canPost(relId, text = '') {
  const st = db.prepare('SELECT COUNT(*) n FROM posts WHERE rel_id=? AND created_at>=?').get(relId, dayStartTpe());
  if (st.n >= S('postPerDay')) return false;
  const last = db.prepare('SELECT text, created_at FROM posts WHERE rel_id=? ORDER BY id DESC LIMIT 1').get(relId);
  if (last && now() - last.created_at < S('postGapHours') * 3600e3) return false;
  if (text) {
    const recent = db.prepare('SELECT text FROM posts WHERE rel_id=? ORDER BY id DESC LIMIT 10').all(relId);
    if (recent.some(r => similarity(r.text || '', text) >= 0.5)) return false;
  }
  return true;
}

/** 發一則動態；沒通過關卡就不發，回傳 null。 */
export function addPost(rel, text, tag, { story = false } = {}) {
  if (!canPost(rel.id, text)) return null;
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
你今天的生活手帳（動態內容要跟這裡一致，挑一件已經發生的事來發）：${lifeContext(rel.id).join('；') || '（沒有）'}
- 第一人稱，20–60 字，像真人發文：具體、有畫面、有一點心情，可以有一兩個表情符號或 hashtag。
- 內容是你自己的生活（可以延續「你生活中正在進行的事」，要有新進展），不要提到和你聊天的那個人，也不要寫對方的任何私事。
- photo_tag 從這些照片類別挑一張（代號＝照片裡實際是什麼）：${PHOTO_TAG_GUIDE}。照片內容必須就是文中講的東西或地方（寫文章不是寫程式、吃便當不是吃點心）；只是沾到邊、或沒有剛好的類別就填 null，寧可不配圖。
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
  // 有照片的有時候發成限時動態（24 小時後消失）
  const id = addPost(rel, res.text, res.photo_tag, { story: !!res.photo_tag && Math.random() < 0.45 });
  if (!id) return null;
  addTold(rel.id, res.told);
  logEvent(rel.user_id, 'post', { rel: rel.id });
  return id;
}

// 一天最多兩則：午休、下班後、休假的午後
function hash01(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}
// 發文時段：午休、下班後、休假的午後。每個時段當天用固定亂數決定「發不發」和「在第幾分鐘發」，
// 所以不會因為排程每分鐘跑一次就變得很頻繁。
export function postMoment(persona, rel, t) {
  const s = persona.schedule || { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };
  const workday = s.days.includes(t.weekday);
  const toMin = (x) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; };
  const end = toMin(s.end);
  const wins = [];
  if (workday && end > 13 * 60 + 30) wins.push({ key: 'lunch', from: 12 * 60, to: 13 * 60 + 30, label: '午休時間，分享午餐或工作空檔看到的東西' });
  if (workday && end + 40 < 23 * 60) wins.push({ key: 'after', from: end + 40, to: Math.min(end + 180, 23 * 60 + 30), label: '下班後，分享今天的一件事或回家路上看到的東西' });
  if (!workday) wins.push({ key: 'off', from: 14 * 60, to: 18 * 60, label: `休假的午後（${persona.weekend || '在家休息'}）` });
  const w = wins.find(x => t.minutes >= x.from && t.minutes < x.to);
  if (!w) return null;
  const seed = `${rel.id}|${t.date}|${w.key}`;
  const go = hash01(seed + '|go') < S('postWindowChance');
  const at = w.from + Math.floor(hash01(seed + '|at') * (w.to - w.from - 10));
  // 到了那一分鐘之後才發（之後每分鐘都可能再檢查，但 canPost 會擋住重複）
  return { label: w.label, fire: go && t.minutes >= at };
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
