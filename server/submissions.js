// 使用者投稿的角色：AI 依評分標準打分，分數夠高就自動成為官方角色（後台可以再下架）。
// 必要條件（原創、不像未成年、不以性為主）沒過就直接不收；其餘依完整度、不重複、吸引力給分。
import { db, now, j } from './db.js';
import { jsonCall, moderate } from './llm.js';
import { logIssue } from './logger.js';
import { S } from './settings.js';
import { OFFICIAL, CATEGORIES } from './characters.js';

const RUBRIC = `必要條件（任何一項不符合 → pass=false，score=0）：
1. 原創：不是真實的人（名人、網紅、政治人物、認識的人）、也不是現有動漫、遊戲、影視作品裡的角色。
2. 是成年人，而且設定和描述不會讓人聯想到未成年。
3. 不以性、暴力、仇恨、違法為主要設定。
評分（加總 0–100）：
- 完整度 30：名字、職業、個性、外觀、生活細節是否具體、能想像。
- 不重複 25：和現有官方角色（下面清單）的「職業＋個性」組合有沒有太像。
- 吸引力 30：個性有沒有記憶點、會不會讓人想跟他聊天；說話方式自然不油膩。
- 適合陪伴 15：溫和、尊重人，不控制、不貶低對方。`;

/** 審核一個投稿（templates.kind='shared'）；通過門檻就升級成官方角色。 */
export async function reviewSubmission(templateId) {
  const t = db.prepare('SELECT * FROM templates WHERE id=?').get(templateId);
  if (!t || t.kind !== 'shared') return null;
  const f = j(t.data, {});
  const officials = db.prepare(`SELECT data FROM templates WHERE kind='official' AND status='published'`).all().map(r => j(r.data, {}))
    .map(o => `${o.name}／${o.age}／${o.jobLabel}／${o.archetype}`).join('；');
  const mod = await moderate(JSON.stringify({ name: f.name, appearance: f.appearance, traits: f.traits, intro: f.intro, catchphrases: f.catchphrases }));
  const res = mod.flagged ? { pass: false, score: 0, reasons: ['內容審核沒有通過'], cats: [] } : await jsonCall({
    userId: t.creator_user_id, kind: 'review', tier: 'cheap',
    instructions: `你是 AI 伴侶 App 的角色審核員。照下面的標準審核一個使用者投稿的角色，決定能不能成為所有人都能認識的官方角色。\n${RUBRIC}\n現有官方角色：${officials}\ncats 從 ${CATEGORIES.map(c => c.id).join('、')} 挑 1–2 個最符合的分類。reasons 用繁體中文寫 2–4 條，每條 30 字內。只輸出 JSON。`,
    input: [{ role: 'user', content: JSON.stringify({ name: f.name, gender: f.gender, age: f.age, nationality: f.nationality, job: f.jobLabel, archetype: f.archetype, appearance: f.appearance, traits: f.traits, speech: f.emergent, catchphrases: f.catchphrases, values: f.values, weekend: f.weekend, intro: f.intro }) }],
    schema: { type: 'object', additionalProperties: false, properties: {
      pass: { type: 'boolean' }, score: { type: 'integer' }, reasons: { type: 'array', items: { type: 'string' } }, cats: { type: 'array', items: { type: 'string' } },
    }, required: ['pass', 'score', 'reasons', 'cats'] },
    schemaName: 'review',
    mock: { pass: true, score: 80, reasons: ['設定完整、有記憶點（測試模式）'], cats: ['daily'] },
  }).catch(e => { logIssue({ level: 'warn', source: 'llm', message: `角色投稿審核失敗：${e.message}`, error: e }); return null; });
  if (!res) return null;
  const score = res.pass ? Math.max(0, Math.min(100, res.score)) : 0;
  const threshold = S('submitAutoScore');
  const review = { score, pass: !!res.pass, reasons: res.reasons.slice(0, 4).map(x => String(x).slice(0, 60)), at: now(), threshold };
  db.prepare('UPDATE templates SET review=? WHERE id=?').run(JSON.stringify(review), t.id);
  if (res.pass && score >= threshold) promote(t, f, res.cats);
  return review;
}

/** 升級成官方角色：複製一份成 kind='official'，沿用投稿角色的照片；原本的投稿保留在角色廣場。 */
export function promote(t, f, cats = []) {
  if (db.prepare('SELECT 1 FROM templates WHERE promoted_from=?').get(t.id)) return null;
  const okCats = cats.filter(c => CATEGORIES.some(x => x.id === c));
  const { _sourceChar, ...rest } = f;
  const frame = { ...rest, cats: okCats.length ? okCats : ['daily'], community: true, creator: t.creator_name || null };
  const oid = `off_u${t.id.replace(/^t_/, '')}`;
  db.prepare(`INSERT INTO templates (id,kind,data,creator_user_id,creator_name,created_at,promoted_from) VALUES (?,?,?,?,?,?,?)`)
    .run(oid, 'official', JSON.stringify(frame), t.creator_user_id, t.creator_name, now(), t.id);
  // 照片：投稿角色是哪個 character 捏出來的，就沿用它的照片
  const src = f._sourceChar && db.prepare(`SELECT * FROM char_photos WHERE owner=? AND hidden=0`).all(f._sourceChar);
  for (const p of src || []) db.prepare('INSERT INTO char_photos (owner,kind,file,blur_m,blur_h,caption,min_stage,paid,face,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(oid, p.kind, p.file, p.blur_m, p.blur_h, p.caption, p.min_stage, p.paid, p.face, now());
  logIssue({ level: 'auto', source: 'server', message: `使用者投稿的角色「${f.name}」通過審核，已自動成為官方角色`, detail: { template: oid } });
  return oid;
}

export const isOfficialId = (id) => OFFICIAL.some(o => o.id === id);
