// 角色生活日誌：每個角色每天一則「今天的安排與發生的小事」，每個月整理成大事記。
// - 在背景寫好（排程每天早上），聊天時直接讀資料庫，不會拖慢回覆。
// - 聊天、動態、連續劇都參考同一份日誌，所以說的和發的會一致。
// - 寫新的一天或開新的連續劇前，會先看過去做過的事，避免繞回來重做。
import { db, now, j, logEvent } from './db.js';
import { jsonCall } from './llm.js';
import { personaBlock } from './prompt.js';
import { taipeiParts, toMin } from './characters.js';
import { worldContext } from './world.js';
import { logIssue } from './logger.js';

db.exec(`
CREATE TABLE IF NOT EXISTS life_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  day TEXT NOT NULL,            -- 台灣日期 YYYY-MM-DD
  items TEXT NOT NULL,          -- JSON：[{ time, text, tags }]
  summary TEXT NOT NULL,        -- 一句話總結這一天
  created_at INTEGER NOT NULL,
  UNIQUE (rel_id, day)
);
CREATE TABLE IF NOT EXISTS life_digest (
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  month TEXT NOT NULL,          -- YYYY-MM
  text TEXT NOT NULL,           -- 這個月的大事記（幾行）
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rel_id, month)
);`);

const TAGS = ['工作', '吃', '休閒', '運動', '家人朋友', '學習', '外出', '在家', '心情', '天氣', '節日', '連續劇'];

export function logFor(relId, day) {
  const r = db.prepare('SELECT * FROM life_log WHERE rel_id=? AND day=?').get(relId, day);
  return r ? { ...r, items: j(r.items, []) } : null;
}

/** 這個角色做過的事（給寫新一天、開新連續劇時避免重複）。 */
export function pastLife(relId, { days = 21 } = {}) {
  const logs = db.prepare('SELECT day, summary FROM life_log WHERE rel_id=? ORDER BY day DESC LIMIT ?').all(relId, days).reverse();
  const digests = db.prepare('SELECT month, text FROM life_digest WHERE rel_id=? ORDER BY month').all(relId);
  return { logs, digests };
}

/** 聊天時放進提示的生活內容：今天到現在發生的、等一下要做的、昨天、每月大事記。 */
export function lifeContext(relId) {
  const t = taipeiParts();
  const today = logFor(relId, t.date);
  const y = db.prepare('SELECT day, summary FROM life_log WHERE rel_id=? AND day<? ORDER BY day DESC LIMIT 2').all(relId, t.date);
  const digests = db.prepare('SELECT month, text FROM life_digest WHERE rel_id=? ORDER BY month DESC LIMIT 3').all(relId).reverse();
  const lines = [];
  if (today) {
    const done = today.items.filter(i => toMin(i.time) <= t.minutes);
    const later = today.items.filter(i => toMin(i.time) > t.minutes);
    if (done.length) lines.push(`今天到現在：${done.map(i => `${i.time} ${i.text}`).join('；')}`);
    if (later.length) lines.push(`今天等一下（還沒發生，不要說成已經做了）：${later.map(i => `${i.time} ${i.text}`).join('；')}`);
  }
  for (const d of y) lines.push(`${d.day}：${d.summary}`);
  for (const d of digests) lines.push(`${d.month} 大事記：${d.text}`);
  return lines;
}

const writing = new Set();
/** 寫今天的日誌（已經寫過就跳過）。 */
export async function writeToday(rel, persona) {
  const t = taipeiParts();
  if (logFor(rel.id, t.date) || writing.has(rel.id)) return null;
  writing.add(rel.id);
  try {
    await maybeDigest(rel, persona, t);
    const { logs, digests } = pastLife(rel.id);
    const arc = db.prepare(`SELECT title, premise, beats, step FROM arcs WHERE rel_id=? AND status='active' ORDER BY id DESC LIMIT 1`).get(rel.id);
    const world = await worldContext(persona, rel.id).catch(() => []);
    const s = persona.schedule || { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };
    const workday = s.days.includes(t.weekday);
    const res = await jsonCall({
      userId: rel.user_id, kind: 'lifelog', tier: 'cheap',
      instructions: `${personaBlock(persona)}

幫這個角色寫「今天（${t.date}，${'日一二三四五六'[t.weekday]}）」的生活安排，像他自己的手帳。
- ${workday ? `今天要上班：${s.start}–${s.end} 在${persona.workplace}。` : `今天休假（${persona.weekend || '在家休息'}）。`}起床、吃飯、通勤、下班後、睡前，時間要符合他的作息。
- 4–6 件事，依時間排序；每件 25 字內，具體、平凡、有畫面（例如「午休吃巷口的雞肉飯，老闆多給了一片滷蛋」）。至少一件是小插曲或小心情。
- 要符合今天的天氣、節日：${world.join('；') || '（沒有特別的）'}
${arc ? `- 他正在經歷「${arc.title}」（${arc.premise}），已經到第 ${arc.step} 段；今天可以有一件相關的小事，但不要自己編結果。` : ''}
- 不要和過去做過的事重複（可以是固定習慣，但細節要不同；特別的事不要再發生一次）：
${logs.map(l => `  ${l.day}：${l.summary}`).join('\n') || '  （還沒有）'}
${digests.map(d => `  ${d.month} 大事記：${d.text}`).join('\n')}
- 不要寫到和你聊天的那個人，也不要有戀愛、重病、意外。
- summary：一句話總結今天（30 字內）。
只輸出 JSON。`,
      input: [{ role: 'user', content: '寫今天' }],
      schema: { type: 'object', additionalProperties: false, properties: {
        items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          time: { type: 'string' }, text: { type: 'string' }, tags: { type: 'array', items: { type: 'string', enum: TAGS } } }, required: ['time', 'text', 'tags'] } },
        summary: { type: 'string' },
      }, required: ['items', 'summary'] },
      schemaName: 'lifelog',
      mock: { items: [
        { time: workday ? '08:10' : '09:30', text: '起床，窗外有點陰', tags: ['天氣'] },
        { time: '12:20', text: '午餐吃了巷口的雞肉飯', tags: ['吃'] },
        { time: workday ? s.end : '15:00', text: workday ? '下班路上看到很紅的夕陽' : '在家整理房間', tags: [workday ? '外出' : '在家'] },
        { time: '22:30', text: '洗完澡看了一集劇', tags: ['休閒'] },
      ], summary: workday ? '平凡的上班日，晚上看了一集劇' : '在家放空的休假日' },
    });
    const items = (res.items || []).filter(i => /^\d{1,2}:\d{2}$/.test(i.time) && i.text)
      .map(i => ({ time: i.time.padStart(5, '0'), text: String(i.text).slice(0, 50), tags: (i.tags || []).slice(0, 3) }))
      .sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6);
    if (!items.length) return null;
    db.prepare('INSERT OR IGNORE INTO life_log (rel_id,day,items,summary,created_at) VALUES (?,?,?,?,?)')
      .run(rel.id, t.date, JSON.stringify(items), String(res.summary || '').slice(0, 60), now());
    return items;
  } catch (e) {
    if (e.code !== 'budget_paused') logIssue({ level: 'warn', source: 'scheduler', message: `寫生活日誌失敗：${e.message}`, error: e, relId: rel.id });
    return null;
  } finally {
    writing.delete(rel.id);
  }
}

// 上個月有日誌、還沒整理成大事記：整理一次（之後每天的提示只要帶大事記，不用帶全部日誌）
async function maybeDigest(rel, persona, t) {
  const month = t.date.slice(0, 7);
  const prev = db.prepare(`SELECT DISTINCT substr(day,1,7) m FROM life_log WHERE rel_id=? AND substr(day,1,7)<? AND substr(day,1,7) NOT IN (SELECT month FROM life_digest WHERE rel_id=?) ORDER BY m`).all(rel.id, month, rel.id);
  for (const { m } of prev) {
    const days = db.prepare('SELECT day, summary FROM life_log WHERE rel_id=? AND substr(day,1,7)=? ORDER BY day').all(rel.id, m);
    const arcs = db.prepare(`SELECT title FROM arcs WHERE rel_id=? AND status='done' AND strftime('%Y-%m', created_at/1000, 'unixepoch', '+8 hours')=?`).all(rel.id, m).map(a => a.title);
    const res = await jsonCall({
      userId: rel.user_id, kind: 'lifedigest', tier: 'cheap',
      instructions: `${personaBlock(persona)}\n\n把這個角色 ${m} 的生活整理成「大事記」：3–6 行、每行 25 字內，只留下之後會記得、會影響他的事（完成了什麼、開始了什麼習慣、去了哪裡、發生的特別事）。日常重複的小事省略。只輸出 JSON。`,
      input: [{ role: 'user', content: `每天的總結：\n${days.map(d => `${d.day} ${d.summary}`).join('\n')}\n這個月經歷的事：${arcs.join('、') || '（無）'}` }],
      schema: { type: 'object', additionalProperties: false, properties: { lines: { type: 'array', items: { type: 'string' } } }, required: ['lines'] },
      schemaName: 'lifedigest',
      mock: { lines: [`${m}：上班、休假，過得平穩`] },
    });
    const text = (res.lines || []).map(x => String(x).trim()).filter(Boolean).slice(0, 6).join('；');
    if (text) db.prepare('INSERT OR REPLACE INTO life_digest (rel_id,month,text,created_at) VALUES (?,?,?,?)').run(rel.id, m, text, now());
    logEvent(rel.user_id, 'life_digest', { rel: rel.id, month: m });
  }
}

/** 排程用：早上 6 點後，最近 7 天有來聊天的人，幫他的角色寫今天的日誌。 */
export async function tickLife(rel, persona, user) {
  const t = taipeiParts();
  if (t.minutes < 6 * 60) return;
  if (!user.last_active_at || now() - user.last_active_at > 7 * 864e5) return;
  await writeToday(rel, persona);
}
