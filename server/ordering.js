// 下單轉接層 — the chat UI always shows the same confirmation card.
// Behind it, ORDER_MODE decides how an order happens:
//   redirect : open the Uber Eats search page for that store + item (demo, works today)
//   api      : place the order through Uber's Consumer Delivery API after a WebAuthn (Face ID) check.
//              Not implemented until Uber approves the application; see DEPLOY.md.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { activeTrends } from './adminRoutes.js';

export function orderLink(option) {
  const q = `${option.store} ${option.item}`.trim();
  return `https://www.ubereats.com/tw/search?q=${encodeURIComponent(q)}`;
}

export function buildMealCard(options) {
  return {
    type: 'meal',
    mode: config.orderMode,
    options: options.slice(0, 3).map((o, i) => ({ idx: i, store: o.store, item: o.item, line: o.line, is_trend: !!o.is_trend, url: orderLink(o) })),
  };
}

// Admin-maintained list of new / trending items, each with an official source.
// The model may only recommend "new items" that appear here.
export function loadTrends() {
  // 後台「流行新品」頁面管理的清單，加上舊版的 data/trends.json（如果有）
  let fromFile = [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    fromFile = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'trends.json'), 'utf8')).filter(t => !t.until || t.until >= today);
  } catch {}
  return [...activeTrends(), ...fromFile].slice(0, 12);
}
