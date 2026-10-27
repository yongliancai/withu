// 後台可以調的系統參數：不用改程式、不用重開，存檔後立刻生效。
// 沒有在後台改過的就用這裡的預設值（部分預設值可以用 .env 覆蓋）。
import { db, now } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`);

const env = process.env;
const n = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const SETTING_DEFS = [
  // 動態
  { key: 'postPerDay', group: '動態', label: '每個角色一天最多幾則動態', type: 'int', min: 0, max: 6, def: 2 },
  { key: 'postGapHours', group: '動態', label: '兩則動態至少間隔幾小時', type: 'num', min: 0, max: 24, def: 4 },
  { key: 'postWindowChance', group: '動態', label: '每個發文時段（午休、下班後、休假午後）發文的機率', type: 'num', min: 0, max: 1, def: 0.5, help: '一天大約兩個時段，0.5 ≈ 平均一天 1 則' },
  // 每日上限（控制費用）
  { key: 'dailyReplyCap', group: '每日上限', label: '每人每天角色最多回幾次', type: 'int', min: 10, max: 2000, def: n(env.DAILY_REPLY_CAP, 150) },
  { key: 'dailyPhotoCap', group: '每日上限', label: '每人每天角色最多看幾張照片', type: 'int', min: 0, max: 500, def: n(env.DAILY_PHOTO_CAP, 20) },
  // 關係節奏
  { key: 'minDaysFriend', group: '關係節奏', label: '認識幾天後才可能變朋友', type: 'num', min: 0, max: 30, def: 2 },
  { key: 'minDaysFlirt', group: '關係節奏', label: '認識幾天後才可能變曖昧', type: 'num', min: 0, max: 60, def: 7 },
  { key: 'affDailyCap', group: '關係節奏', label: '好感一天最多加多少', type: 'int', min: 1, max: 100, def: 15 },
  // 主動訊息
  { key: 'proactiveMult', group: '主動訊息', label: '角色主動找人的頻率（倍數）', type: 'num', min: 0, max: 3, def: 1, help: '1 = 預設；0.5 = 減半；0 = 完全不主動' },
  { key: 'stickerGapTurns', group: '主動訊息', label: '貼圖：至少隔幾輪才再傳', type: 'int', min: 1, max: 30, def: 5 },
  // 其他
  { key: 'maxActive', group: '其他', label: '每人同時最多認識幾個角色', type: 'int', min: 1, max: 20, def: n(env.MAX_ACTIVE_RELATIONSHIPS, 5) },
  { key: 'memoryEvery', group: '其他', label: '每聊幾輪整理一次記憶', type: 'int', min: 2, max: 20, def: 4 },
  // 預算（美元；0 = 不限制）
  { key: 'budgetDailyUsd', group: '預算', label: '每日預算（美元，0 = 不限）', type: 'num', min: 0, max: 10000, def: 0 },
  { key: 'budgetMonthlyUsd', group: '預算', label: '每月預算（美元，0 = 不限）', type: 'num', min: 0, max: 100000, def: 0 },
  { key: 'budgetAlertPct', group: '預算', label: '用到預算的幾 % 時提醒', type: 'int', min: 10, max: 100, def: 80 },
  { key: 'budgetPause', group: '預算', label: '超過預算時暫停角色回覆', type: 'bool', def: true },
];
const DEFS = Object.fromEntries(SETTING_DEFS.map(d => [d.key, d]));

let cache = null;
function load() {
  cache = {};
  for (const r of db.prepare('SELECT key, value FROM app_settings').all()) {
    try { cache[r.key] = JSON.parse(r.value); } catch { /* ignore broken value */ }
  }
}

/** 目前的值（後台改過的，否則預設值）。 */
export function S(key) {
  if (!cache) load();
  return key in cache ? cache[key] : DEFS[key]?.def;
}

export function allSettings() {
  if (!cache) load();
  return SETTING_DEFS.map(d => ({ ...d, value: S(d.key), edited: d.key in cache }));
}

/** 存一個設定；回傳錯誤訊息或 null。value 為 null 代表回到預設值。 */
export function setSetting(key, value) {
  const d = DEFS[key];
  if (!d) return '沒有這個設定';
  if (value === null) {
    db.prepare('DELETE FROM app_settings WHERE key=?').run(key);
  } else {
    let v = value;
    if (d.type === 'bool') v = !!value;
    else {
      v = Number(value);
      if (!Number.isFinite(v)) return `${d.label}：請填數字`;
      if (d.type === 'int') v = Math.round(v);
      if (v < d.min || v > d.max) return `${d.label}：要在 ${d.min}–${d.max} 之間`;
    }
    db.prepare('INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(key, JSON.stringify(v), now());
  }
  load();
  return null;
}
