// 費用監控與預算上限：算今天、這個月花了多少；超過預算時暫停 AI（危機訊息除外）。
import { db, now } from './db.js';
import { config } from './config.js';
import { S } from './settings.js';
import { taipeiParts } from './characters.js';
import { logIssue } from './logger.js';

/** 一列 usage 的花費（美元）。 */
export function rowUsd(r) {
  const p = config.price;
  if (r.model === 'mock') return 0;
  if (r.kind === 'tts') return r.units * p.ttsPerChar;
  if (r.kind === 'stt') return (r.units / 60) * p.sttPerMin;
  if (r.kind === 'image') return r.units * p.imageLow;
  if (r.kind === 'portrait') return r.units * p.imageHigh;
  if (r.model === 'mock') return 0;
  const good = r.model === config.modelGood;
  const inP = good ? p.goodIn : p.cheapIn, cP = good ? p.goodCached : p.cheapCached, oP = good ? p.goodOut : p.cheapOut;
  return ((r.input_tokens - r.cached_tokens) * inP + r.cached_tokens * cP + r.output_tokens * oP) / 1e6;
}
export const sumUsd = (rows) => rows.reduce((a, r) => a + rowUsd(r), 0);

// 台灣時間的今天 0 點、這個月 1 號 0 點
export function periodStarts() {
  const t = taipeiParts();
  const day = now() - t.minutes * 60000 - (Date.now() % 60000);
  const [y, m] = t.date.split('-').map(Number);
  const month = Date.parse(`${y}-${String(m).padStart(2, '0')}-01T00:00:00+08:00`);
  return { day, month };
}

let cached = null, cachedAt = 0;
const alerted = new Set();
/** 目前的預算狀態（快取 60 秒）。 */
export function budgetState() {
  if (cached && Date.now() - cachedAt < 60000) return cached;
  const { day, month } = periodStarts();
  const rows = db.prepare('SELECT kind, model, input_tokens, cached_tokens, output_tokens, units, created_at FROM usage WHERE created_at>=?').all(month);
  const monthUsd = sumUsd(rows);
  const dayUsd = sumUsd(rows.filter(r => r.created_at >= day));
  const dl = S('budgetDailyUsd'), ml = S('budgetMonthlyUsd');
  const dayPct = dl > 0 ? Math.round(dayUsd / dl * 100) : 0;
  const monthPct = ml > 0 ? Math.round(monthUsd / ml * 100) : 0;
  const over = (dl > 0 && dayUsd >= dl) || (ml > 0 && monthUsd >= ml);
  const alert = over || dayPct >= S('budgetAlertPct') || monthPct >= S('budgetAlertPct');
  cached = { dayUsd, monthUsd, dailyLimit: dl, monthlyLimit: ml, dayPct, monthPct, over, alert, paused: over && !!S('budgetPause') };
  cachedAt = Date.now();
  // 每天每種狀況只寫一次紀錄，後台「系統紀錄」看得到
  const key = `${taipeiParts().date}|${over ? 'over' : alert ? 'alert' : ''}`;
  if (alert && !alerted.has(key)) {
    alerted.add(key);
    logIssue({ level: over ? 'error' : 'warn', source: 'budget', message: over
      ? `已超過預算（今天 US$${dayUsd.toFixed(2)}／本月 US$${monthUsd.toFixed(2)}）${cached.paused ? '，AI 回覆已暫停' : ''}`
      : `花費快到預算了（今天 ${dayPct}%／本月 ${monthPct}%）`, detail: cached });
  }
  return cached;
}
export const budgetPaused = () => budgetState().paused;
export function resetBudgetCache() { cached = null; }
