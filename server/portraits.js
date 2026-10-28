// 角色的寫實 AI 人像：一張主照 + 幾張生活照，依關係進度慢慢解鎖。
// - 每個角色有一組「臉部特徵」（臉型、眼睛、鼻子、眉毛、小特徵），挑沒人用過的組合，避免角色撞臉。
// - 生活照用主照當參考圖生成，同一個人；失敗時改成背影或側面，不露臉。
// - 模糊版本在伺服器做好：還不能看的照片，手機拿到的就是模糊的圖，不是靠前端蓋一層。
// - 一定標示 AI 生成；提示詞要求虛構人物、不像任何真人或名人。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { db, now, j } from './db.js';
import { config } from './config.js';
import { logIssue } from './logger.js';
import { JOBS } from './characters.js';

export const PORTRAIT_DIR = path.join(config.dataDir, 'portraits');
fs.mkdirSync(PORTRAIT_DIR, { recursive: true });

db.exec(`CREATE TABLE IF NOT EXISTS char_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,          -- 官方角色：template id；自己捏的：character id
  kind TEXT NOT NULL,           -- main | life
  file TEXT NOT NULL,           -- 清楚的原圖
  blur_m TEXT,                  -- 輕度模糊（剛認識）
  blur_h TEXT,                  -- 重度模糊（還沒認識、還沒解鎖）
  caption TEXT,
  min_stage INTEGER NOT NULL DEFAULT 0,  -- 到哪個關係階段才看得到（0 認識 1 朋友 2 曖昧 3 交往）
  paid INTEGER NOT NULL DEFAULT 0,       -- 付費限定（測試期顯示「即將推出」）
  face TEXT,                    -- 用到的臉部特徵組合（避免撞臉）
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`);
db.exec('CREATE INDEX IF NOT EXISTS char_photos_owner ON char_photos(owner, kind)');

// ---------- 臉部特徵：每個角色一組，盡量不重複 ----------
const FACE = {
  shape: ['oval face', 'heart-shaped face', 'square jawline', 'round soft face', 'long slim face', 'diamond face with defined cheekbones'],
  eyes: ['monolid eyes', 'double-eyelid almond eyes', 'gentle downturned eyes', 'sharp upturned eyes', 'large round eyes', 'narrow smiling eyes'],
  nose: ['straight nose', 'small button nose', 'high nose bridge', 'soft rounded nose tip', 'slightly wide nose'],
  brows: ['thick straight eyebrows', 'thin arched eyebrows', 'soft natural eyebrows', 'slightly bushy eyebrows'],
  mark: ['a small mole under the left eye', 'a dimple on one cheek', 'light freckles across the nose', 'a tiny scar on the chin', 'a beauty mark near the lips', 'slightly crooked front tooth when smiling', 'no distinctive marks'],
};
const hashOf = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function pickFace(seed) {
  const used = new Set(db.prepare(`SELECT face FROM char_photos WHERE kind='main' AND face IS NOT NULL`).all().map(r => r.face));
  for (let k = 0; k < 200; k++) {
    let h = hashOf(`${seed}|${k}`);
    const f = Object.fromEntries(Object.entries(FACE).map(([key, arr]) => { const v = arr[h % arr.length]; h = Math.floor(h / arr.length) + 7919; return [key, v]; }));
    const sig = `${f.shape}|${f.eyes}|${f.nose}|${f.mark}`;
    if (!used.has(sig)) return { f, sig };
  }
  const f = Object.fromEntries(Object.entries(FACE).map(([key, arr]) => [key, arr[crypto.randomInt(arr.length)]]));
  return { f, sig: `${f.shape}|${f.eyes}|${f.nose}|${f.mark}|${crypto.randomInt(1e6)}` };
}

const NAT = { 台灣: 'Taiwanese', 日本: 'Japanese', 韓國: 'Korean' };
const HAIR = { short: 'short neat hair', curly: 'short wavy hair', side: 'side-parted hair', part: 'middle-parted hair', messy: 'tousled hair',
  long: 'long straight hair', wavy: 'long wavy hair', bob: 'chin-length bob', ponytail: 'high ponytail', bun: 'loose bun' };

function personLine(frame, face) {
  const who = `${frame.age || 27}-year-old ${NAT[frame.nationality] || 'East Asian'} ${frame.gender === 'female' ? 'woman' : 'man'}`;
  const hair = HAIR[frame.look?.hair] || '';
  return `a fictional ${who}, ${face.shape}, ${face.eyes}, ${face.nose}, ${face.brows}, ${face.mark}${hair ? `, ${hair}` : ''}`;
}
const RULES = 'This is an original fictional person who must not resemble any celebrity, idol, actor or real person. Natural skin texture, realistic, not airbrushed, not a model shoot. Fully clothed, everyday modest outfit. No text, no logos, no watermark, no other people\'s faces in focus.';

// 生活照：曖昧解鎖 3 張、交往解鎖 2 張、付費限定 1 張
function lifeScenes(frame) {
  const job = JOBS[frame.job];
  return [
    { min: 2, cap: '上班的時候', scene: `at work in ${job?.place || 'the office'} as a ${job?.label || 'professional'}, candid, focused on work` },
    { min: 2, cap: '休假的時候', scene: `on a day off: ${frame.weekend || 'relaxing at a cafe'}, candid, soft daylight` },
    { min: 2, cap: '路上隨手拍', scene: 'walking on a Taipei street in the evening, looking back over the shoulder, slight smile' },
    { min: 3, cap: '傳給你的自拍', scene: 'a casual front-camera selfie at home in comfy clothes, warm lamp light, shy smile' },
    { min: 3, cap: '一起吃飯的時候', scene: 'sitting across the table at a cozy restaurant, photo taken by a companion, laughing' },
    { min: 3, cap: '限定照片', scene: 'dressed up nicely for a special night out, city lights bokeh behind', paid: true },
  ];
}

async function saveVariants(buf) {
  const base = crypto.randomBytes(9).toString('base64url');
  const img = sharp(buf).rotate().resize({ width: 900, withoutEnlargement: true });
  const clear = await img.clone().jpeg({ quality: 84 }).toBuffer();
  const m = await sharp(clear).resize({ width: 360 }).blur(9).jpeg({ quality: 70 }).toBuffer();
  const h = await sharp(clear).resize({ width: 160 }).blur(14).jpeg({ quality: 60 }).toBuffer();
  const names = { file: `${base}.jpg`, blur_m: `${base}_m.jpg`, blur_h: `${base}_h.jpg` };
  fs.writeFileSync(path.join(PORTRAIT_DIR, names.file), clear);
  fs.writeFileSync(path.join(PORTRAIT_DIR, names.blur_m), m);
  fs.writeFileSync(path.join(PORTRAIT_DIR, names.blur_h), h);
  return names;
}

function logImage(userId, n = 1) {
  db.prepare('INSERT INTO usage (user_id,kind,model,units,created_at) VALUES (?,?,?,?,?)').run(userId || null, 'portrait', config.imageModel, n, now());
}

/** 生成主照（已經有就跳過，除非 force）。 */
export async function makeMain(owner, frame, { userId = null, force = false } = {}) {
  if (config.mock) return null;
  if (!force && mainOf(owner)) return mainOf(owner);
  const { openai } = await import('./llm.js');
  const { f, sig } = pickFace(owner + (force ? `|${Date.now()}` : ''));
  const job = JOBS[frame.job];
  const prompt = `A candid realistic smartphone photo of ${personLine(frame, f)}. ${frame.appearance ? `Details: ${frame.appearance}.` : ''} Upper body, looking toward the camera with a natural expression, background hints of ${job?.place || 'a Taipei street'}, natural light. ${RULES}`;
  const res = await openai.images.generate({ model: config.imageModel, size: '1024x1536', quality: 'medium', output_format: 'jpeg', n: 1, prompt });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error('沒有拿到圖片');
  logImage(userId);
  const v = await saveVariants(Buffer.from(b64, 'base64'));
  if (force) db.prepare(`UPDATE char_photos SET hidden=1 WHERE owner=? AND kind='main'`).run(owner);
  db.prepare('INSERT INTO char_photos (owner,kind,file,blur_m,blur_h,caption,min_stage,face,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(owner, 'main', v.file, v.blur_m, v.blur_h, null, 0, sig, now());
  return mainOf(owner);
}

/** 生成生活照（用主照當參考，同一個人）。 */
export async function makeLife(owner, frame, { userId = null } = {}) {
  if (config.mock) return 0;
  const main = mainOf(owner);
  if (!main) return 0;
  const have = new Set(db.prepare(`SELECT caption FROM char_photos WHERE owner=? AND kind='life' AND hidden=0`).all(owner).map(r => r.caption));
  const { openai, toFile } = await import('./llm.js');
  let n = 0;
  for (const s of lifeScenes(frame)) {
    if (have.has(s.cap)) continue;
    let b64 = null;
    try {
      const ref = await toFile(fs.readFileSync(path.join(PORTRAIT_DIR, main.file)), 'ref.jpg', { type: 'image/jpeg' });
      const res = await openai.images.edit({ model: config.imageModel, image: ref, size: '1024x1536', quality: 'medium', output_format: 'jpeg',
        prompt: `The same person as in the reference photo (same face, same hairstyle), ${s.scene}. Realistic smartphone photo. ${RULES}` });
      b64 = res.data?.[0]?.b64_json;
    } catch (e) {
      // 沒辦法用參考圖：改拍背影或側面，不露臉，避免變成另一個人
      try {
        const res = await openai.images.generate({ model: config.imageModel, size: '1024x1536', quality: 'medium', output_format: 'jpeg', n: 1,
          prompt: `A candid realistic smartphone photo of ${personLine(frame, { shape: '', eyes: '', nose: '', brows: '', mark: '' }).replace(/, ,/g, ',')}, seen from behind or in profile so the face is not visible, ${s.scene}. ${RULES}` });
        b64 = res.data?.[0]?.b64_json;
      } catch (e2) { logIssue({ level: 'warn', source: 'photos', message: `生成生活照失敗：${e2.message}`, error: e2 }); }
    }
    if (!b64) continue;
    logImage(userId);
    const v = await saveVariants(Buffer.from(b64, 'base64'));
    db.prepare('INSERT INTO char_photos (owner,kind,file,blur_m,blur_h,caption,min_stage,paid,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(owner, 'life', v.file, v.blur_m, v.blur_h, s.cap, s.min, s.paid ? 1 : 0, now());
    n++;
  }
  return n;
}

export const mainOf = (owner) => db.prepare(`SELECT * FROM char_photos WHERE owner=? AND kind='main' AND hidden=0 ORDER BY id DESC LIMIT 1`).get(owner);
export const photosOf = (owner) => db.prepare(`SELECT * FROM char_photos WHERE owner=? AND hidden=0 ORDER BY kind DESC, min_stage, id`).all(owner);
export const LIFE_COUNT = 6;

/** 背景補齊照片：沒有主照就先生成主照；life=true 時也補生活照。超過預算時不生成。 */
const making = new Set();
export function ensurePortraits(c, userId, { life = false } = {}) {
  if (config.mock) return;
  const owner = ownerOfCharacter(c);
  if (making.has(owner)) return;
  making.add(owner);
  (async () => {
    const { budgetPaused } = await import('./budget.js');
    if (budgetPaused()) return;
    const frame = j(c.persona, {});
    if (!mainOf(owner)) await makeMain(owner, frame, { userId });
    if (life) await makeLife(owner, frame, { userId });
  })().catch(e => logIssue({ level: 'warn', source: 'photos', message: `生成角色照片失敗：${e.message}`, error: e }))
    .finally(() => making.delete(owner));
}

/** 這個角色的照片放在哪個 owner 底下：官方角色共用模板的照片，自己捏的用角色自己的。 */
export function ownerOfCharacter(c) {
  if (c.template_id && mainOf(c.template_id)) return c.template_id;
  return c.id;
}

/**
 * 給使用者看的照片清單：依關係階段決定每張是清楚、輕度模糊還是重度模糊。
 * stage = null 代表還沒認識（探索頁）。
 */
export function photosForViewer(owner, stage) {
  return photosOf(owner).map(p => {
    let level;
    if (p.kind === 'main') level = stage == null ? 'h' : stage === 0 ? 'm' : 'c';
    else level = stage != null && stage >= p.min_stage && !p.paid ? 'c' : 'h';
    return { id: p.id, kind: p.kind, caption: p.caption, level, locked: level === 'h' && p.kind === 'life', paid: !!p.paid, minStage: p.min_stage,
      url: `/api/portrait/${p.id}/${level}` };
  });
}

/** 依權限送出哪一個檔案；不能看就只給模糊版。 */
export function portraitFile(p, level) {
  const f = level === 'c' ? p.file : level === 'm' ? p.blur_m : p.blur_h;
  return f ? path.join(PORTRAIT_DIR, f) : null;
}
