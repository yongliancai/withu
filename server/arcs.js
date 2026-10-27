// 他生活裡的連續劇：依他的職業、個性、正在進行的事，產生一件接下來幾天會發生的事，
// 每天推進一段（發成動態），留一點懸念；他在聊天裡只知道「已經發生的部分」，不會劇透結局。
import { db, now, j, logEvent } from './db.js';
import './lifelog.js';
import { jsonCall } from './llm.js';
import { personaBlock } from './prompt.js';
import { charStatus, taipeiParts } from './characters.js';
import { PHOTO_TAGS } from './photos.js';
import { addPost } from './feed.js';
import { addTold } from './memory.js';
import { logIssue } from './logger.js';

db.exec(`CREATE TABLE IF NOT EXISTS arcs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  premise TEXT NOT NULL,
  beats TEXT NOT NULL,          -- JSON [{text, share, photo_tag}]
  step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  next_at INTEGER,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
)`);

const TAGS = Object.keys(PHOTO_TAGS);

export function activeArc(relId) {
  return db.prepare(`SELECT * FROM arcs WHERE rel_id=? AND status='active' ORDER BY id DESC LIMIT 1`).get(relId);
}

/** What he knows about his own ongoing story (only what has already happened). */
export function arcContext(relId) {
  const a = activeArc(relId);
  if (a) {
    const done = j(a.beats, []).slice(0, a.step);
    if (!done.length) return null;
    return `「${a.title}」：${a.premise}\n已經發生的：${done.map((b, i) => `${i + 1}. ${b.text}`).join(' ')}\n接下來會怎樣你自己也還不知道：不要劇透、不要自己編結果。對方問起時照實說目前的進度和你的心情。`;
  }
  const last = db.prepare(`SELECT * FROM arcs WHERE rel_id=? AND status='done' AND ended_at>? ORDER BY id DESC LIMIT 1`).get(relId, now() - 4 * 864e5);
  if (!last) return null;
  const beats = j(last.beats, []);
  return `最近結束的事「${last.title}」：${beats.map(b => b.text).join(' ')}（已經有結果了，可以聊、可以回味）`;
}

async function createArc(rel, persona) {
  // 他經歷過的所有事 + 每月大事記：開新的事之前先看過，不要繞回來重做
  const past = db.prepare('SELECT title FROM arcs WHERE rel_id=? ORDER BY id DESC LIMIT 40').all(rel.id).map(r => r.title);
  const digests = db.prepare('SELECT month, text FROM life_digest WHERE rel_id=? ORDER BY month').all(rel.id).map(d => `${d.month}：${d.text}`);
  const res = await jsonCall({
    userId: rel.user_id, kind: 'arc', tier: 'cheap',
    instructions: `${personaBlock(persona)}

幫這個角色設計一件「接下來 3–6 天會發生在他自己生活裡的事」，像連續劇一樣每天推進一點、有懸念、最後有結果。
- 一定要符合他的職業、個性、作息和「生活中正在進行的事」，是這個人真的會遇到的事（例如咖啡師參加拉花比賽、研究生投稿等審查結果、教練帶的學員第一次比賽、設計師等提案結果、搬家找房子、家裡的貓生病看醫生後好轉）。不要硬套戲劇化情節。
- 規模是日常的小事到中等的事：不要重病、意外、死亡、犯罪，不要跟別人的戀愛或曖昧。
- beats 3–6 段，依時間順序。每段 text 是他當天會發在社群上的第一人稱動態（20–50 字，有畫面，像真人發文，符合他的說話風格）；share 是他想私下跟對方說的一句話（依他的個性：慢熱、獨立的人常常不說就填空字串，黏人的人會想第一個告訴對方）；photo_tag 從這些類別挑最符合的或 null：${TAGS.join('、')}。
- 第一段是開端（事情開始了、還不知道結果），中間有一個小波折，最後一段是結果；結果可以是好的也可以是不如預期，但要合理，並有他的心情。
- 不要重複他之前經歷過的事（可以是延續，例如「去年比過一次，這次想拿冠軍」，但不能當成第一次）：${past.join('、') || '（沒有）'}${digests.length ? `\n- 他過去幾個月的大事記：${digests.join('；')}` : ''}
只輸出 JSON。`,
    input: [{ role: 'user', content: '設計一件事' }],
    schema: { type: 'object', additionalProperties: false, properties: {
      title: { type: 'string' }, premise: { type: 'string' },
      beats: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        text: { type: 'string' }, share: { type: 'string' }, photo_tag: { type: ['string', 'null'], enum: [...TAGS, null] } }, required: ['text', 'share', 'photo_tag'] } },
    }, required: ['title', 'premise', 'beats'] },
    schemaName: 'arc',
    mock: { title: '拉花比賽', premise: '他報名了區域拉花比賽，比賽在三天後。', beats: [
      { text: '報名了下週的拉花比賽 😳 這幾天下班都要留下來練。', share: '跟你說，我報名比賽了，有點緊張', photo_tag: 'latte' },
      { text: '練到第 40 杯，天鵝的脖子還是歪的。', share: '', photo_tag: 'latte' },
      { text: '今天比賽！初賽過了，決賽手一直抖。', share: '初賽過了！決賽好緊張', photo_tag: 'cafe' },
      { text: '拿到第三名。天鵝終於像天鵝了，謝謝一直幫我加油的人。', share: '第三名！你是第一個知道的', photo_tag: 'latte' },
    ] },
  });
  const beats = (res.beats || []).slice(0, 6).filter(b => b.text);
  if (beats.length < 3) return null;
  const id = db.prepare('INSERT INTO arcs (rel_id,title,premise,beats,step,next_at,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(rel.id, res.title.slice(0, 30), res.premise.slice(0, 120), JSON.stringify(beats), 0, now(), now()).lastInsertRowid;
  logEvent(rel.user_id, 'arc_start', { rel: rel.id });
  return db.prepare('SELECT * FROM arcs WHERE id=?').get(id);
}

// 他有空的時候才推進（下班後、休假），一天一段
function freeNow(persona) {
  const st = charStatus(persona).code;
  const m = taipeiParts().minutes;
  return ['free', 'commute_out'].includes(st) && m >= 11 * 60 && m < 22 * 60 + 30;
}
function nextDayAt() {
  const t = taipeiParts();
  return now() + (24 * 60 - t.minutes + 11 * 60) * 60000; // 明天 11:00 之後
}

/** Called by the scheduler on every tick. Returns a share line (for a follow-up message) or null. */
export async function tickArc(rel, persona) {
  try {
    let a = activeArc(rel.id);
    if (!a) {
      if (rel.stage < 1 && now() - rel.created_at < 2 * 864e5) return null;      // 剛認識兩天內先不演
      const last = db.prepare('SELECT ended_at FROM arcs WHERE rel_id=? ORDER BY id DESC LIMIT 1').get(rel.id);
      if (last && now() - (last.ended_at || now()) < 2 * 864e5) return null;   // 上一件事結束後休息兩天
      if (!freeNow(persona) || Math.random() > 0.05) return null;
      a = await createArc(rel, persona);
      if (!a) return null;
    }
    if (a.next_at > now() || !freeNow(persona)) return null;
    const beats = j(a.beats, []);
    const b = beats[a.step];
    if (!b) { db.prepare(`UPDATE arcs SET status='done', ended_at=? WHERE id=?`).run(now(), a.id); return null; }
    addPost(rel, b.text, b.photo_tag, { story: !!b.photo_tag && Math.random() < 0.4 });
    addTold(rel.id, b.text.slice(0, 40));
    const last = a.step + 1 >= beats.length;
    db.prepare(`UPDATE arcs SET step=step+1, next_at=?, status=?, ended_at=? WHERE id=?`)
      .run(nextDayAt(), last ? 'done' : 'active', last ? now() : null, a.id);
    if (last) logEvent(rel.user_id, 'arc_end', { rel: rel.id });
    return b.share && rel.stage >= 1 ? b.share : null;
  } catch (e) {
    logIssue({ level: 'warn', source: 'arc', message: `連續劇推進失敗：${e.message}`, error: e, relId: rel.id });
    return null;
  }
}
