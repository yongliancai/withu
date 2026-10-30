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
  // 職業場景：讓每個角色的動態更像他的工作
  clinic: ['診間', 'doctor clinic stethoscope desk'], classroom: ['教室', 'empty classroom desks blackboard'], studio_mic: ['錄音室', 'radio studio microphone'],
  bar_counter: ['酒吧吧台', 'cocktail bar counter bottles'], cocktail: ['調酒', 'cocktail glass bar'], florist_table: ['花藝工作台', 'florist workbench flowers'],
  sewing: ['縫紉', 'sewing machine tailor'], tattoo_studio: ['刺青工作室', 'tattoo studio'], camera: ['相機', 'film camera photography'],
  laptop_code: ['寫程式', 'laptop code screen night'], lab: ['研究室', 'science laboratory bench'], vet_clinic: ['動物醫院', 'veterinary clinic dog'],
  kindergarten: ['幼兒園', 'kindergarten toys classroom'], meeting_room: ['會議室', 'meeting room office'], stage_lights: ['舞台燈光', 'concert stage lights'],
  makeup: ['化妝台', 'makeup vanity table'], kitchen_pro: ['專業廚房', 'restaurant kitchen chef'], dessert_shop: ['甜點櫃', 'dessert shop display'],
  // 台灣在地
  breakfast_shop: ['早餐店', 'taiwanese breakfast egg pancake soy milk'], street_food: ['路邊小吃', 'taiwan street food'], beef_noodle: ['牛肉麵', 'beef noodle soup'],
  hotpot: ['火鍋', 'hot pot dinner'], mrt: ['捷運站', 'metro station platform taipei'], scooter: ['機車街景', 'scooters street taiwan'],
  temple: ['廟宇', 'taiwan temple lanterns'], old_street: ['老街', 'old street lanterns taiwan'], harbor: ['漁港', 'fishing harbor boats'],
  rice_field: ['稻田', 'rice field countryside'], hot_spring: ['溫泉', 'hot spring steam'], tea: ['茶', 'tea cup teapot'],
  convenience_food: ['超商美食', 'convenience store food snacks'], alley: ['巷弄', 'quiet alley plants'], rooftop: ['頂樓', 'rooftop city view'],
  // 季節與節日
  mooncake: ['中秋月餅', 'mooncake moon festival'], bbq: ['中秋烤肉', 'barbecue grill night friends'], fireworks: ['跨年煙火', 'new year fireworks city'],
  cherry_blossom: ['櫻花', 'cherry blossom'], typhoon: ['颱風天', 'storm rain window wind'], christmas: ['聖誕市集', 'christmas market lights'],
  lunar_new_year: ['過年', 'chinese new year red decorations'], lantern: ['燈會', 'lantern festival'], summer_ice: ['剉冰', 'shaved ice dessert summer'],
  autumn_leaves: ['秋天落葉', 'autumn leaves path'], winter_coat: ['冬天', 'winter scarf coffee cold'],
  // 氛圍
  rainy_window: ['雨天窗邊', 'rain on window cozy'], night_desk: ['深夜書桌', 'desk lamp night study'], morning_balcony: ['清晨陽台', 'morning balcony sunlight'],
  sunset_train: ['車窗夕陽', 'train window sunset'], cozy_bed: ['被窩', 'cozy bed blanket morning'], bookshelf_home: ['家裡的書架', 'home bookshelf plants'],
  stars: ['星空', 'starry night sky'], ocean_night: ['夜晚海邊', 'ocean at night moon'], walk_path: ['散步小路', 'park walking path trees'],
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

// ---- 照片來源 ----
// Pexels（有金鑰才用；2026 年 10 月起暫停發新金鑰）→ Pixabay（免費金鑰）→ Openverse（不用金鑰，CC 授權）
// 下載到自己的主機再提供，不依賴對方的網址（Pixabay、Openverse 都建議這樣做）
const UA = { 'User-Agent': 'WithU/1.0 (companion app photo library)' };

async function pexelsSearch(query) {
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`, { headers: { Authorization: config.pexelsKey } });
  if (!r.ok) throw Object.assign(new Error(`Pexels ${r.status}`), { status: r.status });
  return ((await r.json()).photos || []).map(p => ({ extId: String(p.id), src: p.src.large, credit: p.photographer, creditUrl: p.photographer_url || p.url, alt: p.alt, license: 'Pexels License' }));
}
async function pixabaySearch(query) {
  const r = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(config.pixabayKey)}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&safesearch=true&per_page=10`);
  if (!r.ok) throw Object.assign(new Error(`Pixabay ${r.status}`), { status: r.status });
  return ((await r.json()).hits || []).map(p => ({ extId: String(p.id), src: p.webformatURL, credit: p.user, creditUrl: p.pageURL, alt: p.tags, license: 'Pixabay License' }));
}
async function openverseSearch(query) {
  // 只拿可商用、可改作的 CC 授權；不含成人內容
  const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license_type=commercial,modification&mature=false&page_size=10&aspect_ratio=wide`, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Object.assign(new Error(`Openverse ${r.status}`), { status: r.status });
  return ((await r.json()).results || []).filter(p => p.url && !/\.gif$/i.test(p.url)).map(p => ({
    extId: String(p.id), src: p.url, credit: [p.creator || '佚名', `${(p.license || '').toUpperCase()} ${p.license_version || ''}`.trim()].join('・'), creditUrl: p.foreign_landing_url, alt: p.title, license: p.license,
  }));
}

export function photoSources() {
  return [config.pexelsKey && ['pexels', pexelsSearch], config.pixabayKey && ['pixabay', pixabaySearch], ['openverse', openverseSearch]].filter(Boolean);
}

async function download(src) {
  const r = await fetch(src, { headers: UA });
  if (!r.ok) throw new Error(`download ${r.status}`);
  const type = r.headers.get('content-type') || '';
  if (!/image\/(jpeg|png|webp)/.test(type)) throw new Error(`not an image: ${type}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 6 * 1024 * 1024) throw new Error('too large');
  const file = `${crypto.randomBytes(9).toString('base64url')}.${/png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg'}`;
  fs.writeFileSync(path.join(LIB_DIR, file), buf);
  return `/lib/${file}`;
}

let filling = false;
// 圖庫暫時連不上（5xx、逾時）：同一個類別 12 小時內不再重試，也不當成需要處理的問題
const cooldown = new Map();
const COOL_MS = 12 * 3600e3;
/** Fill every tag up to MIN_PER_TAG from the first source that works. */
export async function fillLibrary({ force = false, only } = {}) {
  if (filling) return { ok: false, reason: 'busy' };
  filling = true;
  const added = {};
  try {
    const counts = photoCount();
    const ins = db.prepare('INSERT INTO photos (tag,url,thumb,credit,credit_url,source,ext_id,alt,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const has = db.prepare('SELECT 1 FROM photos WHERE source=? AND ext_id=? AND tag=?');
    for (const [name, search] of photoSources().filter(([n]) => !only || n === only)) {
      let failures = 0;
      for (const [tag, [, query]] of Object.entries(PHOTO_TAGS)) {
        const have = photoCount()[tag] || 0;
        if (!force && have >= MIN_PER_TAG) continue;
        if (!force && (cooldown.get(`${name}|${tag}`) || 0) > Date.now()) continue;
        try {
          let n = 0;
          for (const p of await search(query)) {
            if (n >= MIN_PER_TAG - have && !force) break;
            if (has.get(name, p.extId, tag)) continue;
            let url;
            try { url = name === 'pexels' ? p.src : await download(p.src); } catch { continue; }
            ins.run(tag, url, url, p.credit, p.creditUrl, name, p.extId, p.alt ? String(p.alt).slice(0, 200) : null, now());
            n++; added[name] = (added[name] || 0) + 1;
          }
          if (name === 'openverse') await new Promise(r => setTimeout(r, 1200)); // 匿名使用：每秒一次
        } catch (e) {
          failures++;
          const temporary = e.status >= 500 || e.name === 'TimeoutError' || e.name === 'AbortError' || /fetch failed|timeout/i.test(e.message);
          if (temporary) {
            cooldown.set(`${name}|${tag}`, Date.now() + COOL_MS);
            logIssue({ level: 'auto', source: 'photos', message: `${name} 圖庫暫時連不上（${tag}），12 小時後自動再試`, detail: { status: e.status || null } });
          } else logIssue({ level: 'warn', source: 'photos', message: `${name} 搜尋失敗（${tag}）：${e.message}`, error: e });
          if (e.status === 401 || e.status === 403 || e.status === 429 || failures >= 3) break;
        }
      }
    }
  } finally { filling = false; }
  return { ok: true, added, counts: photoCount() };
}
export const fillFromPexels = fillLibrary; // 舊名稱

// ---- AI 生成（用 OpenAI 圖片模型，每張約 NT$0.2；只生成沒有人的風景與物件）----
export async function generatePhotos({ tags, perTag = 3, userId = null } = {}) {
  if (config.mock) return { ok: false, reason: 'mock' };
  const { openai } = await import('./llm.js');
  const out = {};
  for (const tag of tags.filter(t => PHOTO_TAGS[t])) {
    for (let k = 0; k < perTag; k++) {
      try {
        const res = await openai.images.generate({
          model: config.imageModel, size: '1536x1024', quality: 'low', output_format: 'jpeg', output_compression: 82, n: 1,
          prompt: `A candid smartphone photo taken in Taiwan: ${PHOTO_TAGS[tag][1]}. Natural light, realistic everyday photography, slightly imperfect framing, variation ${k + 1}. No people's faces, no text, no logos, no watermarks.`,
        });
        const b64 = res.data?.[0]?.b64_json;
        if (!b64) continue;
        const file = `${crypto.randomBytes(9).toString('base64url')}.jpg`;
        fs.writeFileSync(path.join(LIB_DIR, file), Buffer.from(b64, 'base64'));
        db.prepare('INSERT INTO photos (tag,url,thumb,credit,source,created_at) VALUES (?,?,?,?,?,?)').run(tag, `/lib/${file}`, `/lib/${file}`, 'AI 生成', 'ai', now());
        db.prepare('INSERT INTO usage (user_id,kind,model,units,created_at) VALUES (?,?,?,?,?)').run(userId, 'image', config.imageModel, 1, now());
        out[tag] = (out[tag] || 0) + 1;
      } catch (e) {
        logIssue({ level: 'warn', source: 'photos', message: `AI 生成照片失敗（${tag}）：${e.message}`, error: e });
        if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404) return { ok: false, reason: e.message, added: out };
      }
    }
  }
  return { ok: true, added: out };
}

export function saveUpload(tag, buffer, mimetype, credit) {
  const ext = /png/.test(mimetype) ? 'png' : /webp/.test(mimetype) ? 'webp' : 'jpg';
  const file = `${crypto.randomBytes(9).toString('base64url')}.${ext}`;
  fs.writeFileSync(path.join(LIB_DIR, file), buffer);
  const url = `/lib/${file}`;
  return db.prepare('INSERT INTO photos (tag,url,thumb,credit,source,created_at) VALUES (?,?,?,?,?,?)').run(tag, url, url, credit || null, 'upload', now()).lastInsertRowid;
}
