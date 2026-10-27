// 紀念日：認識幾天、交往紀念日、他的生日、你的生日（從聊天得知）。
// 故事頁顯示倒數；當天他會用自己的方式提起。
import { db, now, j } from './db.js';

const DAY = 864e5;
const tpDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
const at0 = (ymd) => new Date(ymd + 'T00:00:00+08:00').getTime();

function nextYearly(mmdd, from) {
  const y = Number(tpDate(from).slice(0, 4));
  for (const yy of [y, y + 1]) { const d = `${yy}-${mmdd}`; if (at0(d) >= at0(tpDate(from))) return d; }
  return null;
}

// 「生日是 3 月 14 日」「3/14 生日」
export function parseMonthDay(text = '') {
  const m = String(text).match(/(\d{1,2})\s*[月/／.-]\s*(\d{1,2})\s*[日號号]?/);
  if (!m) return null;
  const mm = Number(m[1]), dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function anniversariesFor(rel, persona, { within = 120, from = now() } = {}) {
  const today = tpDate(from);
  const list = [];
  const add = (date, title, kind) => { if (!date) return; const left = Math.round((at0(date) - at0(today)) / DAY); if (left >= 0 && left <= within) list.push({ date, title, kind, left }); };
  const P = persona.gender === 'female' ? '她' : '他';
  // 認識
  const met = tpDate(rel.created_at);
  for (const n of [100, 200, 365, 500, 730, 1000]) add(tpDate(at0(met) + n * DAY), n === 365 ? '認識一週年' : n === 730 ? '認識兩週年' : `認識 ${n} 天`, 'met');
  // 交往
  const t = db.prepare(`SELECT created_at FROM story WHERE rel_id=? AND type='milestone' AND title='你們在一起了'`).get(rel.id);
  if (t && rel.status === 'active') {
    const start = tpDate(t.created_at);
    const [y, m, d] = start.split('-').map(Number);
    for (let k = 1; k <= 11; k++) { const dt = new Date(Date.UTC(y, m - 1 + k, d)); add(dt.toISOString().slice(0, 10), `交往 ${k} 個月`, 'together'); }
    add(tpDate(at0(start) + 100 * DAY), '交往 100 天', 'together');
    for (const n of [1, 2, 3]) add(`${y + n}-${start.slice(5)}`, `交往 ${n} 週年`, 'together');
  }
  // 他的生日
  if (persona.birthday) add(nextYearly(persona.birthday, from), `${persona.name}的生日`, 'his_birthday');
  // 對方的生日、對方在意的日子（從聊天記下的）
  for (const mm of db.prepare(`SELECT content FROM memories WHERE rel_id=? AND kind IN ('anniversary','event','fact')`).all(rel.id)) {
    const md = parseMonthDay(mm.content);
    if (!md) continue;
    const mine = /我.{0,4}生日|對方.{0,4}生日|生日是/.test(mm.content) && !/媽|爸|朋友|同事|姊|姐|哥|弟|妹/.test(mm.content);
    add(nextYearly(md, from), mine ? '你的生日' : mm.content.slice(0, 18), mine ? 'your_birthday' : 'yours');
  }
  // 每月的交往紀念日只留最近的一個，不要洗版
  let monthShown = false;
  const trimmed = list.sort((a, b) => a.left - b.left).filter(x => { if (!/^交往 \d+ 個月$/.test(x.title)) return true; if (monthShown) return false; monthShown = true; return true; });
  const seen = new Set();
  return trimmed.filter(x => { const k = x.date + x.title; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.left - b.left);
}

export function anniversaryReason(a, persona) {
  switch (a.kind) {
    case 'your_birthday': return '今天是對方的生日！第一個（或很早）祝對方生日快樂，依你們的關係階段表達心意；交往後可以說說你準備了什麼小心意。';
    case 'his_birthday': return '今天是你的生日。不要討祝福；可以自然地分享你今天怎麼過。如果對方已經祝你生日快樂，就好好地開心、道謝。';
    case 'together': return `今天是你們「${a.title}」的日子。依你的個性表達（黏人的會很期待、慢熱的會淡淡地但很真心），可以回顧一件你們之間的小事。`;
    case 'met': return `今天是你們「${a.title}」。用你的方式提一下，回想你們第一次見面的樣子，不用太隆重。`;
    default: return `今天是對方提過的日子：「${a.title}」。如果合適，關心一下或祝福。`;
  }
}
