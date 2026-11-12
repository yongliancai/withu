// 前導劇情的場景插圖：20 張常見場景（Gamma 生成，9:16）。
// 圖片不放進 repo：第一次有人要看時，伺服器從圖庫抓下來、縮成手機用的大小（寬 720、webp）存在資料夾，之後都直接給。
// 抓不到就回 404，前端改用原本的向量場景圖。
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { taipeiParts } from './characters.js';
import { logIssue } from './logger.js';

const BASE = 'https://cdn.gamma.app/3p6oafm8bbhw4ci/design-anything/';
export const ART = {
  rain_arcade: { src: 'sAZn8E1nneLNzLw1LACdU/7GIcFRlbSpGF5VTUmqF38.jpg', label: '雨天騎樓', kw: /雨|騎樓/, fx: 'rain' },
  convenience_store_night: { src: 'CHbU0jqZQLQmjpRxQomrE/MeaPIhKzVHSWvIckT8PKX.jpg', label: '深夜便利商店', kw: /便利商店|超商|小七|全家/, fx: 'night' },
  cafe: { src: '2kCmTJSnpxU8Q6asSPXH4/HIW950luO536enLEMKysd.jpg', label: '咖啡廳', kw: /咖啡/ },
  mrt: { src: 'WdIT14sZFhdKyUbKL7nVR/xOAkKWWhkBhNFxP8qvmYq.jpg', label: '捷運車廂', kw: /捷運|車廂|地鐵|火車|高鐵/ },
  office_day: { src: 'sVDmPI55qcVlq0Du0uDeD/xDQskX4-wTxA8z46ZBn8C.jpg', label: '辦公室', kw: /辦公|公司|同事|會議/ },
  office_night: { src: '97ZD50UbL7Cjbgu20De0u/XVrgr4-tLbJzCCg6m1IVL.jpg', label: '深夜辦公室', kw: /加班/, fx: 'night' },
  bistro: { src: 'R3rJQGiQCZuv0NAD9HA2g/pR36SsAbfVbSRO1wcUmcI.jpg', label: '餐酒館', kw: /聚會|餐酒|酒吧|餐廳|聚餐|朋友/ },
  gym: { src: 'Q8SUwTN2Ll4CBevDUyWLu/k8ZWoZfycuiOo8yF2asoY.jpg', label: '健身房', kw: /健身|重訓|運動中心/ },
  bookstore: { src: 'xpmdvEBbh6ybPpwUZNI9b/3cN2g9k4Jg8Zov8l9-3Fu.jpg', label: '書店', kw: /書店|誠品|二手書/ },
  museum: { src: 'GYgKVvB8ywD9nv3M5Btpu/03gVl5Xnbh1UqpZlupBW-.jpg', label: '美術館', kw: /展覽|美術館|博物館|展場/ },
  hospital: { src: '7HCNqhl77WPnkntnBIWJR/-JvaXiT3q0KZDyck1Sl13.jpg', label: '醫院', kw: /醫院|病房|診所|護理/ },
  park_dusk: { src: 'vQHwnMBCrTrgG7T922l0B/ocb_QM97nXvdgUDN6uzwh.jpg', label: '公園', kw: /公園|河堤|河濱|散步|遛狗/, fx: 'dusk' },
  night_market: { src: 'lgGUmzjEYSkcSqtZkxKXG/4rhXgmAG-mV1ZOmkXVUrz.jpg', label: '夜市', kw: /夜市|小吃|攤販/, fx: 'night' },
  library: { src: 'VdeaQUPbf3AihCXlcXP38/qOsdz0vDmuuruuXS4zr24.jpg', label: '圖書館', kw: /圖書館|自習/ },
  bus_stop: { src: '9NmajX59ozFPXOvlCKgC8/RpkNet3yFNbD2rQyWoGpu.jpg', label: '公車站', kw: /公車|站牌|等車/ },
  supermarket: { src: 'H4woWxhcCf2z9W5XNF7qK/0n9hDopXk4KvgtXWiFA7U.jpg', label: '超市', kw: /超市|全聯|量販|家樂福/ },
  campus: { src: '5TNx5d4diNCfCi2Vv3T68/dlUbz34Ln7dxgGcKfCMBC.jpg', label: '大學校園', kw: /校園|大學|學校|社團|同學|學長|學姊|學妹|學弟/ },
  beach_sunset: { src: 'IV0CoSrKtNq0qB9r4oOXl/QKOEEj-0EXvaGfzHxQrhh.jpg', label: '海邊', kw: /海邊|海灘|沙灘|海/, fx: 'dusk' },
  breakfast_shop: { src: 'PnElnTkpcq2mOVlrQpTER/4oGDwvbbldHwXFK0KUlUs.jpg', label: '早餐店', kw: /早餐/ },
  home_alley_night: { src: 'U74Oztnm4ck5a4QMBmpO4/EZVyvFLGGl4-2MUFxWQbB.jpg', label: '住家巷口', kw: /巷口|巷子|鄰居|樓下|社區/, fx: 'night' },
};
const BY_SCENARIO = { cafe: 'cafe', mrt: 'mrt', colleague: 'office_day', store: 'convenience_store_night', rain: 'rain_arcade', friends: 'bistro', gym: 'gym', bookstore: 'bookstore', exhibition: 'museum',
  night_market: 'night_market', library: 'library', last_bus: 'bus_stop', supermarket: 'supermarket', club_fair: 'campus', sunset_beach: 'beach_sunset', breakfast: 'breakfast_shop',
  parcel: 'home_alley_night', clinic: 'hospital', dog_park: 'park_dusk', late_office: 'office_night', blackout: 'office_night', livehouse: 'bistro', delayed_flight: 'mrt',
  bar_counter: 'bistro', salon: 'cafe', flower_shop: 'cafe', tea_hill: 'park_dusk', workshop: 'office_day', book_talk: 'bookstore' };

/** 依情境（預設情境 id 或自己寫的文字）和現在的時間挑一張場景圖。 */
export function artFor({ scenarioId, text = '', ts = Date.now() } = {}) {
  const h = taipeiParts(ts).hour;
  let key = BY_SCENARIO[scenarioId] || null;
  if (!key && text) key = Object.keys(ART).find(k => ART[k].kw.test(text)) || null;
  if (key === 'office_day' && (h >= 20 || h < 6)) key = 'office_night';
  return key;
}

/** 場景特效：下雨、夜晚、黃昏（依圖和現在的時間）。 */
export function fxFor(key, text = '', ts = Date.now()) {
  const h = taipeiParts(ts).hour;
  if (key && ART[key]?.fx === 'rain' || /雨/.test(text)) return 'rain';
  if (h >= 19 || h < 6) return 'night';
  if (h >= 16) return 'dusk';
  return ART[key]?.fx || '';
}

const DIR = path.join(config.dataDir, 'scenes');
const inflight = new Map();
export async function sceneArtFile(key) {
  if (!ART[key]) return null;
  const out = path.join(DIR, `${key}.webp`);
  if (fs.existsSync(out)) return out;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const r = await fetch(BASE + ART[key].src, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(DIR, { recursive: true });
      await sharp(buf).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 74 }).toFile(out);
      return out;
    } catch (e) {
      logIssue({ level: 'warn', source: 'photos', message: `場景插圖下載失敗（${key}）：${e.message}`, error: e });
      return null;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}
