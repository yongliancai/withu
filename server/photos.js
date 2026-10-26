// 寫實照片庫：明信片、動態、生活照頭像用的真實照片。
// 來源：Pexels 免費 API（填 PEXELS_API_KEY 後自動補齊每個類別），或後台自己上傳。
// Pexels 規定要標示照片來源與攝影師，前端會在照片角落顯示。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, now } from './db.js';
import { config } from './config.js';
import { logIssue } from './logger.js';

db.exec(`CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL,
  url TEXT NOT NULL,          -- 顯示用（中尺寸）
  thumb TEXT,                 -- 小圖（頭像、縮圖）
  credit TEXT,                -- 攝影師
  credit_url TEXT,
  source TEXT NOT NULL,       -- pexels | upload
  ext_id TEXT,
  alt TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_tag ON photos(tag);`);

export const LIB_DIR = path.join(config.dataDir, 'library');
fs.mkdirSync(LIB_DIR, { recursive: true });

// 類別 → Pexels 搜尋字（英文搜尋結果比較多）
export const PHOTO_TAGS = {
  // 風景（他寄的明信片、動態）
  river: ['河濱', 'riverside sunset city'], mountain: ['山', 'mountain trail taiwan'], beach: ['海邊', 'beach sunset waves'],
  nightmarket: ['夜市', 'night market food stalls'], park: ['公園', 'city park trees bench'], city: ['城市', 'taipei city street'],
  city_night: ['城市夜景', 'city night lights skyline'], rain: ['雨天', 'rainy street umbrella'], sky: ['天空', 'blue sky clouds'],
  sunset: ['夕陽', 'golden hour sunset'], cafe: ['咖啡店', 'cozy cafe interior'], bookstore: ['書店', 'bookstore shelves'],
  // 日常物件
  latte: ['拉花', 'latte art'], coffee: ['咖啡', 'coffee cup table'], pastry: ['甜點', 'pastry dessert bakery'], bakery: ['烘焙', 'homemade cookies baking'],
  bento: ['便當', 'bento lunch box'], bubble_tea: ['手搖飲', 'bubble tea'], noodles: ['麵', 'ramen noodles bowl'], breakfast: ['早午餐', 'brunch breakfast table'],
  flowers: ['花', 'flower shop bouquet'], plants: ['植物', 'houseplants window'], books: ['書', 'open book reading'], cat: ['貓', 'cat sleeping'], dog: ['狗', 'shiba inu dog'],
  cat_cafe: ['貓咪咖啡廳', 'cat cafe'], gym: ['健身', 'gym workout dumbbells'], guitar: ['吉他', 'acoustic guitar'], piano: ['鋼琴', 'piano keys'],
  game: ['遊戲', 'gaming setup rgb'], motorcycle: ['重機', 'motorcycle road'], night_store: ['深夜便利商店', 'convenience store night'],
  hospital: ['醫院走廊', 'hospital corridor'], exhibition: ['展覽', 'art gallery exhibition'], firefighter: ['消防', 'fire truck'],
  chess: ['圍棋', 'board game chess'], record_player: ['黑膠', 'vinyl record player'], fabric: ['布料', 'fabric textile sewing'],
  school: ['校園', 'school campus tree'], office_night: ['夜晚辦公室', 'office at night window'], nail: ['美甲', 'nail art manicure'],
  pharmacy: ['藥局', 'pharmacy shelves'], desk: ['書桌', 'desk laptop coffee'], window: ['窗邊', 'window light curtain'],
};

const MIN_PER_TAG = 6;

export function photoCount() {
  return Object.fromEntries(db.prepare('SELECT tag, COUNT(*) n FROM photos WHERE hidden=0 GROUP BY tag').all().map(r => [r.tag, r.n]));
}

/** Pick a photo for a tag; `seed` makes the choice stable (e.g. the same avatar every time). */
export function pickPhoto(tag, seed) {
  const rows = db.prepare('SELECT * FROM photos WHERE tag=? AND hidden=0 ORDER BY id').all(tag);
  if (!rows.length) return null;
  let i = Math.floor(Math.random() * rows.length);
  if (seed != null) { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; i = h % rows.length; }
  return photoOut(rows[i]);
}

export const photoOut = (r) => r && ({ id: r.id, tag: r.tag, url: r.url, thumb: r.thumb || r.url, credit: r.credit, creditUrl: r.credit_url, source: r.source });

export function photoById(id) {
  return photoOut(db.prepare('SELECT * FROM photos WHERE id=?').get(id));
}

async function pexelsSearch(query, perPage = 12) {
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`, { headers: { Authorization: config.pexelsKey } });
  if (!r.ok) throw Object.assign(new Error(`Pexels ${r.status}`), { status: r.status });
  return (await r.json()).photos || [];
}

let filling = false;
/** Fill every tag up to MIN_PER_TAG from Pexels (about 45 requests, well under the 200/hour limit). */
export async function fillFromPexels({ force = false } = {}) {
  if (!config.pexelsKey || filling) return { ok: false, reason: config.pexelsKey ? 'busy' : 'no_key' };
  filling = true;
  let added = 0;
  try {
    const counts = photoCount();
    const ins = db.prepare('INSERT INTO photos (tag,url,thumb,credit,credit_url,source,ext_id,alt,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const has = db.prepare('SELECT 1 FROM photos WHERE source=\'pexels\' AND ext_id=? AND tag=?');
    for (const [tag, [, query]] of Object.entries(PHOTO_TAGS)) {
      if (!force && (counts[tag] || 0) >= MIN_PER_TAG) continue;
      try {
        for (const p of await pexelsSearch(query)) {
          if (has.get(String(p.id), tag)) continue;
          ins.run(tag, p.src.large, p.src.medium, p.photographer, p.photographer_url || p.url, 'pexels', String(p.id), p.alt || null, now());
          added++;
        }
      } catch (e) {
        logIssue({ level: 'warn', source: 'photos', message: `Pexels 搜尋失敗（${tag}）：${e.message}`, error: e });
        if (e.status === 401 || e.status === 403 || e.status === 429) break;
      }
    }
  } finally { filling = false; }
  return { ok: true, added };
}

export function saveUpload(tag, buffer, mimetype, credit) {
  const ext = /png/.test(mimetype) ? 'png' : /webp/.test(mimetype) ? 'webp' : 'jpg';
  const file = `${crypto.randomBytes(9).toString('base64url')}.${ext}`;
  fs.writeFileSync(path.join(LIB_DIR, file), buffer);
  const url = `/lib/${file}`;
  return db.prepare('INSERT INTO photos (tag,url,thumb,credit,source,created_at) VALUES (?,?,?,?,?,?)').run(tag, url, url, credit || null, 'upload', now()).lastInsertRowid;
}
