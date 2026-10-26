// Test-phase metrics: retention, daily messages, token use, cost per user, and willingness-to-pay signals.
import { db, j } from './db.js';
import { config } from './config.js';

const DAY = 864e5;

function costTwd(rows) {
  const p = config.price;
  let usd = 0;
  for (const r of rows) {
    if (r.kind === 'tts') { usd += r.units * p.ttsPerChar; continue; }
    if (r.kind === 'stt') { usd += (r.units / 60) * p.sttPerMin; continue; }
    const good = r.model === config.modelGood;
    const inP = good ? p.goodIn : p.cheapIn, cP = good ? p.goodCached : p.cheapCached, oP = good ? p.goodOut : p.cheapOut;
    usd += ((r.input_tokens - r.cached_tokens) * inP + r.cached_tokens * cP + r.output_tokens * oP) / 1e6;
  }
  return Math.round(usd * p.usdToTwd * 100) / 100;
}

// cohort: 'f' (女性向), 'm' (男性向) or 'all'
export function adminStats(cohort = 'all') {
  const all = db.prepare('SELECT * FROM users ORDER BY created_at').all();
  const users = cohort === 'all' ? all : all.filter(u => (u.cohort || 'f') === cohort);
  const ids = new Set(users.map(u => u.id));
  const mine = (rows) => rows.filter(r => ids.has(r.user_id));
  const t = Date.now();
  const activeOn = (uid, from, to) => !!db.prepare(`SELECT 1 FROM messages WHERE user_id=? AND sender='user' AND created_at>=? AND created_at<?`).get(uid, from, to);
  const retention = (d) => {
    const eligible = users.filter(u => t - u.created_at >= d * DAY);
    if (!eligible.length) return null;
    const kept = eligible.filter(u => activeOn(u.id, u.created_at + d * DAY, Number.MAX_SAFE_INTEGER)).length;
    return { eligible: eligible.length, retained: kept, rate: Math.round((kept / eligible.length) * 100) };
  };

  const perUser = users.map(u => {
    const days = Math.max(1, (t - u.created_at) / DAY);
    const userMsgs = db.prepare(`SELECT COUNT(*) n FROM messages WHERE user_id=? AND sender='user'`).get(u.id).n;
    const charMsgs = db.prepare(`SELECT COUNT(*) n FROM messages WHERE user_id=? AND sender='char'`).get(u.id).n;
    const proactive = db.prepare(`SELECT COUNT(*) n FROM messages WHERE user_id=? AND proactive=1`).get(u.id).n;
    const voice = db.prepare(`SELECT COUNT(*) n FROM messages WHERE user_id=? AND sender='char' AND kind='voice'`).get(u.id).n;
    const usage = db.prepare('SELECT * FROM usage WHERE user_id=?').all(u.id);
    const calls = usage.filter(r => r.kind === 'chat' || r.kind === 'proactive');
    const avgIn = calls.length ? Math.round(calls.reduce((s, r) => s + r.input_tokens, 0) / calls.length) : 0;
    const avgOut = calls.length ? Math.round(calls.reduce((s, r) => s + r.output_tokens, 0) / calls.length) : 0;
    const ev = (name) => db.prepare('SELECT COUNT(*) n FROM events WHERE user_id=? AND name=?').get(u.id, name).n;
    const cost = costTwd(usage);
    const rels = db.prepare('SELECT stage, status, mode FROM relationships WHERE user_id=?').all(u.id);
    return {
      nickname: u.nickname, cohort: u.cohort || 'f', seeks: u.seeks, joined: new Date(u.created_at).toISOString().slice(0, 10), days: Math.round(days),
      userMsgsPerDay: +(userMsgs / days).toFixed(1), charMsgsPerDay: +(charMsgs / days).toFixed(1), proactive, voice,
      avgInputTokens: avgIn, avgOutputTokens: avgOut,
      lifeEvents: { photos: ev('photo_share'), meals: ev('meal_choose'), mealDeclines: ev('meal_decline'), outings: ev('outing_start'), voiceSent: ev('voice_send') },
      relationships: rels.map(r => `${r.status === 'ended' ? '已結束' : ['認識', '朋友', '曖昧', '交往', '長期'][r.stage]}${r.mode === 'real' ? '·真實' : ''}`),
      costTwd: cost, costPerDayTwd: +(cost / days).toFixed(2), projectedMonthlyTwd: Math.round((cost / days) * 30),
    };
  });

  const coming = mine(db.prepare(`SELECT user_id, data FROM events WHERE name IN ('coming_soon_click','coming_soon_price')`).all()).map(r => j(r.data, {}));
  const paid = {};
  for (const d of coming) {
    const k = d.item || 'unknown';
    paid[k] = paid[k] || { clicks: 0, prices: [] };
    if (d.price !== undefined) paid[k].prices.push(d.price); else paid[k].clicks++;
  }
  const usageRows = mine(db.prepare('SELECT * FROM usage').all());
  const totalsMap = {};
  for (const r of usageRows) {
    const k = `${r.kind}|${r.model}`;
    const t0 = totalsMap[k] = totalsMap[k] || { kind: r.kind, model: r.model, i: 0, c: 0, o: 0, u: 0, n: 0 };
    t0.i += r.input_tokens; t0.c += r.cached_tokens; t0.o += r.output_tokens; t0.u += r.units; t0.n++;
  }
  const totals = Object.values(totalsMap);

  const metBy = {};
  for (const c of mine(db.prepare('SELECT user_id, template_id FROM characters WHERE template_id IS NOT NULL').all())) metBy[c.template_id] = (metBy[c.template_id] || 0) + 1;
  const templates = db.prepare(`SELECT id, kind, creator_name, uses, reports, status, data FROM templates`).all()
    .map(t => { const f = j(t.data, {}); return { name: f.name, gender: f.gender, kind: t.kind, creator: t.creator_name, uses: cohort === 'all' ? t.uses : (metBy[t.id] || 0), reports: t.reports, status: t.status }; })
    .sort((x, y) => y.uses - x.uses);

  // 本週摘要（最近 7 天），給每週檢查用
  const wk = t - 7 * DAY;
  const inWeek = (sql, ...args) => mine(db.prepare(sql).all(wk, ...args)).length;
  const weekly = {
    newUsers: users.filter(u => u.created_at >= wk).length,
    activeUsers: users.filter(u => activeOn(u.id, wk, Number.MAX_SAFE_INTEGER)).length,
    userMessages: inWeek(`SELECT user_id FROM messages WHERE created_at>=? AND sender='user'`),
    proactive: inWeek(`SELECT user_id FROM messages WHERE created_at>=? AND proactive=1`),
    replyToProactive: (() => { // 他主動傳訊息後 2 小時內有回覆的比例
      const pro = mine(db.prepare(`SELECT user_id, rel_id, created_at FROM messages WHERE created_at>=? AND proactive=1 AND sender='char'`).all(wk));
      if (!pro.length) return null;
      const replied = pro.filter(m => db.prepare(`SELECT 1 FROM messages WHERE rel_id=? AND sender='user' AND created_at>? AND created_at<?`).get(m.rel_id, m.created_at, m.created_at + 2 * 3600e3)).length;
      return Math.round(replied / pro.length * 100);
    })(),
    feedback: inWeek(`SELECT user_id FROM events WHERE created_at>=? AND name='feedback'`),
    crisis: inWeek(`SELECT user_id FROM events WHERE created_at>=? AND name='crisis'`),
    breakups: inWeek(`SELECT user_id FROM events WHERE created_at>=? AND name='breakup'`),
    habitsAdded: inWeek(`SELECT user_id FROM memories WHERE created_at>=? AND kind='style'`),
    mealsChosen: inWeek(`SELECT user_id FROM events WHERE created_at>=? AND name='meal_choose'`),
    mealsDeclined: inWeek(`SELECT user_id FROM events WHERE created_at>=? AND name='meal_decline'`),
    costTwd: costTwd(usageRows.filter(r => r.created_at >= wk)),
  };
  // 使用者最常提出的相處習慣（看出整體規則哪裡需要調整），只取前 12 條
  const habitCounts = {};
  for (const h of mine(db.prepare(`SELECT user_id, content FROM memories WHERE kind='style'`).all())) {
    const k = h.content.replace(/^對方希望[:：]?/, '').slice(0, 30);
    habitCounts[k] = (habitCounts[k] || 0) + 1;
  }
  const topHabits = Object.entries(habitCounts).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([text, n]) => ({ text, n }));

  return {
    weekly, topHabits,
    templates,
    cohort, cohortCounts: { f: all.filter(u => (u.cohort || 'f') === 'f').length, m: all.filter(u => u.cohort === 'm').length },
    generatedAt: new Date().toISOString(), mock: config.mock, users: users.length,
    retention: { d1: retention(1), d7: retention(7), d30: retention(30) },
    perUser, comingSoon: paid, usageTotals: totals,
    totalCostTwd: costTwd(usageRows),
  };
}
