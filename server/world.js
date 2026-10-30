// 他活在同一個世界：住哪一區、那邊的真實天氣（Open-Meteo，免費不用金鑰）、台灣的國定假日與節日。
// 使用者在哪裡只從聊天得知（記憶裡的「地區」），不定位、不問設定。
import { db, now } from './db.js';
import { taipeiParts } from './characters.js';
import { logIssue } from './logger.js';

// 縣市與常見區域的大約座標
export const PLACES = {
  '台北市中正區': [25.032, 121.518], '台北市大同區': [25.063, 121.513], '台北市中山區': [25.064, 121.533], '台北市松山區': [25.050, 121.577],
  '台北市大安區': [25.026, 121.543], '台北市萬華區': [25.035, 121.500], '台北市信義區': [25.033, 121.567], '台北市士林區': [25.093, 121.525],
  '台北市北投區': [25.132, 121.501], '台北市內湖區': [25.069, 121.589], '台北市南港區': [25.054, 121.607], '台北市文山區': [24.989, 121.570],
  '新北市板橋區': [25.011, 121.462], '新北市三重區': [25.061, 121.487], '新北市中和區': [24.999, 121.499], '新北市永和區': [25.008, 121.516],
  '新北市新店區': [24.968, 121.541], '新北市新莊區': [25.036, 121.450], '新北市淡水區': [25.170, 121.440], '新北市汐止區': [25.063, 121.658],
  '台北市': [25.038, 121.564], '新北市': [25.012, 121.466], '基隆市': [25.128, 121.739], '桃園市': [24.993, 121.301], '新竹市': [24.804, 120.968],
  '新竹縣': [24.839, 121.018], '苗栗縣': [24.560, 120.821], '台中市': [24.148, 120.674], '彰化縣': [24.080, 120.542], '南投縣': [23.911, 120.684],
  '雲林縣': [23.709, 120.431], '嘉義市': [23.480, 120.449], '嘉義縣': [23.452, 120.255], '台南市': [22.999, 120.227], '高雄市': [22.627, 120.301],
  '屏東縣': [22.672, 120.488], '宜蘭縣': [24.702, 121.738], '花蓮縣': [23.992, 121.601], '台東縣': [22.756, 121.144], '澎湖縣': [23.571, 119.579],
  '金門縣': [24.437, 118.318], '連江縣': [26.160, 119.950],
};
const ALIASES = [
  [/臺/g, '台'],
];
const SHORT = { 台北: '台北市', 新北: '新北市', 基隆: '基隆市', 桃園: '桃園市', 新竹: '新竹市', 苗栗: '苗栗縣', 台中: '台中市', 彰化: '彰化縣', 南投: '南投縣', 雲林: '雲林縣',
  嘉義: '嘉義市', 台南: '台南市', 高雄: '高雄市', 屏東: '屏東縣', 宜蘭: '宜蘭縣', 花蓮: '花蓮縣', 台東: '台東縣', 澎湖: '澎湖縣', 金門: '金門縣', 馬祖: '連江縣',
  竹北: '新竹縣', 中壢: '桃園市', 板橋: '新北市板橋區', 三重: '新北市三重區', 中和: '新北市中和區', 永和: '新北市永和區', 新店: '新北市新店區', 新莊: '新北市新莊區',
  淡水: '新北市淡水區', 汐止: '新北市汐止區', 內湖: '台北市內湖區', 南港: '台北市南港區', 信義區: '台北市信義區', 大安: '台北市大安區', 士林: '台北市士林區',
  北投: '台北市北投區', 西門: '台北市萬華區', 萬華: '台北市萬華區', 中山區: '台北市中山區', 松山: '台北市松山區', 文山: '台北市文山區', 公館: '台北市中正區' };

/** Find a place name in free text (e.g. a memory like「在新竹科學園區上班」). */
export function placeFromText(text = '') {
  let t = String(text);
  for (const [re, to] of ALIASES) t = t.replace(re, to);
  for (const k of Object.keys(PLACES).filter(k => k.length > 3).sort((a, b) => b.length - a.length)) if (t.includes(k)) return k;
  for (const [k, v] of Object.entries(SHORT).sort((a, b) => b[0].length - a[0].length)) if (t.includes(k)) return v;
  return null;
}

/** Where she is, as far as he knows from chatting (most recent area memory that names a place). */
export function userPlace(relId) {
  const rows = db.prepare(`SELECT content FROM memories WHERE rel_id=? AND kind IN ('area','fact','schedule') ORDER BY updated_at DESC LIMIT 30`).all(relId);
  for (const r of rows) { const p = placeFromText(r.content); if (p) return p; }
  return null;
}

// ---- weather ----
const WMO = { 0: '晴朗', 1: '大致晴朗', 2: '多雲', 3: '陰天', 45: '有霧', 48: '有霧', 51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨', 61: '小雨', 63: '下雨', 65: '大雨',
  80: '陣雨', 81: '陣雨', 82: '大陣雨', 95: '雷雨', 96: '雷雨', 99: '雷雨', 71: '下雪', 73: '下雪', 75: '大雪' };
const cache = new Map();
export async function weatherAt(place) {
  const ll = PLACES[place];
  if (!ll) return null;
  const hit = cache.get(place);
  if (hit && now() - hit.at < (hit.data ? 30 : 10) * 60000) return hit.data;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${ll[0]}&longitude=${ll[1]}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=Asia/Taipei&forecast_days=2`;
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    const d = await r.json();
    const data = {
      now: { desc: WMO[d.current.weather_code] || '', temp: Math.round(d.current.temperature_2m), feels: Math.round(d.current.apparent_temperature), wind: Math.round(d.current.wind_speed_10m) },
      today: { desc: WMO[d.daily.weather_code[0]] || '', max: Math.round(d.daily.temperature_2m_max[0]), min: Math.round(d.daily.temperature_2m_min[0]), pop: d.daily.precipitation_probability_max[0], wind: Math.round(d.daily.wind_speed_10m_max[0]) },
      tomorrow: { desc: WMO[d.daily.weather_code[1]] || '', max: Math.round(d.daily.temperature_2m_max[1]), min: Math.round(d.daily.temperature_2m_min[1]), pop: d.daily.precipitation_probability_max[1], wind: Math.round(d.daily.wind_speed_10m_max[1]) },
    };
    cache.set(place, { at: now(), data });
    return data;
  } catch (e) {
    if (!hit) logIssue({ level: /timeout|abort|fetch failed/i.test(e.message) ? 'auto' : 'warn', source: 'weather', message: `天氣查詢失敗：${e.message}`, error: e });
    cache.set(place, { at: now(), data: hit?.data || null }); // 失敗也記一下，10 分鐘內不重試
    return hit?.data || null;
  }
}

export function weatherLine(place, w) {
  if (!w) return null;
  const windy = w.today.wind >= 50 ? '，風很大（可能有颱風或東北季風）' : '';
  return `${place}現在${w.now.desc} ${w.now.temp}°C（體感 ${w.now.feels}°C）；今天 ${w.today.min}–${w.today.max}°C，降雨機率 ${w.today.pop ?? '?'}%${windy}；明天${w.tomorrow.desc}，${w.tomorrow.min}–${w.tomorrow.max}°C，降雨機率 ${w.tomorrow.pop ?? '?'}%`;
}

// ---- holidays & festivals ----
// 國定假日依人事行政總處 115、116 年辦公日曆表；節日（不放假）另列
export const DAYS = [
  ['2026-10-31', '萬聖節', 'festival'], ['2026-11-11', '雙十一購物節', 'festival'], ['2026-12-22', '冬至（吃湯圓）', 'festival'],
  ['2026-12-24', '平安夜', 'festival'], ['2026-12-25', '聖誕節・行憲紀念日（放假）', 'holiday'], ['2026-12-31', '跨年夜', 'festival'],
  ['2027-01-01', '元旦（1/1–1/3 連假）', 'holiday'], ['2027-02-04', '春節連假開始（2/4–2/10）', 'holiday'], ['2027-02-05', '除夕', 'holiday'],
  ['2027-02-06', '大年初一', 'holiday'], ['2027-02-14', '情人節', 'festival'], ['2027-02-20', '元宵節', 'festival'],
  ['2027-02-28', '和平紀念日（2/27–3/1 連假）', 'holiday'], ['2027-03-14', '白色情人節', 'festival'], ['2027-04-04', '兒童節（4/3–4/6 連假）', 'holiday'],
  ['2027-04-05', '清明節', 'holiday'], ['2027-05-01', '勞動節（4/30–5/2 連假）', 'holiday'], ['2027-05-09', '母親節', 'festival'],
  ['2027-05-20', '520（我愛你）', 'festival'], ['2027-06-09', '端午節（放假）', 'holiday'], ['2027-08-08', '七夕情人節・父親節', 'festival'],
  ['2027-08-16', '中元節', 'festival'], ['2027-09-15', '中秋節（放假）', 'holiday'], ['2027-09-28', '教師節（放假）', 'holiday'],
  ['2027-10-10', '國慶日（10/9–10/11 連假）', 'holiday'], ['2027-10-25', '臺灣光復節（10/23–10/25 連假）', 'holiday'], ['2027-10-31', '萬聖節', 'festival'],
  ['2027-12-22', '冬至（吃湯圓）', 'festival'], ['2027-12-24', '平安夜（行憲紀念日補假）', 'holiday'], ['2027-12-25', '聖誕節・行憲紀念日', 'holiday'],
  ['2027-12-31', '跨年夜（元旦補假）', 'holiday'],
];

export function upcomingDays(ts = now(), within = 3) {
  const t = taipeiParts(ts);
  const today = new Date(t.date + 'T00:00:00+08:00').getTime();
  return DAYS.map(([d, name, kind]) => ({ d, name, kind, diff: Math.round((new Date(d + 'T00:00:00+08:00').getTime() - today) / 864e5) }))
    .filter(x => x.diff >= 0 && x.diff <= within);
}

export function daysLine(ts = now()) {
  const list = upcomingDays(ts, 3);
  if (!list.length) return null;
  return list.map(x => `${x.diff === 0 ? '今天' : x.diff === 1 ? '明天' : `${x.diff} 天後（${x.d.slice(5).replace('-', '/')}）`}是${x.name}`).join('；');
}

/** Context lines for one turn (weather for his place and hers, holidays). Never throws. */
export async function worldContext(persona, relId) {
  const out = [];
  try {
    const mine = persona.home && PLACES[persona.home] ? persona.home : null;
    const hers = relId ? userPlace(relId) : null;
    const [wm, wh] = await Promise.all([mine ? weatherAt(mine) : null, hers && hers !== mine ? weatherAt(hers) : null]);
    if (wm) out.push(`你那邊（你住在${mine}）：${weatherLine(mine, wm)}`);
    if (hers) out.push(wh ? `對方那邊（從聊天知道對方在${hers}）：${weatherLine(hers, wh)}` : `對方在${hers}（從聊天知道的）。`);
    else out.push('你還不知道對方住在哪個城市；需要時可以自然地問（例如「你那邊也在下雨嗎？」），不要假設。');
    const dl = daysLine();
    if (dl) out.push(`日子：${dl}`);
  } catch { /* weather is a nice-to-have */ }
  return out;
}
