// 上線狀態：依角色自己的作息決定「現在在不在線上」以及「多久會回」。
// online 上線中 | away 離線（最後上線…）| busy 忙碌（上班中）| dnd 勿擾（睡覺）
import { charStatus, taipeiParts, toMin, sleepWindow } from './characters.js';

// 用時段當種子的固定亂數：同一個半小時內，狀態不會一直跳
function slotRand(seed, slot) {
  let h = 2166136261;
  for (const c of `${seed}|${slot}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

const MIN = 60000;

/**
 * @returns {{ code, label, lastSeen, delay: [minMs, maxMs] }}
 * delay 是「對方傳訊息後，他多久才會開始回」。
 */
export function presenceOf(rel, persona, ts = Date.now()) {
  const st = charStatus(persona, ts);
  const chatting = (rel.last_char_msg_at && ts - rel.last_char_msg_at < 6 * MIN) || (rel.last_user_msg_at && ts - rel.last_user_msg_at < 3 * MIN && rel.last_char_msg_at && rel.last_char_msg_at > rel.last_user_msg_at - 10 * MIN);
  const lover = rel.stage >= 3;
  const clingy = persona.proactivity === 'clingy';

  if (chatting && st.code !== 'working') return { code: 'online', label: '上線中', delay: [0, 0] };
  if (st.code === 'sleeping') {
    return { code: 'dnd', label: '睡覺中', lastSeen: lastSeen(rel, ts), delay: null, wakeAt: wakeTime(persona, ts) };
  }
  if (st.code === 'working') {
    if (chatting) return { code: 'busy', label: '上班中・偷空回你', delay: [15e3, 60e3] };
    const k = lover || clingy ? 1 : 2;
    return { code: 'busy', label: '上班中・可能晚點回', lastSeen: lastSeen(rel, ts), delay: [k * 1 * MIN, k * 4 * MIN] };
  }
  if (st.code === 'commute_in' || st.code === 'commute_out') {
    return { code: 'online', label: st.code === 'commute_in' ? '通勤中' : '下班路上', delay: [0, 0] };
  }
  // 下班或休假：有時候在線上，有時候手機放旁邊
  const slot = Math.floor(ts / (30 * MIN));
  const onlineChance = (lover ? 0.65 : 0.45) + (clingy ? 0.15 : 0);
  if (chatting || slotRand(persona._char?.id || persona.name, slot) < onlineChance) {
    return { code: 'online', label: st.code === 'late' ? '上線中・快睡了' : '上線中', delay: [0, 0] };
  }
  return { code: 'away', label: '離線', lastSeen: lastSeen(rel, ts, slot), delay: [40e3, 2.5 * MIN] };
}

function lastSeen(rel, ts, slot) {
  // 真的最後一次說話，或這個時段開始前不久（看起來剛滑過手機）
  const fake = slot ? slot * 30 * MIN - Math.round(slotRand(rel.id, slot) * 25) * MIN : null;
  const real = rel.last_char_msg_at || null;
  const v = Math.max(real || 0, fake || 0);
  return v && ts - v < 3 * 864e5 ? v : null;
}

// 他起床的時間：上班日比上班早一小時，休假 8:30 左右
function wakeTime(persona, ts) {
  const t = taipeiParts(ts);
  const s = persona.schedule || { start: '09:00', days: [1, 2, 3, 4, 5] };
  const workday = s.days.includes(t.weekday);
  const [, sleepEnd] = sleepWindow(persona);
  const nightType = sleepEnd > 9 * 60; // 晚上工作的人：睡到自然醒
  const wakeMin = nightType ? sleepEnd : workday ? Math.min(9 * 60, Math.max(6 * 60 + 30, toMin(s.start) - 60)) : Math.max(8 * 60 + 30, sleepEnd);
  let mins = wakeMin - t.minutes;
  if (mins < 0) mins += 24 * 60;
  return ts + (mins + Math.round(slotRand(persona.name, t.date) * 20)) * MIN;
}

/** How long to wait before he starts replying, or 0 for "reply now". */
export function replyDelayMs(rel, persona, { crisis = false, settings = {}, ts = Date.now() } = {}) {
  if (crisis || settings.realisticDelay === false) return 0;
  if (rel.outing_active || rel.activity) return 0;
  const p = presenceOf(rel, persona, ts);
  if (p.code === 'dnd') return Math.max(0, p.wakeAt - ts);
  const [a, b] = p.delay || [0, 0];
  return Math.round(a + Math.random() * (b - a));
}
