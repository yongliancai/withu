import { db, now, j } from './db.js';
import { jsonCall } from './llm.js';
import { logIssue } from './logger.js';

// ---------- 主題標籤 ----------
// 記憶和聊天片段都會貼上這些標籤；對方說話時先判斷在聊哪些主題，再優先找同主題的記憶。
export const MEM_TAGS = ['工作', '學業', '作息', '身體', '運動', '飲食', '興趣', '家人朋友', '感情', '心情', '計畫', '地點', '喜好', '討厭', '重要日子', '我們之間'];
const TAG_WORDS = {
  工作: /上班|下班|主管|老闆|同事|公司|客戶|加班|開會|提案|報告|業績|面試|工作|職場|離職|轉職|病房|店裡|值班|跑業務/,
  學業: /論文|報告|考試|上課|教授|學校|作業|研究|期末|期中|畢業|讀書/,
  作息: /睡|起床|熬夜|失眠|晚班|夜班|早班|輪班|補眠|鬧鐘|作息/,
  身體: /生病|感冒|頭痛|胃|累|不舒服|看醫生|過敏|受傷|痠|疼/,
  運動: /運動|健身|重訓|跑步|爬山|游泳|瑜珈|球|騎車/,
  飲食: /吃|喝|餓|早餐|午餐|晚餐|宵夜|咖啡|飲料|手搖|便當|甜點|餐廳/,
  興趣: /遊戲|動漫|追劇|電影|音樂|唱歌|吉他|看書|小說|畫|拍照|直播|原神|演唱會/,
  家人朋友: /媽|爸|家人|弟|妹|哥|姊|姐|朋友|室友|同學|閨蜜|兄弟/,
  感情: /喜歡你|交往|曖昧|前任|分手|約會|告白|男友|女友/,
  心情: /煩|難過|開心|生氣|壓力|焦慮|崩潰|累死|心情|想哭|委屈|好爽/,
  計畫: /想要|打算|計畫|下週|下個月|明天要|週末要|準備|目標|存錢|旅行|出國/,
  地點: /住在|搬家|台北|新北|台中|高雄|台南|桃園|新竹|捷運|附近/,
  重要日子: /生日|紀念日|節日|過年|聖誕|情人節/,
};
export function tagsOf(text = '') {
  return Object.entries(TAG_WORDS).filter(([, re]) => re.test(text)).map(([t]) => t);
}
const tagList = (x) => String(x || '').split(',').map(s => s.trim()).filter(Boolean);
const cleanTags = (arr) => [...new Set((arr || []).filter(t => MEM_TAGS.includes(t)))].slice(0, 3).join(',');

export const bigrams = (s = '') => {
  const t = s.replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
};

// Pick the memories worth bringing into this turn: weight, recency and overlap with what she just said.
export function selectMemories(relId, text = '', limit = 25) {
  const all = db.prepare(`SELECT * FROM memories WHERE rel_id=? AND kind != 'style' ORDER BY updated_at DESC`).all(relId);
  if (all.length <= limit) return all;
  const q = bigrams(text);
  const qt = tagsOf(text);
  const t = now();
  const scored = all.map(m => {
    let overlap = 0;
    if (q.size) for (const b of bigrams(m.content)) if (q.has(b)) overlap++;
    const tagHit = tagList(m.tags).filter(x => qt.includes(x)).length;
    const ageDays = (t - m.updated_at) / 864e5;
    const kindBoost = m.kind === 'anniversary' || m.kind === 'dislike' ? 1.5 : 0;
    return { m, s: m.weight * 2 + overlap * 1.5 + tagHit * 3 + kindBoost + Math.max(0, 3 - ageDays / 7) + (m.source === 'setting' ? 1 : 0) };
  });
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.m);
}

export function addMemory(rel, kind, content, weight = 1, source = 'real', tags = null) {
  content = String(content || '').trim().slice(0, 200);
  if (!content) return;
  const dup = content.length < 6
    ? db.prepare('SELECT * FROM memories WHERE rel_id=? AND content=?').get(rel.id, content)
    : db.prepare('SELECT * FROM memories WHERE rel_id=? AND (content=? OR (length(content)>=6 AND (instr(content, ?) > 0 OR instr(?, content) > 0)))')
      .get(rel.id, content, content, content);
  if (dup) {
    // Mentioned again → it matters more.
    db.prepare('UPDATE memories SET weight=MIN(weight+1, 10), content=?, updated_at=? WHERE id=?')
      .run(content.length > dup.content.length ? content : dup.content, now(), dup.id);
    return;
  }
  db.prepare('INSERT INTO memories (rel_id,user_id,kind,content,weight,source,created_at,updated_at,tags) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(rel.id, rel.user_id, kind, content, Math.max(1, Math.min(5, weight || 1)), source, now(), now(), cleanTags(tags?.length ? tags : tagsOf(content)) || null);
}

// ---------- 聊天片段（有標籤的對話摘要）----------
export function episodesFor(relId, text = '', limit = 4) {
  const qt = tagsOf(text);
  const rows = db.prepare('SELECT * FROM episodes WHERE rel_id=? ORDER BY id DESC LIMIT 200').all(relId);
  const recent = rows.slice(0, 2);
  const hits = qt.length ? rows.filter(e => tagList(e.tags).some(t => qt.includes(t))) : [];
  const pick = [...new Set([...hits.slice(0, limit), ...recent])].slice(0, limit);
  return pick.sort((a, b) => a.id - b.id);
}
export function episodesList(relId) {
  return db.prepare('SELECT id, from_id, to_id, summary, tags, created_at FROM episodes WHERE rel_id=? ORDER BY id DESC LIMIT 300').all(relId)
    .map(e => ({ ...e, tags: tagList(e.tags) }));
}

// ---------- 記憶整理 ----------
// 每聊幾輪，用便宜的模型把這段對話整理一次：挑出之後還用得到的事、刪掉只是當下狀態的、更新改變了的，
// 並把這段對話寫成一則有標籤的片段摘要。
const consolidating = new Set();
export async function consolidateMemories(rel, persona, user) {
  if (consolidating.has(rel.id)) return;
  const fresh = db.prepare('SELECT * FROM relationships WHERE id=?').get(rel.id);
  const msgs = db.prepare(`SELECT id, sender, kind, text FROM messages WHERE rel_id=? AND id>? AND sender IN ('user','char') AND text IS NOT NULL ORDER BY id LIMIT 60`).all(rel.id, fresh.mem_upto || 0);
  if (msgs.filter(m => m.sender === 'user').length < 4) return;
  consolidating.add(rel.id);
  try {
    const mems = db.prepare(`SELECT id, kind, content, tags FROM memories WHERE rel_id=? AND kind != 'style' AND source != 'setting' ORDER BY id`).all(rel.id);
    const transcript = msgs.map(m => `${m.sender === 'user' ? '對方' : persona.name}：${m.kind === 'sticker' ? '（貼圖）' : ''}${m.text}`).join('\n');
    const tagsSchema = { type: 'array', items: { type: 'string', enum: MEM_TAGS } };
    const res = await jsonCall({
      userId: rel.user_id, kind: 'memory', tier: 'cheap',
      instructions: `你在幫 ${persona.name}（AI 伴侶角色）整理他對「對方」（使用者，${user.call_name}）的記憶。看下面這段新的對話，更新記憶清單。

要記的（之後關心對方時用得到、幾天後還成立的事）：
- 對方的工作、職位、學校（例如「對方是醫院小夜班護理師」「對方做行銷，主管常挑提案」）
- 作息與班表（「對方通常凌晨三點才睡得著」）
- 正在煩惱或努力的事、近期的計畫（「對方在寫論文，卡在第三章」「對方想開始重訓，一週三天」「對方剛畢業，正在找工作」）
- 喜歡與討厭、興趣（「對方喜歡告五人」「對方會彈吉他，覺得自己彈得不好」）
- 重要的人（只寫對方說的稱呼）、住的區域、重要日子

不要記的：
- 只是當下的狀態（「現在在等車」「今天剛下班很累」「到台北了」）——除非它透露了長期的事（例如常常出差台中 → 記「對方是外勤業務，常跑台中」）
- ${persona.name}自己的事、你的推測、對方沒說過的事

規則：
- add：新的記憶，每條 25 字內、用「對方……」開頭，kind 照分類，tags 從清單挑 1–3 個，weight 1–5（越重要越高）。
- update：舊記憶有新進展或說法要修正時更新（填 id）。
- remove：清單裡只是「當下狀態」、已經過時或重複的記憶 id。
- episodes：把這段對話寫成 1–2 則片段摘要（每則 40 字內，用「對方…；${persona.name}…」的寫法，例如「對方被主管說提案太保守，${persona.name}陪對方吐槽」），各配 1–3 個標籤，讓之後可以依主題找回來。沒什麼內容就給空陣列。
只輸出 JSON。`,
      input: [{ role: 'user', content: `## 目前的記憶\n${mems.map(m => `[${m.id}]（${m.kind}${m.tags ? '｜' + m.tags : ''}）${m.content}`).join('\n') || '（沒有）'}\n\n## 新的對話\n${transcript}` }],
      schema: { type: 'object', additionalProperties: false, properties: {
        add: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          kind: { type: 'string', enum: ['like', 'dislike', 'schedule', 'area', 'person', 'event', 'anniversary', 'fact'] }, content: { type: 'string' }, tags: tagsSchema, weight: { type: 'number' } }, required: ['kind', 'content', 'tags', 'weight'] } },
        update: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'integer' }, content: { type: 'string' }, tags: tagsSchema }, required: ['id', 'content', 'tags'] } },
        remove: { type: 'array', items: { type: 'integer' } },
        episodes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { summary: { type: 'string' }, tags: tagsSchema }, required: ['summary', 'tags'] } },
      }, required: ['add', 'update', 'remove', 'episodes'] },
      schemaName: 'memory_consolidate',
      mock: { add: [], update: [], remove: [], episodes: [{ summary: `對方聊了今天的事；${persona.name}陪著聽`, tags: ['心情'] }] },
    });
    const ids = new Set(mems.map(m => m.id));
    for (const id of res.remove || []) if (ids.has(id)) db.prepare('DELETE FROM memories WHERE id=? AND rel_id=?').run(id, rel.id);
    for (const u of res.update || []) if (ids.has(u.id)) db.prepare('UPDATE memories SET content=?, tags=?, updated_at=? WHERE id=? AND rel_id=?').run(String(u.content).slice(0, 200), cleanTags(u.tags) || null, now(), u.id, rel.id);
    for (const a of (res.add || []).slice(0, 6)) addMemory(rel, a.kind, a.content, a.weight, 'real', a.tags);
    const from = msgs[0].id, to = msgs.at(-1).id;
    for (const e of (res.episodes || []).slice(0, 2)) {
      const sm = String(e.summary || '').trim().slice(0, 80);
      if (sm) db.prepare('INSERT INTO episodes (rel_id,from_id,to_id,summary,tags,created_at) VALUES (?,?,?,?,?,?)').run(rel.id, from, to, sm, cleanTags(e.tags) || null, now());
    }
    db.prepare('UPDATE relationships SET mem_upto=? WHERE id=?').run(to, rel.id);
  } catch (e) {
    logIssue({ level: 'warn', source: 'llm', message: `記憶整理失敗：${e.message}`, error: e, userId: rel.user_id, relId: rel.id });
  } finally {
    consolidating.delete(rel.id);
  }
}

export function correctMemory(rel, id, content) {
  // Corrections are remembered harder than anything else.
  db.prepare('UPDATE memories SET content=?, weight=MIN(weight+3, 10), updated_at=? WHERE id=? AND rel_id=?')
    .run(String(content).slice(0, 200), now(), id, rel.id);
}

export function forgetMemory(rel, id) {
  db.prepare('DELETE FROM memories WHERE id=? AND rel_id=?').run(id, rel.id);
}

// 相處習慣：對方明確要求過的說話／相處方式，每次都帶入
export function habitsOf(relId) {
  return db.prepare(`SELECT id, content FROM memories WHERE rel_id=? AND kind='style' ORDER BY id`).all(relId);
}

// 他自己講過的生活故事：避免重講同一件事
db.exec(`CREATE TABLE IF NOT EXISTS told (id INTEGER PRIMARY KEY AUTOINCREMENT, rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at INTEGER NOT NULL)`);
export function addTold(relId, content) {
  content = String(content || '').trim().slice(0, 60);
  if (!content) return;
  const dup = db.prepare('SELECT 1 FROM told WHERE rel_id=? AND content=?').get(relId, content);
  if (!dup) db.prepare('INSERT INTO told (rel_id,content,created_at) VALUES (?,?,?)').run(relId, content, now());
}
export function toldOf(relId, limit = 20) {
  return db.prepare('SELECT content FROM told WHERE rel_id=? ORDER BY id DESC LIMIT ?').all(relId, limit).map(r => r.content).reverse();
}

// 兩句話有多像（0–1）：用來抓「他又講了一樣的話」
export function similarity(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (A.size < 4 || B.size < 4) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}
