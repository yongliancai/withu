// 人設欄位（行為模組 J）：對話邏輯各步驟要讀的個性細節。
//   opener    開場風格：shy 害羞 / direct 直接 / humor 幽默
//   reasons   常用的搭話理由（通常來自職業）
//   pushback  反駁程度：tease 會反駁也會吐槽 / taste 只在品味話題不同意 / rare 很少反對
//   disclose  揭露節奏：fast / mid / slow，決定各關係階段會講到哪一層（事實 → 想法 → 感受）
//   emoji     表情符號：none / some / lots
//   comfort   安慰方式：listen 先聽 / lighten 先輕鬆帶過 / advise 先一起想辦法 / company 安靜陪著
//   likes、dislikes、worry（最近在忙或在煩的事）、never（絕對不會說或不會做的事）
// 預設值依原型給，馬上能用；有金鑰時在背景用便宜模型依整份人設補上具體的喜好、煩惱與禁區。
import { db, j } from './db.js';
import { jsonCall } from './llm.js';
import { config } from './config.js';
import { JOBS } from './characters.js';
import { logIssue } from './logger.js';

const D = (opener, pushback, disclose, emoji, comfort) => ({ opener, pushback, disclose, emoji, comfort });
export const ARCHETYPE_TALK = {
  gentle_senior: D('direct', 'taste', 'mid', 'some', 'listen'),
  sharp_doctor: D('direct', 'tease', 'slow', 'none', 'advise'),
  sunny_barista: D('humor', 'taste', 'fast', 'lots', 'lighten'),
  shy_bookish: D('shy', 'taste', 'slow', 'none', 'listen'),
  sporty: D('direct', 'tease', 'fast', 'some', 'advise'),
  tsundere: D('shy', 'tease', 'slow', 'some', 'lighten'),
  mature: D('direct', 'taste', 'slow', 'none', 'listen'),
  playful: D('humor', 'tease', 'fast', 'lots', 'lighten'),
  gentle_neighbor: D('direct', 'rare', 'mid', 'some', 'listen'),
  cheerful_junior: D('humor', 'taste', 'fast', 'lots', 'lighten'),
  cool_elegant: D('shy', 'tease', 'slow', 'none', 'company'),
  sharp_senior_f: D('direct', 'tease', 'mid', 'some', 'advise'),
  ceo: D('direct', 'tease', 'slow', 'none', 'advise'),
  puppy: D('humor', 'rare', 'fast', 'lots', 'listen'),
  badboy: D('humor', 'tease', 'slow', 'some', 'lighten'),
  bookish_girl: D('shy', 'taste', 'slow', 'some', 'listen'),
  otaku_cheerful: D('humor', 'taste', 'fast', 'lots', 'lighten'),
  ojousama: D('direct', 'tease', 'mid', 'none', 'advise'),
  big_sis: D('humor', 'taste', 'mid', 'some', 'listen'),
  kuudere_m: D('shy', 'taste', 'slow', 'none', 'company'),
  flirty: D('humor', 'tease', 'mid', 'some', 'lighten'),
  big_bro: D('direct', 'tease', 'mid', 'some', 'advise'),
  genius: D('humor', 'tease', 'slow', 'none', 'advise'),
  gentleman: D('direct', 'rare', 'mid', 'none', 'listen'),
  gal: D('humor', 'tease', 'fast', 'lots', 'lighten'),
  healing: D('shy', 'rare', 'mid', 'some', 'listen'),
  boss_lady: D('direct', 'tease', 'slow', 'none', 'advise'),
  tennen: D('shy', 'rare', 'fast', 'some', 'company'),
};
const FALLBACK = D('direct', 'taste', 'mid', 'some', 'listen');

export const LABELS = {
  opener: { shy: '害羞：開口前會猶豫，話短，常用小動作或小失誤帶出話題', direct: '直接：坦白說明來意，不繞圈子', humor: '幽默：用一句輕鬆的玩笑或吐槽破冰（不硬搞笑）' },
  pushback: { tease: '會反駁也會吐槽：不同意就直說，常鬥嘴', taste: '只在品味、喜好的話題不同意（吃的、看的、穿的），大事上通常支持對方', rare: '很少反對：多半順著對方，但不會說違心的話，真的不同意會溫和說' },
  disclose: { fast: '快：很快就會講自己的事，朋友階段就會說想法和小煩惱', mid: '中：剛認識講事實，朋友階段講想法，曖昧後才講感受', slow: '慢：很久才會講自己的感受，前期多半只講發生的事' },
  emoji: { none: '幾乎不用表情符號', some: '偶爾用表情符號', lots: '常用表情符號和顏文字' },
  comfort: { listen: '先聽：讓對方說完，替對方說出感受，不急著給建議', lighten: '先輕鬆帶過：用玩笑或轉移注意力讓對方笑一下，再陪對方', advise: '先一起想辦法：聽完會給具體的下一步（但不說教）', company: '安靜陪著：話很少，用陪伴代替安慰' },
};

/** 合併預設與角色自己的人設欄位。 */
export function talkOf(p = {}) {
  const base = ARCHETYPE_TALK[p.archetype] || FALLBACK;
  const t = p.talk || {};
  const job = JOBS[p.job];
  return {
    ...base, ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined && v !== null && v !== '')),
    reasons: t.reasons?.length ? t.reasons : job ? [`${job.label}的工作上會遇到的人和事`] : [],
    likes: t.likes || [], dislikes: t.dislikes || [], worry: t.worry || '', never: t.never || [],
  };
}

/** 揭露節奏 × 關係階段 → 這個階段可以講到哪一層。 */
export function discloseLayer(disclose, stage) {
  const layers = ['發生了什麼事（事實）', '你的想法和看法', '你的感受、在意和煩惱'];
  const shift = disclose === 'fast' ? 1 : disclose === 'slow' ? -1 : 0;
  const lv = Math.max(0, Math.min(2, (stage >= 3 ? 2 : stage >= 2 ? 1.5 : stage) + shift));
  return layers[Math.floor(lv)];
}

/** 放進角色提示的人設細節。 */
export function talkBlock(p, stage = null) {
  const t = talkOf(p);
  return [
    '## 你的個性細節',
    `開場風格：${LABELS.opener[t.opener]}`,
    t.reasons.length ? `你常有的搭話理由：${t.reasons.join('、')}` : '',
    `跟人意見不同時：${LABELS.pushback[t.pushback]}`,
    `講自己的事：${LABELS.disclose[t.disclose]}${stage == null ? '' : `。現在這個關係階段，分享自己時最多講到「${discloseLayer(t.disclose, stage)}」`}。`,
    `表情符號：${LABELS.emoji[t.emoji]}`,
    `對方難過時你的方式：${LABELS.comfort[t.comfort]}`,
    t.likes.length ? `你喜歡：${t.likes.join('、')}` : '',
    t.dislikes.length ? `你討厭：${t.dislikes.join('、')}` : '',
    t.worry ? `你最近在忙或在煩的事：${t.worry}` : '',
    t.never.length ? `你絕對不會說或做的事：${t.never.join('；')}` : '',
    p.catchphrases?.length ? `口頭禪（${p.catchphrases.join('、')}）大約五則才用一次，不要每則都用。` : '',
  ].filter(Boolean).join('\n');
}

// ---------- 用模型補具體內容 ----------
const FILL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasons: { type: 'array', items: { type: 'string' }, description: '2–3 個這個人在生活中自然會跟陌生人開口的理由，跟職業或習慣有關' },
    likes: { type: 'array', items: { type: 'string' }, description: '4–6 個具體的喜好（食物、地方、作品、習慣），台灣日常' },
    dislikes: { type: 'array', items: { type: 'string' }, description: '3–4 個具體討厭的東西' },
    worry: { type: 'string', description: '最近在忙或在煩的一件具體的事（一句話）' },
    never: { type: 'array', items: { type: 'string' }, description: '2–3 件這個人絕對不會說或不會做的事（跟個性有關）' },
  },
  required: ['reasons', 'likes', 'dislikes', 'worry', 'never'],
};

export async function fillTalk(frame, userId = null) {
  const t = talkOf(frame);
  const res = await jsonCall({
    userId, kind: 'persona', tier: 'cheap',
    instructions: '你在幫一個 AI 陪伴 App 的角色補人設細節。依照下面的設定，寫出這個人具體、台灣日常、有個人味的細節；不要和設定矛盾，不要寫成形容詞清單，要是具體的東西（例如「巷口那家的鹹酥雞」「下雨天的公車」）。',
    input: [{ role: 'user', content: JSON.stringify({ name: frame.name, gender: frame.gender, age: frame.age, job: JOBS[frame.job]?.label, home: frame.home, traits: frame.traits, values: frame.values, weekend: frame.weekend, intro: frame.intro, threads: frame.threads, archetype: frame.archetype, opener: t.opener, comfort: t.comfort }) }],
    schema: FILL_SCHEMA, schemaName: 'persona_talk',
    mock: () => ({ reasons: t.reasons, likes: [], dislikes: [], worry: '', never: [] }),
  });
  const clip = (a, n, len) => (a || []).map(s => String(s).trim().slice(0, len)).filter(Boolean).slice(0, n);
  return { ...(frame.talk || {}), reasons: clip(res.reasons, 3, 30), likes: clip(res.likes, 6, 20), dislikes: clip(res.dislikes, 4, 20), worry: String(res.worry || '').slice(0, 50), never: clip(res.never, 3, 40), filled: true };
}

/** 背景補齊官方角色模板的人設細節（每次啟動補幾個，避免一次用太多）。 */
export async function backfillTemplates(limit = 20) {
  if (config.mock) return 0;
  const rows = db.prepare(`SELECT id, data FROM templates WHERE status='published' AND (json_extract(data,'$.talk.filled') IS NULL) LIMIT ?`).all(limit);
  let n = 0;
  for (const r of rows) {
    const f = j(r.data, {});
    try {
      f.talk = await fillTalk(f);
      db.prepare('UPDATE templates SET data=? WHERE id=?').run(JSON.stringify(f), r.id);
      n++;
    } catch (e) {
      logIssue({ level: 'warn', source: 'llm', message: `補角色人設細節失敗（${f.name}）：${e.message}`, error: e });
      break;
    }
  }
  return n;
}

/** 已經認識的角色：模板補好之後，把細節帶進使用者那份角色（不覆蓋已有的）。 */
export function syncTalkFromTemplate(charRow) {
  const p = j(charRow.persona, {});
  if (p.talk?.filled || !charRow.template_id) return null;
  const t = db.prepare('SELECT data FROM templates WHERE id=?').get(charRow.template_id);
  const tt = t && j(t.data, {}).talk;
  if (!tt?.filled) return null;
  p.talk = { ...tt, ...(p.talk || {}) , filled: true };
  db.prepare('UPDATE characters SET persona=? WHERE id=?').run(JSON.stringify(p), charRow.id);
  return p.talk;
}
