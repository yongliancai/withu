// 新用戶流程與相遇：scenario structuring, character creation, the opening scene, and 角色廣場 sharing.
import { db, now, j, logEvent } from './db.js';
import { config } from './config.js';
import { jsonCall, moderate } from './llm.js';
import { logIssue } from './logger.js';
import { JOBS, ARCHETYPES, SCENARIOS, OFFICIAL, frameFromOfficial, AVATAR_HUES } from './characters.js';
import { personaBlock } from './prompt.js';
import { addMemory } from './memory.js';
import { id, addMessage, runTurn, ta } from './engine.js';

export function seedOfficial() {
  // 新角色直接加入；已存在的只補上缺少的欄位，不覆蓋你在後台改過的設定。
  const get = db.prepare('SELECT data FROM templates WHERE id=?');
  const ins = db.prepare('INSERT INTO templates (id,kind,data,creator_name,created_at) VALUES (?,?,?,?,?)');
  const upd = db.prepare('UPDATE templates SET data=? WHERE id=?');
  for (const o of OFFICIAL) {
    const fresh = frameFromOfficial(o);
    const row = get.get(o.id);
    if (!row) { ins.run(o.id, 'official', JSON.stringify(fresh), '官方', now()); continue; }
    const cur = j(row.data, {});
    let changed = false;
    for (const [k, v] of Object.entries(fresh)) if (cur[k] === undefined) { cur[k] = v; changed = true; }
    if (changed) upd.run(JSON.stringify(cur), o.id);
  }
}

const HAIRS = { male: ['short', 'curly', 'side', 'part', 'messy'], female: ['long', 'wavy', 'bob', 'ponytail', 'bun'] };
function sanitizeLook(l = {}, gender) {
  const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d);
  return {
    hair: [...HAIRS.male, ...HAIRS.female].includes(l.hair) ? l.hair : HAIRS[gender][0],
    hairColor: hex(l.hairColor, '#2A2421'), skin: hex(l.skin, '#F1C9A6'), top: hex(l.top, '#E9EEF5'),
    accent: hex(l.accent, '#9AA7B8'), accessory: 'collar', glasses: !!l.glasses, style: l.style === 'anime' ? 'anime' : undefined,
  };
}

export function frameFromCustom(f) {
  const job = JOBS[f.job] || JOBS.engineer;
  const arch = ARCHETYPES[f.archetype] || ARCHETYPES.gentle_senior;
  return {
    name: String(f.name || '').slice(0, 12) || '未命名',
    gender: f.gender === 'female' ? 'female' : 'male',
    age: Math.max(20, Math.min(60, Number(f.age) || 28)),
    nationality: String(f.nationality || '台灣').slice(0, 12),
    job: f.job in JOBS ? f.job : 'engineer', jobLabel: job.label, workplace: job.place, schedule: job.schedule,
    archetype: f.archetype in ARCHETYPES ? f.archetype : 'gentle_senior',
    proactivity: ['clingy', 'independent', 'slow'].includes(f.proactivity) ? f.proactivity : 'slow',
    voice: String(f.voice || (f.gender === 'female' ? 'marin' : 'cedar')),
    hue: Number(f.hue) || AVATAR_HUES[Math.floor(Math.random() * AVATAR_HUES.length)],
    appearance: String(f.appearance || '').slice(0, 80),
    traits: arch.desc, catchphrases: [], values: '', weekend: '週末會休息，偶爾出門走走',
    intro: `${arch.label}的${job.label}`, emergent: '', signature: '', threads: job.threads || [],
    look: sanitizeLook(f.look, f.gender === 'female' ? 'female' : 'male'),
  };
}

const SCENE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    reason: { type: ['string', 'null'] },
    rewrite: { type: ['string', 'null'] },
    place: { type: 'string' }, time: { type: 'string' }, mood: { type: 'string' },
    implied_lover: { type: 'boolean' },
    start_type: { type: 'string', enum: ['stranger', 'friend'] },
    crush_hint: { type: 'boolean' },
    setting_memories: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'reason', 'rewrite', 'place', 'time', 'mood', 'implied_lover', 'start_type', 'crush_hint', 'setting_memories'],
};

// Turn the user's free text into a structured scene. Rejects real people / existing fictional IP / minors.
export async function structureScenario(userId, text, frame) {
  const mod = await moderate(text);
  const CAT = { 'sexual': '性相關的描寫', 'sexual/minors': '和未成年有關的內容', 'hate': '仇恨言論', 'hate/threatening': '仇恨或威脅', 'harassment/threatening': '威脅他人', 'violence/graphic': '太血腥的細節', 'self-harm/instructions': '自傷的描述', 'self-harm/intent': '自傷的描述', 'illicit/violent': '暴力犯罪的細節' };
  if (mod.flagged) {
    const why = [...new Set(mod.categories.map(c => CAT[c] || c))].join('、');
    logIssue({ level: 'warn', source: 'scenario', message: `相遇情境被內容審核擋下（${why}）`, detail: { text: text.slice(0, 300), categories: mod.all }, userId });
    return { ok: false, reason: `這段描述包含${why}，可以把那部分寫得含蓄一點再試試。`, rewrite: null };
  }
  const res = await jsonCall({
    userId, kind: 'scenario', tier: 'cheap',
    instructions: `把用戶寫的「相遇情境」轉成結構化場景。規則：
- 若內容是非人類或奇幻設定（吸血鬼、精靈、神明、異世界、魔法、穿越、機器人、虛擬偶像住在虛擬世界等），ok=false，reason 說明：這裡的角色都生活在現實的台灣，可以改寫成現實中的情境。
- 若內容要求扮演真實存在的人（明星、網紅、對方的前任）、現有小說／動漫／遊戲角色、角色是未成年、包含性內容、或有血腥的暴力細節，ok=false。
- 一般的戲劇衝突是可以的：英雄救美、被小混混找麻煩、打架受傷、出車禍、被欺負、吵架、失戀、生病住院等，都要 ok=true，照樣整理成場景（受傷可以寫成「受了傷」，不用描寫細節）。
- ok=false 時，reason 用一句話具體說明是哪一點不行；rewrite 給一個保留原本想法、但符合規則的改寫版本（30–80 字，用對方的口吻；改寫版本本身必須能直接通過這些規則，不要再出現奇幻或被禁止的元素）。ok=true 時 rewrite 為 null。
- 關係只能從陌生人（stranger）或朋友（friend，例如青梅竹馬、老同事）開始。若內容暗示已經是戀人，implied_lover=true，並改成朋友；若是「暗戀很久的人」這類，crush_hint=true。
- start_type=friend 時，setting_memories 列出 2–4 條你們「共同的過去」（用第三人稱短句，例如「你們國中同班」），只根據用戶寫的內容延伸，不要編太多。stranger 時為空陣列。
- place/time/mood 各用一句短語。
角色資訊：${frame.name}，${frame.jobLabel}。只輸出 JSON。`,
    input: [{ role: 'user', content: text.slice(0, 400) }],
    schema: SCENE_SCHEMA, schemaName: 'scene',
    mock: /吸血鬼|精靈|異世界|魔法|神明|穿越|機器人|魔王/.test(text) ? { ok: false, reason: '這裡的角色都生活在現實的台灣，吸血鬼這類設定沒辦法使用。', rewrite: '他是我在深夜便利商店遇到的店員，總是穿一身黑、臉色很蒼白，常被熟客笑說像住在夜裡的人。', place: '', time: '', mood: '', implied_lover: false, start_type: 'stranger', crush_hint: false, setting_memories: [] } : { ok: true, reason: null, place: text.slice(0, 20), time: '傍晚', mood: '有點意外', implied_lover: /男友|老公|戀人|交往/.test(text), start_type: /同學|同事|青梅竹馬|朋友/.test(text) ? 'friend' : 'stranger', crush_hint: /暗戀/.test(text), setting_memories: /同學|同事|青梅竹馬/.test(text) ? ['他們以前就認識'] : [], rewrite: null },
  });
  if (!res.ok) logIssue({ level: 'warn', source: 'scenario', message: `相遇情境被判定不能使用：${res.reason || ''}`, detail: { text: text.slice(0, 300) }, userId });
  return res;
}

/** Create character + relationship + opening scene, then let him speak first. */
export async function meet(user, { templateId, custom, scenarioId, scenarioText, reunionRelId }) {
  const active = db.prepare(`SELECT COUNT(*) n FROM relationships WHERE user_id=? AND status='active'`).get(user.id).n;
  if (active >= config.maxActive) return { error: `目前最多同時和 ${config.maxActive} 位角色往來。` };

  // 緣分重逢: he comes back with his memories.
  if (reunionRelId) {
    const old = db.prepare(`SELECT * FROM relationships WHERE id=? AND user_id=? AND status='ended' AND blocked=0`).get(reunionRelId, user.id);
    if (!old) return { error: '找不到這段關係' };
    db.prepare(`UPDATE relationships SET status='active', stage=1, affection=30, ended_at=NULL, pinned=0 WHERE id=?`).run(old.id);
    const persona = j(db.prepare('SELECT persona FROM characters WHERE id=?').get(old.character_id).persona);
    addMessage(old, 'system', 'scene', { text: `在${SCENARIOS.find(s => s.id === scenarioId)?.label || '街角'}，你又遇見了${persona.name}。${ta(persona)}愣了一下，認出了你。` });
    logEvent(user.id, 'reunion', { rel: old.id });
    await runTurn({ user, relId: old.id, trigger: '你們分開一段時間後，在街上偶然重逢。你記得對方，也記得你們的過去。簡短、真誠，不要逼對方，讓對方選擇要不要重新開始。', triggerKey: 'reunion' });
    return { relId: old.id };
  }

  let frame;
  let origin = 'custom';
  if (templateId) {
    const t = db.prepare(`SELECT * FROM templates WHERE id=? AND status='published'`).get(templateId);
    if (!t) return { error: '找不到這個角色' };
    const met = db.prepare(`SELECT 1 FROM characters WHERE user_id=? AND template_id=?`).get(user.id, templateId);
    if (met) return { error: `你已經認識${j(t.data).gender === 'female' ? '她' : '他'}了` };
    frame = j(t.data);
    origin = t.kind === 'official' ? 'official' : 'shared';
  } else {
    frame = frameFromCustom(custom || {});
    const mod = await moderate(`${frame.name} ${frame.appearance}`);
    if (mod.flagged) return { error: '角色名稱或外觀包含不適合的內容。' };
  }

  let scene = { place: '', time: '', mood: '', start_type: 'stranger', setting_memories: [], crush_hint: false, implied_lover: false };
  let label = '';
  if (scenarioText) {
    scene = await structureScenario(user.id, scenarioText, frame);
    if (!scene.ok) return { error: scene.reason || '這個情境沒辦法使用，換一個試試看。', rewrite: scene.rewrite || null };
    label = scenarioText.slice(0, 60);
  } else {
    label = (SCENARIOS.find(s => s.id === scenarioId) || SCENARIOS[0]).label;
    scene.place = label;
  }

  const charId = id('c_');
  db.prepare('INSERT INTO characters (id,user_id,template_id,origin,persona,created_at) VALUES (?,?,?,?,?,?)')
    .run(charId, user.id, templateId || null, origin, JSON.stringify(frame), now());
  const relId = id('r_');
  try {
  const startFriend = scene.start_type === 'friend';
  db.prepare(`INSERT INTO relationships (id,user_id,character_id,stage,affection,understanding,start_type,scenario,created_at,stage_changed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(relId, user.id, charId, startFriend ? 1 : 0,
    (startFriend ? 22 : 5) + (scene.crush_hint ? 10 : 0), startFriend ? 8 : 0,
    startFriend ? 'friend' : 'stranger', JSON.stringify({ id: scenarioText ? null : (scenarioId || SCENARIOS[0].id), label, ...scene }), now(), now());
  const rel = db.prepare('SELECT * FROM relationships WHERE id=?').get(relId);
  for (const s of scene.setting_memories || []) addMemory(rel, 'fact', s, 3, 'setting');

  // Opening scene narration
  const narration = await jsonCall({
    userId: user.id, kind: 'scene', tier: 'good',
    instructions: `${personaBlock(frame)}\n\n寫一段 2–3 句的相遇場景旁白（第二人稱「你」指用戶），台灣日常、具體、有畫面，最後停在角色注意到你的那一刻（角色是${frame.gender === 'female' ? '女生，用「她」' : '男生，用「他」'}）。不要寫角色的台詞。只輸出 JSON。`,
    input: [{ role: 'user', content: `情境：${label}\n地點：${scene.place}｜時間：${scene.time}｜氣氛：${scene.mood}\n起始關係：${startFriend ? '本來就認識的朋友' : '陌生人'}${scene.implied_lover ? '（用戶原本寫的是戀人，但你們目前只是朋友）' : ''}` }],
    schema: { type: 'object', additionalProperties: false, properties: { narration: { type: 'string' } }, required: ['narration'] },
    schemaName: 'scene_text',
    mock: { narration: `${label}。你抬起頭的時候，剛好對上一雙有點驚訝的眼睛。` },
  });
  addMessage(rel, 'system', 'scene', { text: narration.narration });
  if (scene.implied_lover) addMessage(rel, 'system', 'card', { card: { type: 'hint', text: '戀人關係要靠你們一起慢慢走到，先從朋友開始吧。' } });

  logEvent(user.id, 'meet', { rel: relId, origin, scenario: scenarioId || 'free', start: rel.start_type });
  await runTurn({ user, relId, trigger: `這是你們的第一次相遇（${label}）。${startFriend ? '你們本來就認識，語氣自然但還只是朋友。' : '你們是陌生人，有禮貌、不叫小名、不說曖昧的話。'}由你先開口，一兩句就好；最後留一個對方很好回答的小問題（例如是不是常來、要不要幫忙、喜不喜歡某個東西），不要只丟一句讓人不知道怎麼接的話。suggestions 給三個符合這個場景的回覆。`, triggerKey: 'FIRST' });
  // 第一次報備或小問題：當天稍晚
  db.prepare('INSERT INTO followups (rel_id,due_at,topic) VALUES (?,?,?)').run(relId, now() + (3 + Math.random() * 3) * 3600e3,
    '你們今天剛認識。傳一個小小的報備或小問題，讓對方感覺你真的存在（例如你正要下班、或想到剛剛的事）');
  } catch (e) {
    // The meeting did not finish (e.g. the AI service failed): remove the half-made character.
    db.prepare('DELETE FROM characters WHERE id=?').run(charId);
    throw e;
  }
  if (templateId) db.prepare('UPDATE templates SET uses=uses+1 WHERE id=?').run(templateId);
  return { relId };
}

// Remove characters left behind by meetings that failed before he said anything.
export function cleanupOrphans() {
  const r = db.prepare(`DELETE FROM characters WHERE id IN (
    SELECT c.id FROM characters c JOIN relationships r ON r.character_id=c.id
    WHERE r.status='active' AND r.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.rel_id=r.id AND m.sender='char'))`).run(now() - 5 * 60000);
  if (r.changes) console.log(`removed ${r.changes} unfinished meeting(s)`);
}

// ---------- 角色廣場 sharing ----------
export async function sharePreview(user, rel) {
  const c = db.prepare('SELECT * FROM characters WHERE id=?').get(rel.character_id);
  const p = j(c.persona);
  const lines = db.prepare(`SELECT text FROM messages WHERE rel_id=? AND sender='char' AND kind IN ('text','voice') ORDER BY id DESC LIMIT 30`).all(rel.id).map(r => r.text).reverse();
  const res = await jsonCall({
    userId: user.id, kind: 'share', tier: 'cheap',
    instructions: `從角色的設定與他說過的話中，只抽出「人設特徵」給其他用戶使用：traits（核心性格一句）、speech（說話方式一句）、catchphrases（最多 3 個口頭禪）、values（價值觀一句）、weekend（週末做什麼一句）、intro（一句介紹）。絕對不能包含對方用戶的任何資訊（名字、工作、喜好、你們的回憶）。只輸出 JSON。`,
    input: [{ role: 'user', content: `設定：${JSON.stringify({ traits: p.traits, emergent: p.emergent, values: p.values, weekend: p.weekend })}\n他說過的話：\n${lines.join('\n').slice(-2500)}` }],
    schema: { type: 'object', additionalProperties: false, properties: {
      traits: { type: 'string' }, speech: { type: 'string' }, catchphrases: { type: 'array', items: { type: 'string' } },
      values: { type: 'string' }, weekend: { type: 'string' }, intro: { type: 'string' } },
      required: ['traits', 'speech', 'catchphrases', 'values', 'weekend', 'intro'] },
    schemaName: 'share',
    mock: { traits: p.traits, speech: '說話溫和', catchphrases: p.catchphrases || [], values: p.values || '真誠', weekend: p.weekend, intro: p.intro },
  });
  return { name: p.name, gender: p.gender, age: p.age, nationality: p.nationality, jobLabel: p.jobLabel, archetype: p.archetype, proactivity: p.proactivity, appearance: p.appearance, ...res };
}

export async function publishShare(user, rel, draft) {
  const c = db.prepare('SELECT * FROM characters WHERE id=?').get(rel.character_id);
  const p = j(c.persona);
  const mod = await moderate(JSON.stringify(draft));
  if (mod.flagged) return { error: '內容沒有通過審核，請修改後再發布。' };
  const frame = {
    ...p, emergent: `${draft.speech || ''}`.slice(0, 200),
    traits: String(draft.traits || p.traits).slice(0, 120), catchphrases: (draft.catchphrases || []).slice(0, 3).map(s => String(s).slice(0, 20)),
    values: String(draft.values || '').slice(0, 120), weekend: String(draft.weekend || p.weekend).slice(0, 80), intro: String(draft.intro || p.intro).slice(0, 80),
  };
  const tid = id('t_');
  db.prepare(`INSERT INTO templates (id,kind,data,creator_user_id,creator_name,created_at) VALUES (?,?,?,?,?,?)`)
    .run(tid, 'shared', JSON.stringify(frame), user.id, user.nickname, now());
  logEvent(user.id, 'share_publish', { template: tid });
  return { templateId: tid };
}
