// 對話編排層：assemble persona + relationship + memories + recent chat, call the model,
// then apply everything the model decided (memories, stage, meal card, outing, follow-ups…).
import fs from 'node:fs';
import { detectConfusion } from './feedback.js';
import { ensurePortraits } from './portraits.js';
import { lifeContext } from './lifelog.js';
import { S } from './settings.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, now, j, logEvent } from './db.js';
import { config } from './config.js';
import { jsonCall, tts } from './llm.js';
import { BASE_RULES, personaBlock, contextBlock, TURN_SCHEMA, STAGES } from './prompt.js';
import { selectMemories, addMemory, correctMemory, forgetMemory, habitsOf, addTold, toldOf, similarity, consolidateMemories, episodesFor } from './memory.js';
import { buildMealCard, loadTrends } from './ordering.js';
import { crisisSignal, HELP_CARD } from './safety.js';
import { taipeiParts, JOBS } from './characters.js';
import { notify } from './push.js';
import { mockTurn } from './mock.js';
import { logIssue } from './logger.js';
import { pickPhoto } from './photos.js';
import { addPost } from './feed.js';
import { reviewOutgoing, gapLabel } from './review.js';
import { statusLine, postsVisibleTo } from './social.js';
import { worldContext } from './world.js';
import { arcContext } from './arcs.js';
import { updateUserPrefs, prefsLines } from './prefs.js';

export const id = (p = '') => p + crypto.randomBytes(9).toString('base64url');

export const ta = (p) => (p?.gender === 'female' ? '她' : '他');

// 原創貼圖（id → 名稱）
export const STICKERS = { hi: '嗨', ok: '好喔', love: '喜歡你', thanks: '謝謝', sorry: '對不起', night: '晚安', hungry: '好餓', cry: '哭哭', laugh: '笑死', hmph: '哼', shy: '害羞', cheer: '加油', hug: '抱抱', what: '？？', busy: '忙碌中', miss: '想你' };

export function getPersona(rel) {
  const c = db.prepare('SELECT * FROM characters WHERE id=?').get(rel.character_id);
  const p = j(c.persona, {});
  // 舊版建立的角色沒有這些欄位：從官方設定或職業補上
  if (!p.threads || p.signature === undefined || !p.look || !p.home || !p.birthday) {
    const t = c.template_id && db.prepare('SELECT data FROM templates WHERE id=?').get(c.template_id);
    const tf = t ? j(t.data, {}) : {};
    // 住哪一區、生日：官方角色從設定補；自己捏的依名字固定給一個
    let h = 0; for (const ch of String(p.name || c.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const TPE = ['台北市大安區', '台北市中山區', '台北市信義區', '台北市松山區', '台北市中正區', '新北市板橋區', '新北市永和區', '台北市內湖區'];
    p.home = p.home || tf.home || TPE[h % TPE.length];
    p.birthday = p.birthday || tf.birthday || `${String(1 + (h % 12)).padStart(2, '0')}-${String(1 + (h % 28)).padStart(2, '0')}`;
    p.threads = p.threads || tf.threads || JOBS[p.job]?.threads || [];
    if (p.signature === undefined) p.signature = tf.signature || '';
    p.look = p.look || tf.look;
  }
  // 對方是夜貓／輪班：一般角色也會晚一點睡
  const owl = !!j(db.prepare('SELECT settings FROM users WHERE id=?').get(rel.user_id)?.settings, {}).nightOwl;
  return { ...p, _owl: owl, _char: c };
}

export function addMessage(rel, sender, kind, { text = null, media = null, card = null, proactive = 0, reason = null } = {}) {
  const r = db.prepare(`INSERT INTO messages (rel_id,user_id,sender,kind,text,media,card,proactive,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(rel.id, rel.user_id, sender, kind, text, media, card ? JSON.stringify(card) : null, proactive, reason, now());
  if (sender === 'char') db.prepare('UPDATE relationships SET last_char_msg_at=? WHERE id=?').run(now(), rel.id);
  return r.lastInsertRowid;
}

const refreshRel = (relId) => db.prepare('SELECT * FROM relationships WHERE id=?').get(relId);

function historyInput(relId, latestImage) {
  const rows = db.prepare(`SELECT * FROM messages WHERE rel_id=? AND sender != 'system' ORDER BY id DESC LIMIT 30`).all(relId).reverse();
  const items = [];
  let prevAt = 0;
  for (const m of rows) {
    // 隔了很久的訊息標上時間，讓他知道中間過了多久
    const stamp = prevAt && m.created_at - prevAt > 90 * 60000 ? `［隔了 ${gapLabel(m.created_at - prevAt)}・${new Date(m.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}］` : '';
    prevAt = m.created_at;
    if (m.sender === 'char') {
      if (m.kind === 'card') continue;
      if (m.kind === 'sticker') { items.push({ role: 'assistant', content: `（傳了貼圖：${m.text}）` }); continue; }
      items.push({ role: 'assistant', content: m.text || '' });
    } else {
      let t = m.text || '';
      if (m.kind === 'voice') t = `（對方傳了語音）${t}`;
      if (m.kind === 'sticker') t = `（對方傳了貼圖：${t}）`;
      if (m.card && j(m.card)?.storyReply) t = `（回覆你的限時動態「${j(m.card).storyReply}」）${t}`;
      if (m.kind === 'photo' && !(latestImage && m.media === latestImage)) t = `（對方傳了一張照片）${t}`;
      if (m.kind === 'card') continue;
      items.push({ role: 'user', content: stamp + (t || '（照片）') });
    }
  }
  // Merge consecutive messages from the same side so the model sees clean turns.
  const merged = [];
  for (const it of items) {
    const last = merged[merged.length - 1];
    if (last && last.role === it.role) last.content += '\n' + it.content;
    else merged.push({ ...it });
  }
  if (latestImage) {
    const file = path.join(config.dataDir, 'uploads', path.basename(latestImage));
    if (fs.existsSync(file)) {
      const b64 = fs.readFileSync(file).toString('base64');
      const last = merged[merged.length - 1];
      const text = last && last.role === 'user' ? last.content : '';
      if (last && last.role === 'user') merged.pop();
      merged.push({ role: 'user', content: [
        { type: 'input_text', text: text || '（對方傳了一張照片）' },
        { type: 'input_image', image_url: `data:image/jpeg;base64,${b64}` },
      ] });
    }
  }
  return merged;
}

function otherCharsFor(rel) {
  return db.prepare(`SELECT r.id, r.stage, c.persona FROM relationships r JOIN characters c ON c.id=r.character_id
    WHERE r.user_id=? AND r.status='active' AND r.id != ?`).all(rel.user_id, rel.id)
    .map(r => ({ name: j(r.persona).name, relation: r.stage >= 3 ? '對方的戀人' : STAGES[r.stage] }));
}

export function loverOf(userId, exceptRelId) {
  const r = db.prepare(`SELECT r.id, c.persona FROM relationships r JOIN characters c ON c.id=r.character_id
    WHERE r.user_id=? AND r.status='active' AND r.stage>=3 AND r.id != ?`).get(userId, exceptRelId || '');
  return r ? j(r.persona).name : null;
}

function voicesToday(userId) {
  const t = taipeiParts();
  const start = Date.now() - (t.minutes * 60000);
  return db.prepare(`SELECT COUNT(*) n FROM messages WHERE user_id=? AND sender='char' AND kind='voice' AND created_at>=?`).get(userId, start).n;
}

const SAD = /累|難過|想哭|哭了|好煩|不開心|心情不好|壓力|崩潰|委屈|生病|不舒服/;

function lifeEventCount(relId) {
  return db.prepare(`SELECT COUNT(*) n FROM story WHERE rel_id=? AND type IN ('photo','travelogue')`).get(relId).n
    + db.prepare(`SELECT COUNT(*) n FROM events WHERE name='meal_choose' AND json_extract(data,'$.rel')=?`).get(relId).n;
}

function addStory(rel, type, { title = null, body = null, place = null, media = null } = {}) {
  return db.prepare('INSERT INTO story (rel_id,user_id,type,title,body,place,media,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(rel.id, rel.user_id, type, title, body, place, media ? JSON.stringify(media) : null, now()).lastInsertRowid;
}

function milestone(rel, title) {
  const exists = db.prepare(`SELECT 1 FROM story WHERE rel_id=? AND type='milestone' AND title=?`).get(rel.id, title);
  if (exists) return;
  addStory(rel, 'milestone', { title });
  if (rel.mode === 'practice') addMessage(rel, 'system', 'card', { card: { type: 'milestone', title } });
}

const STAGE_MILESTONE = [null, '你們成為朋友了', '你們之間，好像不只是朋友了', '你們在一起了', '你們成為彼此的長期伴侶'];

function setStage(rel, persona, user, stage) {
  db.prepare('UPDATE relationships SET stage=?, stage_changed_at=? WHERE id=?').run(stage, now(), rel.id);
  rel.stage = stage;
  if (STAGE_MILESTONE[stage]) milestone(rel, STAGE_MILESTONE[stage]);
  // 變曖昧了：他的生活照開始解鎖，還沒生成的在背景生成（官方角色共用，只做一次）
  if (stage === 2) ensurePortraits(persona._char, rel.user_id, { life: true });
  if (stage >= 2 && !persona._char.persona_locked) {
    // 定型：the shaped personality is locked into the core persona.
    db.prepare('UPDATE characters SET persona_locked=1 WHERE id=?').run(persona._char.id);
  }
  if (stage === 3) {
    db.prepare('INSERT INTO world_events (user_id,text,created_at) VALUES (?,?,?)')
      .run(rel.user_id, `${user.call_name}和${persona.name}開始交往了`, now());
    addMessage(rel, 'char', 'card', { card: { type: 'pin_request', text: '我可以當你的置頂嗎？' } });
  }
  logEvent(rel.user_id, 'stage_change', { rel: rel.id, stage });
}

// 關係進度的最短天數（從認識那天算）：再常聊也不會一天就變曖昧
function evaluateStage(rel, persona, user, out) {
  const sp = config.stageSpeed;
  const a = rel.affection, u = rel.understanding;
  const days = (now() - rel.created_at) / 864e5 * sp;
  const loverElsewhere = loverOf(rel.user_id, rel.id);
  if (rel.stage === 0 && days >= S('minDaysFriend') && a >= 18 / sp && u >= 6 / sp && rel.user_msg_count >= Math.ceil(8 / sp)) return setStage(rel, persona, user, 1);
  if (loverElsewhere) return; // only one lover at a time; others stay friends
  // 心情低落時認識的人：至少三天後才可能變曖昧
  if (rel.stage === 1 && j(rel.scenario, {}).friend_first && now() - rel.created_at < 3 * 864e5) return;
  if (rel.stage === 1 && days >= S('minDaysFlirt') && a >= 45 / sp && u >= 18 / sp && lifeEventCount(rel.id) >= 1) return setStage(rel, persona, user, 2);
  if (rel.stage === 2 && out.relationship_event === 'confession_accepted' && a >= 55) return setStage(rel, persona, user, 3);
  if (rel.stage === 3) {
    const days = (now() - (rel.stage_changed_at || now())) / 864e5;
    if (days >= 30 / sp && a >= 85 && u >= 55 / sp) return setStage(rel, persona, user, 4);
  }
  // Real mode: feelings can cool down.
  if (rel.mode === 'real' && rel.stage === 2 && a < 25) {
    db.prepare('UPDATE relationships SET stage=1 WHERE id=?').run(rel.id);
  }
}

async function endRelationship(rel, persona, user, reason) {
  db.prepare(`UPDATE relationships SET status='ended', pinned=0, ended_at=?, outing_active=0 WHERE id=?`).run(now(), rel.id);
  db.prepare('INSERT INTO world_events (user_id,text,created_at) VALUES (?,?,?)').run(rel.user_id, `${user.call_name}和${persona.name}分開了`, now());
  logEvent(rel.user_id, 'breakup', { rel: rel.id, reason });
  const recent = db.prepare(`SELECT title FROM story WHERE rel_id=? AND type='milestone' ORDER BY id`).all(rel.id).map(r => r.title);
  const mems = selectMemories(rel.id, '', 12).map(m => m.content);
  const res = await jsonCall({
    userId: rel.user_id, kind: 'letter', tier: 'good',
    instructions: `${personaBlock(persona)}\n\n你和${user.call_name}的關係結束了。用你的口吻寫一封告別信（150–250 字），回顧你們一起的時光，真誠、不怪罪、不挽留，祝福對方。只輸出 JSON。`,
    input: [{ role: 'user', content: `你們的里程碑：${recent.join('、') || '（不多）'}\n你記得的事：${mems.join('；') || '（不多）'}` }],
    schema: { type: 'object', additionalProperties: false, properties: { letter: { type: 'string' } }, required: ['letter'] },
    schemaName: 'letter',
    mock: { letter: `${user.call_name}：\n謝謝你這段時間的陪伴。我會記得我們聊過的每一個晚上。祝你一切都好。\n——${persona.name}` },
  });
  addStory(rel, 'letter', { title: `${persona.name}留給你的信`, body: res.letter });
  addMessage(rel, 'system', 'card', { card: { type: 'ended', text: `你和${persona.name}的關係結束了。${ta(persona)}留下了一封信，收在「我們的故事」裡。` } });
}

export async function finishOuting(rel, persona, user) {
  if (!rel.outing_active) return;
  const since = rel.outing_started_at || now() - 3 * 3600e3;
  db.prepare('UPDATE relationships SET outing_active=0, outing_started_at=NULL WHERE id=?').run(rel.id);
  const msgs = db.prepare(`SELECT sender, kind, text, media FROM messages WHERE rel_id=? AND created_at>=? AND sender!='system' ORDER BY id`).all(rel.id, since);
  const photos = msgs.filter(m => m.kind === 'photo' && m.media).map(m => m.media);
  const places = db.prepare(`SELECT DISTINCT place FROM story WHERE rel_id=? AND type='photo' AND place IS NOT NULL AND created_at>=?`).all(rel.id, since).map(r => r.place);
  const transcript = msgs.filter(m => m.text).map(m => `${m.sender === 'user' ? '對方' : '你'}：${m.text}`).join('\n').slice(-4000);
  const res = await jsonCall({
    userId: rel.user_id, kind: 'travelogue', tier: 'good',
    instructions: `${personaBlock(persona)}\n\n你們剛結束一起出遊。用你的口吻整理今天的遊記：title（10 字內）、body（你的感想，80–150 字，提到具體的片段）。只輸出 JSON。`,
    input: [{ role: 'user', content: `去過的地方：${places.join('、') || '（沒有說）'}\n今天的對話：\n${transcript || '（很少）'}` }],
    schema: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] },
    schemaName: 'travelogue',
    mock: { title: '一起出門的一天', body: `今天跟${user.call_name}一起走了好多路，看到你分享的風景，覺得好像真的在你身邊。下次也帶我去吧。` },
  });
  const sid = addStory(rel, 'travelogue', { title: res.title, body: res.body, place: places.join('、') || null, media: photos });
  addMessage(rel, 'system', 'card', { card: { type: 'travelogue', storyId: sid, title: res.title } });
}

// 個性形塑：看「他說了什麼」以及「對方怎麼回應」。
// 鎖定前（認識、朋友期）每 15 則更新長出來的個性與偏好；鎖定後每 30 則只更新偏好（多一點／少一點），核心性格不變。
const LAUGH = /哈哈|笑死|XD|xd|😂|🤣|好好笑|噗/;
const COLD = /^(嗯+|喔+|哦+|好|ok|OK|是喔|還好)[。.!！]?$/;
const PUSHBACK = /不要這樣|別這樣|不要再|別再|好煩|很煩|有點尷尬|不喜歡你這樣|好油|太油/;
function reactionPairs(relId) {
  const rows = db.prepare(`SELECT sender, text FROM messages WHERE rel_id=? AND sender IN ('user','char') AND kind IN ('text','voice') ORDER BY id DESC LIMIT 80`).all(relId).reverse();
  const pairs = [];
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].sender !== 'char' || rows[i + 1].sender !== 'user') continue;
    let k = i; while (k > 0 && rows[k - 1].sender === 'char') k--;      // whole burst of his bubbles
    const his = rows.slice(k, i + 1).map(r => r.text).join(' / ');
    const her = rows[i + 1].text || '';
    const tags = [];
    if (her.length >= 30) tags.push('回得很長');
    if (LAUGH.test(her)) tags.push('笑了');
    if (/[?？]/.test(her)) tags.push('主動延續話題');
    if (COLD.test(her.trim())) tags.push('冷淡帶過');
    if (PUSHBACK.test(her)) tags.push('明確不喜歡');
    pairs.push(`他：${his.slice(0, 120)}\n對方：${her.slice(0, 120)}${tags.length ? `（${tags.join('、')}）` : ''}`);
  }
  return pairs.slice(-24);
}

async function maybeShapePersona(rel, persona) {
  const c = persona._char;
  const every = c.persona_locked ? 30 : 15;
  if (rel.user_msg_count - c.shaped_at_count < every) return;
  db.prepare('UPDATE characters SET shaped_at_count=? WHERE id=?').run(rel.user_msg_count, c.id);
  const pairs = reactionPairs(rel.id);
  if (pairs.length < 4) return;
  const lockedNote = c.persona_locked ? '核心性格已經定型，emergent 請原樣回傳既有描述，不要改。' : '';
  const res = await jsonCall({
    userId: rel.user_id, kind: 'shape', tier: 'cheap',
    instructions: `以下是角色${persona.name}和對方最近的對話片段，括號是對方的反應訊號。請整理：
1. emergent：用 2–4 句描述他在相處中長出來的個性（幽默感、說話節奏、小習慣），往對方反應好的方向調整，但不能違背原本設定。${lockedNote}
2. more：對方反應好的說話或分享方式（回得長、笑了、主動延續），最多 4 條，每條 20 字內。
3. less：對方冷淡帶過或明確不喜歡的說法，最多 4 條，每條 20 字內。
只描述他的說話方式，不寫對方的任何個人資訊。沒有明顯訊號就回空陣列。只輸出 JSON。
原本設定：${persona.traits}；原型 ${persona.archetype}
既有描述：${persona.emergent || '（無）'}
既有偏好：多一點 ${JSON.stringify(persona.tuning?.more || [])}；少一點 ${JSON.stringify(persona.tuning?.less || [])}`,
    input: [{ role: 'user', content: pairs.join('\n\n').slice(-5000) }],
    schema: { type: 'object', additionalProperties: false, properties: {
      emergent: { type: 'string' },
      more: { type: 'array', items: { type: 'string' } },
      less: { type: 'array', items: { type: 'string' } },
    }, required: ['emergent', 'more', 'less'] },
    schemaName: 'shape',
    mock: { emergent: persona.emergent || '熟了以後會開一些冷笑話，記得對方說過的小事。', more: ['分享工作上的趣事'], less: ['一直問問題'] },
  });
  const p = j(c.persona);
  if (!c.persona_locked) p.emergent = res.emergent.slice(0, 400);
  p.tuning = { more: res.more.slice(0, 4).map(s => s.slice(0, 30)), less: res.less.slice(0, 4).map(s => s.slice(0, 30)), at: now() };
  db.prepare('UPDATE characters SET persona=? WHERE id=?').run(JSON.stringify(p), c.id);
  // 也更新「這個人喜歡的相處方式」，之後認識的人會照著用
  await updateUserPrefs(rel.user_id);
}

const SHORT = /^(嗯+|喔+|哦+|好+|ok|OK|是喔|還好|對啊|對|哈+|哈哈+|笑死|XD+|xd+|😂+|🤣+|👍|真的|是哦|好喔|沒事)[。.!！~～]*$/;
function lowEffortStreak(relId) {
  const rows = db.prepare(`SELECT text FROM messages WHERE rel_id=? AND sender='user' AND kind='text' ORDER BY id DESC LIMIT 2`).all(relId);
  return rows.length === 2 && rows.every(r => { const t = (r.text || '').trim(); return t.length <= 3 || SHORT.test(t); });
}

// 較早的對話：每 30 則整理一次摘要，讓他記得比最近 30 則更久以前的事
async function maybeSummarize(rel) {
  if (rel.user_msg_count - (rel.summary_count || 0) < 30) return;
  db.prepare('UPDATE relationships SET summary_count=? WHERE id=?').run(rel.user_msg_count, rel.id);
  const rows = db.prepare(`SELECT sender, text FROM messages WHERE rel_id=? AND sender IN ('user','char') AND text IS NOT NULL ORDER BY id DESC LIMIT 150 OFFSET 30`).all(rel.id).reverse();
  if (rows.length < 10) return;
  const persona = getPersona(rel);
  const res = await jsonCall({
    userId: rel.user_id, kind: 'summary', tier: 'cheap',
    instructions: `把角色${persona.name}和對方較早的聊天整理成「你們之前聊過的事」，給${persona.name}自己看。用條列短句（每條 25 字內，最多 10 條），寫具體的事：聊過的話題、對方說過的近況與心情、你們約定的事、${persona.name}講過的自己的事和進展。新的摘要要合併舊摘要，過時的事可以刪掉。不寫對方的全名、電話、地址。只輸出 JSON。`,
    input: [{ role: 'user', content: `舊摘要：\n${rel.summary || '（無）'}\n\n較早的對話：\n${rows.map(r => `${r.sender === 'user' ? '對方' : persona.name}：${r.text}`).join('\n').slice(-6000)}` }],
    schema: { type: 'object', additionalProperties: false, properties: { summary: { type: 'string' } }, required: ['summary'] },
    schemaName: 'summary',
    mock: { summary: `${rel.summary ? rel.summary + '\n' : ''}- 聊過彼此今天的工作和晚餐` },
  });
  db.prepare('UPDATE relationships SET summary=? WHERE id=?').run(res.summary.slice(0, 900), rel.id);
}

// 他最近說過的話（用來抓重複）
function recentCharTexts(relId) {
  return db.prepare(`SELECT text FROM messages WHERE rel_id=? AND sender='char' AND kind IN ('text','voice') AND text IS NOT NULL ORDER BY id DESC LIMIT 40`).all(relId).map(r => r.text);
}
const STYLE_ASK = /(不要|別|少|不用)(再|一直|老是|每次都|那麼常)?(問|叫我|說|講|傳|提|用)|換你(說|講|聊|分享)|回(短|長|快|慢)一點|(可以|能不能|拜託)(溫柔|簡短|直接|多說|少問|多分享)|(太|好)(油|肉麻|囉嗦|官方|客套)了/;

// 他今天聊過自己的哪些事：同一件事一天講太多次就換話題
db.exec(`CREATE TABLE IF NOT EXISTS self_topics (rel_id TEXT NOT NULL, day TEXT NOT NULL, topic TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (rel_id, day, topic))`);
const tpeDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
function selfTopicsToday(relId) {
  return db.prepare('SELECT topic, n FROM self_topics WHERE rel_id=? AND day=? ORDER BY n DESC').all(relId, tpeDay());
}
function addSelfTopic(relId, topic) {
  topic = String(topic || '').trim().slice(0, 8);
  if (!topic) return;
  db.prepare('INSERT INTO self_topics (rel_id,day,topic,n) VALUES (?,?,?,1) ON CONFLICT(rel_id,day,topic) DO UPDATE SET n=n+1').run(relId, tpeDay(), topic);
}

function findRepeat(texts, recent) {
  for (const t of texts) for (const r of recent) if (t.length >= 10 && similarity(t, r) >= 0.6) return { now: t, before: r };
  // 換句話說但講同一件事（例如連三次「被學長抓去改病歷」）：最近的話裡出現同一段 7 個字以上
  const clean = (x) => String(x).replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '');
  const near = recent.slice(0, 15).map(clean);
  for (const t of texts) {
    const c = clean(t);
    for (let i = 0; i + 7 <= c.length; i++) {
      const w = c.slice(i, i + 7);
      const hit = near.findIndex(r => r.includes(w));
      if (hit >= 0) return { now: t, before: recent[hit] };
    }
  }
  return null;
}

/**
 * One exchange. Either `userText`/`imageMedia` (she sent something) or `trigger` (he reaches out).
 * Returns the list of new message ids.
 */
export async function runTurn({ user, relId, userText = '', imageMedia = null, trigger = null, triggerKey = null, voiceMoment = false, lateReply = null, notifyUser = false, callMode = false }) {
  let rel = refreshRel(relId);
  if (!rel || rel.status !== 'active') throw new Error('relationship not active');
  const persona = getPersona(rel);
  const before = db.prepare('SELECT MAX(id) m FROM messages WHERE rel_id=?').get(rel.id).m || 0;

  const t = taipeiParts();
  const crisis = !trigger && crisisSignal(userText);
  const dueFollowups = db.prepare('SELECT * FROM followups WHERE rel_id=? AND done=0 AND due_at<=? ORDER BY due_at LIMIT 3').all(rel.id, now());
  // 對方說「什麼意思」「聽不懂」：上一句他說得不自然，記成語感回饋（有同意的人才記）
  if (userText && !trigger) { try { detectConfusion(user, rel.id, userText); } catch { /* ignore */ } }
  // 對方明確說了希望怎麼聊（「不要一直問我問題」「換你說」）：不靠模型，系統直接記成相處習慣，並馬上告訴其他角色
  if (userText && !trigger && STYLE_ASK.test(userText)) {
    addMemory(rel, 'style', `對方希望：${userText.replace(/\s+/g, ' ').slice(0, 40)}`, 5);
    updateUserPrefs(rel.user_id, { force: true }).catch(e => logIssue({ level: 'warn', source: 'llm', message: `相處偏好整理失敗：${e.message}`, error: e, userId: rel.user_id, relId: rel.id }));
  }
  const memories = selectMemories(rel.id, userText);
  const worldEvents = db.prepare('SELECT text FROM world_events WHERE user_id=? ORDER BY id DESC LIMIT 6').all(rel.user_id);
  const lover = loverOf(rel.user_id, rel.id);
  const canConfess = rel.stage === 2 && rel.affection >= 70 && !lover;
  const todayMealProposed = rel.meal_proposed_date === t.date;
  const voiceAllowed = !callMode && rel.stage >= 1 && voicesToday(rel.user_id) < config.voiceDailyCap &&
    (voiceMoment || crisis || SAD.test(userText) || /語音/.test(userText));

  const tier = (crisis || canConfess || triggerKey === 'FIRST' || (rel.stage >= 2 && userText.length > 60) || SAD.test(userText)) ? 'good' : 'cheap';

  const instructions = `${BASE_RULES}\n\n${personaBlock(persona)}`;
  const input = historyInput(rel.id, imageMedia);
  const activity = j(rel.activity);
  const world = await worldContext(persona, rel.id);
  const arc = arcContext(rel.id);
  input.push({ role: 'developer', content: contextBlock({
    userLen: [...String(userText || '').replace(/（[^）]*）/g, '').replace(/\s+/g, '')].length,
    prefs: prefsLines(rel.user_id),
    world, arc, goals: db.prepare(`SELECT title, days, done FROM goals WHERE rel_id=? AND status='active'`).all(rel.id).map(g => `${g.title}（做到 ${j(g.done, []).length}/${g.days} 天）`),
    episodes: episodesFor(rel.id, userText).map(e => `${new Date(e.created_at).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' })}${e.tags ? `（${e.tags}）` : ''} ${e.summary}`),
    selfTopics: selfTopicsToday(rel.id),
    life: lifeContext(rel.id), callMode,
    habits: habitsOf(rel.id), notes: db.prepare('SELECT text FROM notes WHERE rel_id=? AND done=0 ORDER BY id DESC LIMIT 10').all(rel.id).map(n => n.text), told: toldOf(rel.id), summary: rel.summary || '', lateReply, activity,
    lowEffort: !trigger && lowEffortStreak(rel.id),
    userStatus: statusLine(db.prepare('SELECT * FROM users WHERE id=?').get(rel.user_id) || user), userPosts: postsVisibleTo(rel),
    lastTimes: db.prepare(`SELECT MAX(CASE WHEN sender='user' THEN created_at END) u, MAX(CASE WHEN sender='char' THEN created_at END) c FROM messages WHERE rel_id=? AND id<=?`).get(rel.id, before),
    rel, persona, user, memories, worldEvents, otherChars: otherCharsFor(rel), trends: loadTrends(),
    dueFollowups, trigger, crisis, todayMealProposed, voiceAllowed, canConfess, loverElsewhere: lover, photoAttached: !!imageMedia,
  }) });

  const call = () => jsonCall({
    userId: rel.user_id, kind: trigger ? 'proactive' : 'chat', tier, instructions, input, essential: !!crisis,
    schema: TURN_SCHEMA, schemaName: 'turn', cacheKey: `persona:${persona._char.id}`,
    mock: () => mockTurn({ rel, persona, user, userText, imageMedia, trigger: triggerKey === 'FIRST' ? 'FIRST' : trigger, todayMealProposed, crisis, lateReply }),
  });
  let out = await call();
  // 重複偵測：跟他最近說過的話太像就重寫一次
  const rep = findRepeat((out.messages || []).map(m => String(m.text || '')), recentCharTexts(rel.id));
  if (rep) {
    logIssue({ level: 'auto', source: 'llm', message: '角色重複說了類似的話，已自動重寫', detail: { now: rep.now, before: rep.before, trigger: triggerKey }, userId: rel.user_id, relId: rel.id });
    input.push({ role: 'developer', content: `你剛剛想說「${rep.now}」，但這跟你之前說過的「${rep.before}」太像了。換一個說法，或聊新的東西、說新的進展。` });
    try { out = await call(); } catch { /* keep the first answer */ }
  }
  // 發送前檢查：主動訊息、晚回的訊息要對得上現在的時間和最近的對話
  if ((trigger || lateReply) && !['FIRST', 'reunion'].includes(triggerKey) && !String(triggerKey || '').startsWith('nudge')) {
    const draft = (out.messages || []).map(m => String(m.text || '').trim()).filter(Boolean);
    if (draft.length) {
      const rv = await reviewOutgoing({ rel, persona, user, texts: draft, triggerKey, lateReply });
      if (rv.action === 'skip') {
        // 這次不傳：要跟進的事延後兩小時再看
        for (const f of dueFollowups) db.prepare('UPDATE followups SET due_at=? WHERE id=?').run(now() + 2 * 3600e3, f.id);
        return [];
      }
      if (rv.action === 'rewrite') { out.messages = rv.messages.slice(0, 3).map(text => ({ text })); out.sticker = null; }
    }
  }

  // 講電話時：不傳語音檔、貼圖、建議回覆、點餐卡（由通話自己把文字念出來）
  if (callMode) { out.voice = false; out.sticker = null; out.suggestions = []; out.meal = null; out.choice = null; out.goal = null; out.postcard = null; }

  // ---------- apply ----------
  rel = refreshRel(relId);
  const isProactive = trigger && !lateReply && !String(triggerKey || '').startsWith('nudge') ? 1 : 0;
  if (!trigger || lateReply) db.prepare(`UPDATE relationships SET char_read_id=(SELECT COALESCE(MAX(id),0) FROM messages WHERE rel_id=? AND sender='user'), pending_reply_at=NULL WHERE id=?`).run(rel.id, rel.id);
  // 一則泡泡裡有換行就拆成兩則（像真人分開傳）
  let texts = (out.messages || []).flatMap(m => String(m.text || '').split(/\n+/)).map(x => x.trim()).filter(Boolean).slice(0, 4);
  // 剛認識最多 2 則、朋友最多 3 則（第一次相遇、危機、講電話例外）：超過就保留開頭和最後一則
  const maxB = crisis || callMode || triggerKey === 'FIRST' ? 4 : rel.stage === 0 ? 2 : rel.stage === 1 ? 3 : 4;
  if (texts.length > maxB) texts = [...texts.slice(0, maxB - 1), texts.at(-1)];
  if (!texts.length && !out.meal && !out.postcard) logIssue({ level: 'warn', source: 'llm', message: '角色這一輪沒有回任何話', detail: { trigger: triggerKey, tier, userText: userText ? userText.slice(0, 200) : null }, userId: rel.user_id, relId: rel.id });
  if (out.voice && voiceAllowed && texts.length) {
    const joined = texts.join(' ');
    let media = null;
    try {
      const buf = await tts({ userId: rel.user_id, text: joined, voice: persona.voice || 'cedar',
        instructions: `用台灣口音的中文，${persona.gender === 'female' ? '女性' : '男性'}，自然、像對親近的人說話，語氣符合：${persona.traits}` });
      if (buf) { media = `${id('a_')}.mp3`; fs.writeFileSync(path.join(config.dataDir, 'audio', media), buf); }
    } catch (e) { /* logged in llm.js; fall back to text */ }
    if (media) addMessage(rel, 'char', 'voice', { text: joined, media, proactive: isProactive, reason: triggerKey });
    else texts.forEach(tx => addMessage(rel, 'char', 'text', { text: tx, proactive: isProactive, reason: triggerKey }));
  } else {
    texts.forEach(tx => addMessage(rel, 'char', 'text', { text: tx, proactive: isProactive, reason: triggerKey }));
  }

  // 好感一天最多加 affDailyCap（後台可調）：聊再多，感情也要靠時間慢慢累積
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  const gainedToday = rel.aff_day === today ? rel.aff_gain || 0 : 0;
  let delta = Math.max(-10, Math.min(5, out.affection_delta || 0));
  if (delta > 0) delta = Math.max(0, Math.min(delta, Math.round(S('affDailyCap') * config.stageSpeed) - gainedToday));
  const aff = Math.max(0, Math.min(100, rel.affection + delta));
  const und = Math.max(0, Math.min(100, rel.understanding + Math.max(0, Math.min(3, out.understanding_delta || 0))));
  db.prepare('UPDATE relationships SET affection=?, understanding=?, aff_day=?, aff_gain=? WHERE id=?').run(aff, und, today, gainedToday + Math.max(0, delta), rel.id);
  rel.affection = aff; rel.understanding = und;

  for (const m of out.memories_add || []) addMemory(rel, m.kind, m.content, m.weight);
  if ((out.memories_add || []).some(m => m.kind === 'style')) {
    updateUserPrefs(rel.user_id, { force: true }).catch(e => logIssue({ level: 'warn', source: 'llm', message: `相處偏好整理失敗：${e.message}`, error: e, userId: rel.user_id, relId: rel.id }));
  }
  for (const m of out.memories_correct || []) correctMemory(rel, m.id, m.content);
  for (const mid of out.memories_forget || []) forgetMemory(rel, mid);

  for (const f of dueFollowups) db.prepare('UPDATE followups SET done=1 WHERE id=?').run(f.id);
  for (const f of out.followups || []) {
    const mins = Math.max(10, Math.min(7 * 24 * 60, f.in_minutes));
    db.prepare('INSERT INTO followups (rel_id,due_at,topic) VALUES (?,?,?)').run(rel.id, now() + mins * 60000, f.topic.slice(0, 120));
  }
  if (out.user_busy_until_minutes && !trigger) {
    const mins = Math.max(10, Math.min(8 * 60, out.user_busy_until_minutes));
    db.prepare('UPDATE relationships SET user_busy_until=? WHERE id=?').run(now() + mins * 60000, rel.id);
    if (!(out.followups || []).length) db.prepare('INSERT INTO followups (rel_id,due_at,topic) VALUES (?,?,?)')
      .run(rel.id, now() + (mins + 5) * 60000, '對方剛剛在忙，問對方順不順利、累不累');
  }
  // 明信片：對方拍的風景照，或他寄來的風景
  if (out.postcard && out.postcard.message) {
    const pc = out.postcard;
    const message = pc.message.slice(0, 80), place = (pc.place || '').slice(0, 30) || null;
    const photoCardToday = db.prepare(`SELECT 1 FROM story WHERE rel_id=? AND type='postcard' AND scene IS NULL AND created_at>?`).get(rel.id, now() - 20 * 3600e3);
    if (pc.scene === 'photo' && imageMedia && !photoCardToday) {
      const sid = db.prepare('INSERT INTO story (rel_id,user_id,type,title,body,place,media,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(rel.id, rel.user_id, 'postcard', '你拍的明信片', message, place, JSON.stringify([imageMedia]), now()).lastInsertRowid;
      addMessage(rel, 'char', 'card', { card: { type: 'postcard', storyId: sid, media: `/api/media/${imageMedia}`, message, place, from: 'you' } });
    } else if (pc.scene !== 'photo' && trigger) {
      const photo = pickPhoto(pc.scene);
      const sid = db.prepare('INSERT INTO story (rel_id,user_id,type,title,body,place,scene,photo_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(rel.id, rel.user_id, 'postcard', `${persona.name}寄來的明信片`, message, place, pc.scene, photo?.id || null, now()).lastInsertRowid;
      addMessage(rel, 'char', 'card', { card: { type: 'postcard', storyId: sid, scene: pc.scene, photo, message, place, from: 'him' } });
    }
  }
  // 個性簽名：最多一天換一次
  if (out.signature) {
    const c = db.prepare('SELECT persona FROM characters WHERE id=?').get(persona._char.id);
    const p = j(c.persona, {});
    if (!p.signature_at || now() - p.signature_at > 20 * 3600e3) {
      p.signature = out.signature.slice(0, 24); p.signature_at = now();
      db.prepare('UPDATE characters SET persona=? WHERE id=?').run(JSON.stringify(p), persona._char.id);
    }
  }
  // 生活動態：個人頁上的短文（每天幾則、間隔多久由後台設定）
  if (out.life_post) {
    addPost(rel, out.life_post.slice(0, 100), out.life_post_photo); // 共用關卡會決定要不要真的發
  }
  if (out.told) addTold(rel.id, out.told);
  if (out.self_topic) addSelfTopic(rel.id, out.self_topic);
  // 貼圖不洗版：最近 8 則裡他已經傳過貼圖就不傳
  // 貼圖不洗版：最近 5 輪（對方的 5 則訊息）內傳過就不傳；同一張一天一次；晚安貼圖只在對方要睡時
  const fifthUser = db.prepare(`SELECT id FROM messages WHERE rel_id=? AND sender='user' ORDER BY id DESC LIMIT 1 OFFSET ?`).get(rel.id, Math.max(0, S('stickerGapTurns') - 1))?.id || 0;
  const recentSticker = db.prepare(`SELECT 1 FROM messages WHERE rel_id=? AND sender='char' AND kind='sticker' AND id>?`).get(rel.id, fifthUser);
  const sameToday = out.sticker && db.prepare(`SELECT 1 FROM messages WHERE rel_id=? AND sender='char' AND kind='sticker' AND card LIKE ? AND created_at>?`).get(rel.id, `%"id":"${out.sticker}"%`, now() - 864e5);
  const badNight = out.sticker === 'night' && !/晚安|睡了|去睡|要睡|睡覺|先睡/.test(userText || '');
  if (out.sticker && STICKERS[out.sticker] && !recentSticker && !sameToday && !badNight) addMessage(rel, 'char', 'sticker', { text: STICKERS[out.sticker], card: { id: out.sticker }, proactive: isProactive, reason: triggerKey });
  // 出遊中的小插曲（一次出遊最多一次）
  if (out.choice && rel.outing_active && out.choice.options?.length >= 2 && !crisis) {
    const had = db.prepare(`SELECT 1 FROM messages WHERE rel_id=? AND kind='card' AND card LIKE '%"type":"choice"%' AND created_at>=?`).get(rel.id, rel.outing_started_at || 0);
    if (!had) addMessage(rel, 'char', 'card', { card: { type: 'choice', prompt: out.choice.prompt.slice(0, 50), options: out.choice.options.slice(0, 3).map(o => String(o).slice(0, 16)) } });
  }
  // 一起完成的小目標（同時只有一個）
  if (out.goal && !crisis && !db.prepare(`SELECT 1 FROM goals WHERE rel_id=? AND status='active'`).get(rel.id)
      && !db.prepare(`SELECT 1 FROM messages WHERE rel_id=? AND kind='card' AND card LIKE '%"type":"goal"%' AND created_at>?`).get(rel.id, now() - 3 * 864e5)) {
    addMessage(rel, 'char', 'card', { card: { type: 'goal', title: out.goal.title.slice(0, 20), days: Math.max(3, Math.min(14, out.goal.days || 7)) } });
  }
  if (out.note && !crisis) {
    const t = out.note.trim().slice(0, 40);
    if (t && !db.prepare('SELECT 1 FROM notes WHERE rel_id=? AND text=?').get(rel.id, t)) {
      db.prepare('INSERT INTO notes (rel_id,author,text,created_at) VALUES (?,?,?,?)').run(rel.id, 'char', t, now());
      addMessage(rel, 'system', 'card', { card: { type: 'note', text: t } });
    }
  }
  if (out.activity && !trigger && !activity) startActivity(rel, persona, out.activity);
  if (out.status_line) db.prepare('UPDATE relationships SET status_line=?, status_line_at=? WHERE id=?').run(out.status_line.slice(0, 40), now(), rel.id);

  // 他的小心情旁白：短、只寫他自己、很久才出現一次、代名詞對
  if (out.hint && rel.mode === 'practice' && !trigger) {
    const P = persona.gender === 'female' ? '她' : '他';
    let h = String(out.hint).trim().replace(/^[（(]|[）)]$/g, '').replace(/^[他她]/, P);
    const recentHint = db.prepare(`SELECT 1 FROM (SELECT kind, card FROM messages WHERE rel_id=? ORDER BY id DESC LIMIT 24) WHERE kind='card' AND card LIKE '%"type":"hint"%'`).get(rel.id);
    const meta = /對方|你|接住|話題|回覆|回應|帶過|先溫柔|順便/.test(h);
    if (h && h.length <= 18 && !meta && !recentHint) addMessage(rel, 'system', 'card', { card: { type: 'hint', text: h } });
  }

  if (out.meal && out.meal.options?.length >= 2 && !todayMealProposed && !crisis && now() - rel.created_at > 864e5) {
    addMessage(rel, 'char', 'card', { card: buildMealCard(out.meal.options) });
    db.prepare('UPDATE relationships SET meal_proposed_date=? WHERE id=?').run(t.date, rel.id);
    logEvent(rel.user_id, 'meal_propose', { rel: rel.id });
  }

  if (out.place_name) {
    const recentPhoto = db.prepare(`SELECT id FROM story WHERE rel_id=? AND type='photo' AND place IS NULL AND created_at>? ORDER BY id DESC LIMIT 1`).get(rel.id, now() - 45 * 60000);
    if (recentPhoto) db.prepare('UPDATE story SET place=? WHERE id=?').run(out.place_name.slice(0, 40), recentPhoto.id);
  }

  if (out.outing === 'start' && !rel.outing_active && !trigger) {
    db.prepare('UPDATE relationships SET outing_active=1, outing_started_at=? WHERE id=?').run(now(), rel.id);
    addMessage(rel, 'system', 'card', { card: { type: 'outing', state: 'start', text: `${persona.name}跟你一起出門了` } });
    logEvent(rel.user_id, 'outing_start', { rel: rel.id });
  } else if (out.outing === 'end' && rel.outing_active) {
    await finishOuting(refreshRel(rel.id), persona, user);
  }

  if (out.milestone && rel.stage >= 1) milestone(rel, out.milestone.slice(0, 40));
  if (out.relationship_event === 'reconciled') logEvent(rel.user_id, 'reconciled', { rel: rel.id });

  if (crisis || out.crisis) {
    const recentHelp = db.prepare(`SELECT 1 FROM messages WHERE rel_id=? AND kind='card' AND card LIKE '%"type":"help"%' AND created_at>?`).get(rel.id, now() - 3600e3);
    if (!recentHelp) addMessage(rel, 'system', 'card', { card: HELP_CARD });
    logEvent(rel.user_id, 'crisis', { rel: rel.id });
  } else {
    evaluateStage(rel, persona, user, out);
    if (out.relationship_event === 'breakup_proposed' && rel.mode === 'real' && rel.stage >= 2 && rel.affection < 20) {
      await endRelationship(rel, persona, user, 'his_choice');
    }
  }

  // 建議回覆：掛在這一輪他最後一則文字／語音訊息上
  const sugg = (out.suggestions || []).map(x => typeof x === 'string' ? { label: x.slice(0, 12), text: x } : { label: String(x.label || '').trim().slice(0, 10), text: String(x.text || '').trim().slice(0, 40) })
    .filter(x => x.label && x.text)
    // 站錯邊的建議（跟他自己說的話太像、或講到他自己的工作）拿掉
    .filter(x => {
      const mine = [...texts, ...recentCharTexts(rel.id).slice(0, 6)];
      if (mine.some(c => similarity(x.text, c) >= 0.45)) return false;
      const own = [persona.jobLabel, persona.workplace].filter(Boolean).map(w => String(w).replace(/[（(].*$/, ''));
      if (own.some(w => w.length >= 2 && x.text.includes(w) && !(userText || '').includes(w))) return false;
      return true;
    }).slice(0, 3);
  if (sugg.length >= 2 && !crisis && !out.crisis) {
    const last = db.prepare(`SELECT id FROM messages WHERE rel_id=? AND id>? AND sender='char' AND kind IN ('text','voice') ORDER BY id DESC LIMIT 1`).get(rel.id, before);
    if (last) db.prepare('UPDATE messages SET suggest=? WHERE id=?').run(JSON.stringify(sugg), last.id);
  }

  maybeSummarize(refreshRel(rel.id)).catch(err => logIssue({ level: 'warn', source: 'llm', message: `對話摘要失敗：${err.message}`, error: err, userId: rel.user_id, relId: rel.id }));
  if (!trigger || lateReply) consolidateMemories(refreshRel(rel.id), persona, user);
  maybeShapePersona(refreshRel(rel.id), persona).catch(err => logIssue({ level: 'warn', source: 'llm', message: `個性整理失敗：${err.message}`, error: err, userId: rel.user_id, relId: rel.id }));

  const fresh = db.prepare('SELECT * FROM messages WHERE rel_id=? AND id>? ORDER BY id').all(rel.id, before);
  if ((trigger || notifyUser) && fresh.length) {
    const first = fresh.find(m => m.sender === 'char' && m.text);
    if (first) notify(user, { name: persona.name, text: first.text, relId: rel.id }).catch(() => {});
  }
  return fresh;
}

// ---------- 一起做點什麼 ----------
const ACT_TEXT = { watch: '一起看', focus: '陪你專心', bedtime: '睡前聊聊' };
export function startActivity(rel, persona, a) {
  const minutes = Math.max(5, Math.min(180, Number(a.minutes) || (a.type === 'focus' ? 25 : a.type === 'bedtime' ? 40 : 120)));
  const act = { type: a.type, title: String(a.title || '').slice(0, 30), started_at: now(), ends_at: now() + minutes * 60000 };
  db.prepare('UPDATE relationships SET activity=? WHERE id=?').run(JSON.stringify(act), rel.id);
  addMessage(rel, 'system', 'card', { card: { type: 'activity', state: 'start', act: a.type, title: act.title, endsAt: act.ends_at,
    text: `${persona.name}${ACT_TEXT[a.type] || '陪著你'}${act.title ? `：${act.title}` : ''}` } });
  logEvent(rel.user_id, 'activity_start', { rel: rel.id, type: a.type });
}

export async function endActivity(rel, user, { reason = 'user' } = {}) {
  const act = j(rel.activity);
  if (!act) return;
  db.prepare('UPDATE relationships SET activity=NULL WHERE id=?').run(rel.id);
  const persona = getPersona(rel);
  const minutes = Math.max(1, Math.round((now() - act.started_at) / 60000));
  addMessage(rel, 'system', 'card', { card: { type: 'activity', state: 'end', act: act.type, text: `${ACT_TEXT[act.type] || '一起'}結束了・${minutes} 分鐘` } });
  logEvent(rel.user_id, 'activity_end', { rel: rel.id, type: act.type, minutes, reason });
  const n = db.prepare(`SELECT COUNT(*) n FROM events WHERE name='activity_end' AND json_extract(data,'$.rel')=? AND json_extract(data,'$.type')=?`).get(rel.id, act.type).n;
  if (n === 1 && rel.stage >= 1) milestone(rel, { watch: '你們第一次一起看劇', focus: '你們第一次一起專心做事', bedtime: '你們第一次一起說晚安' }[act.type] || '你們第一次一起做一件事');
  if (act.type === 'focus') await runTurn({ user, relId: rel.id, trigger: `你陪對方專心了 ${minutes} 分鐘，時間到了。問問對方做得怎麼樣，稱讚對方的努力，提醒起來動一動、喝口水。`, triggerKey: 'focus_end', notifyUser: true });
  else if (act.type === 'watch' && reason === 'user') await runTurn({ user, relId: rel.id, trigger: `你們一起看完了${act.title ? `「${act.title}」` : ''}。用一兩句話聊聊你的感想，問對方最喜歡哪一段。`, triggerKey: 'watch_end' });
}

export { endRelationship, addStory, milestone };
