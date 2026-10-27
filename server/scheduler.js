// 主動排程引擎：decides when he reaches out (報備、早安晚安、吃飯關心、跟進、好久不見).
// Frequency = his personality × relationship stage × how she responds × her own settings (highest priority).
import { db, now, j } from './db.js';
import { config } from './config.js';
import { PROACTIVITY, taipeiParts, toMin, charStatus } from './characters.js';
import { runTurn, getPersona, finishOuting, endActivity } from './engine.js';
import { logIssue } from './logger.js';
import { generatePost, postMoment } from './feed.js';
import { shouldHoldProactive, gapLabel as gapLabelFn } from './review.js';

const STAGE_MULT = [0.3, 0.6, 0.9, 1.2, 1.2];
const LEVEL_MULT = { low: 0.5, normal: 1, high: 1.5 };

function inWindow(m, from, to) { return m >= from && m <= to; }
function dndActive(settings, m) {
  const s = toMin(settings.dndStart || '23:30'), e = toMin(settings.dndEnd || '07:30');
  return s <= e ? (m >= s && m < e) : (m >= s || m < e);
}

function candidates(rel, persona, settings, t, log = {}) {
  const m = t.minutes;
  const s = persona.schedule;
  const workday = s.days.includes(t.weekday);
  const start = toMin(s.start), end = toMin(s.end);
  const lunch = toMin(settings.lunchAt || '12:15'), dinner = toMin(settings.dinnerAt || '19:00');
  const list = [];
  if (workday && rel.stage >= 1 && inWindow(m, start - 40, start - 10))
    list.push({ key: 'before_work', prob: rel.stage >= 3 ? 1 : 0.4, reason: `你準備出門去${persona.workplace}上班了，跟對方報備（今天幾點下班）。` });
  if (workday && rel.stage >= 1 && inWindow(m, end, end + 30))
    list.push({ key: 'after_work', prob: rel.stage >= 3 ? 1 : 0.4, voice: rel.stage >= 3, reason: '你剛下班，跟對方報備，分享一件今天工作上的小事，問問對方今天怎麼樣。' });
  if (rel.stage >= 3 && inWindow(m, 7 * 60 + 40, 8 * 60 + 40))
    list.push({ key: 'morning', prob: 0.9, voice: true, reason: '早安。可以順便提醒天氣或對方今天要做的事（如果你知道）。' });
  if (rel.stage >= 2 && inWindow(m, 22 * 60 + 30, 23 * 60 + 15))
    list.push({ key: 'night', prob: rel.stage >= 3 ? 0.9 : 0.4, voice: rel.stage >= 3, reason: '晚安前的一句話。' });
  if (rel.stage >= 1 && rel.meal_declined < 3 && (inWindow(m, lunch, lunch + 25) || inWindow(m, dinner, dinner + 30)) &&
      !(rel.last_user_msg_at && now() - rel.last_user_msg_at < 30 * 60000))
    list.push({ key: m < 15 * 60 ? 'lunch' : 'dinner', prob: rel.stage >= 3 ? 0.8 : 0.35, reason: '到對方平常吃飯的時間了。先問對方吃了沒，不要直接推薦餐點。' });
  // 他寄的風景明信片：一週一次，休假日的下午
  if (rel.stage >= 1 && !workday && inWindow(m, 14 * 60, 17 * 60) && !(log.lastPostcard && now() - log.lastPostcard < 6 * 864e5))
    list.push({ key: 'postcard', prob: 0.6, reason: '你今天休假出門走走，寄一張明信片給對方：挑一個你看到的風景，寫一句想對對方說的話（填 postcard）。訊息本身簡短就好。' });
  // 分享自己的生活：一天一次，在他有空的時段（下班後或休假的下午）
  const free = !workday || m >= end + 30;
  const shareProb = { clingy: 0.7, independent: 0.35, slow: 0.2 + rel.stage * 0.1 }[persona.proactivity] ?? 0.3;
  if (rel.stage >= 1 && free && (inWindow(m, 15 * 60, 17 * 60 + 30) || inWindow(m, 20 * 60 + 30, 21 * 60 + 40)))
    list.push({ key: 'share', prob: shareProb, reason: '分享一件你自己今天生活裡的小事（可以從「你生活中正在進行的事」延伸），具體、有畫面。說完就停，不一定要問問題；可以寫 life_post。' });
  if (rel.stage >= 1 && rel.last_user_msg_at && now() - rel.last_user_msg_at > 2 * 864e5 && inWindow(m, 19 * 60, 21 * 60))
    list.push({ key: 'checkin', prob: 0.7, every: 2, reason: '對方好幾天沒來了。不生氣、不討拍，心疼對方：「這幾天很累吧？」' });
  return list;
}

async function tickRel(rel, user, t, userSentToday) {
  const settings = j(user.settings, {});
  const persona = getPersona(rel);
  const log = j(rel.proactive_log, {});
  const today = log.date === t.date ? log : { date: t.date, sent: {}, count: 0 };

  // Outing auto-ends after 3 quiet hours.
  if (rel.outing_active && rel.last_user_msg_at && now() - rel.last_user_msg_at > 3 * 3600e3) {
    await finishOuting(rel, persona, user);
    return;
  }
  if (rel.outing_active) return;
  // 舊版散步：直接結束，不另外通知
  if (rel.walk_started_at) db.prepare('UPDATE relationships SET walk_started_at=NULL WHERE id=?').run(rel.id);
  // 他在忙／睡覺時收到的訊息：時間到了才回，並推播通知
  if (rel.pending_reply_at) {
    if (rel.pending_reply_at > now()) return;
    const texts = db.prepare(`SELECT text FROM messages WHERE rel_id=? AND sender='user' AND id>? ORDER BY id`).all(rel.id, rel.char_read_id || 0).map(r => r.text).filter(Boolean);
    const lastUser = db.prepare(`SELECT created_at FROM messages WHERE rel_id=? AND sender IN ('user','system') ORDER BY id DESC LIMIT 1`).get(rel.id);
    const minutes = Math.max(1, Math.round((now() - (lastUser?.created_at || now())) / 60000));
    const st = charStatus(persona);
    const why = st.code === 'free' || st.code === 'commute_out' || st.code === 'commute_in' ? (minutes > 120 ? '在睡覺／在忙' : '在忙') : st.code === 'working' ? '在忙工作' : '在睡覺';
    const morning = t.minutes >= 6 * 60 && t.minutes < 10 * 60 && minutes > 120;
    db.prepare('UPDATE relationships SET pending_reply_at=NULL WHERE id=?').run(rel.id);
    await runTurn({ user, relId: rel.id, userText: texts.join('\n'), lateReply: { minutes, why: morning ? '在睡覺（現在剛起床）' : why }, notifyUser: true, triggerKey: 'late_reply' });
    return;
  }
  // 他自己發動態（不傳訊息、不推播）：一天最多兩則，間隔至少三小時
  const moment = rel.stage >= 0 && postMoment(persona, rel, t);
  if (moment) {
    const last = db.prepare('SELECT MAX(created_at) at, SUM(created_at>?) today FROM posts WHERE rel_id=?').get(now() - t.minutes * 60000, rel.id);
    if ((last.today || 0) < 2 && (!last.at || now() - last.at > 3 * 3600e3) && Math.random() < (config.schedulerMs >= 60000 ? 0.04 : 0.3)) {
      await generatePost(rel, persona, moment).catch(e => logIssue({ level: 'warn', source: 'scheduler', message: `發動態失敗：${e.message}`, error: e, relId: rel.id }));
    }
  }
  // 一起做的事：時間到就結束（陪專心會來問進度）
  const act = j(rel.activity);
  if (act) {
    if (act.ends_at <= now()) await endActivity(rel, user, { reason: 'time' });
    return;
  }
  if (dndActive(settings, t.minutes)) return;
  if (userSentToday.count >= (Number(settings.dailyCap) || 6)) return;
  if (rel.user_busy_until && rel.user_busy_until > now()) return;

  // Follow-ups she created by talking ("明天十點要報告") always win, they are the most personal.
  const due = db.prepare('SELECT * FROM followups WHERE rel_id=? AND done=0 AND due_at<=? ORDER BY due_at LIMIT 1').get(rel.id, now());
  const pro = PROACTIVITY[persona.proactivity] || PROACTIVITY.slow;
  let budget = pro.base * STAGE_MULT[rel.stage] * (LEVEL_MULT[settings.proactiveLevel] || 1);
  if (persona.proactivity === 'slow') budget *= 0.7 + rel.stage * 0.25; // 慢熱型越熟越常找你
  if (rel.unanswered >= 2) budget *= 0.5;                                 // 常已讀不回就收斂
  const capped = today.count >= Math.max(1, Math.round(budget));

  let pick = null;
  const holdFollowup = due && shouldHoldProactive(rel, persona, 'followup');
  const holdOther = shouldHoldProactive(rel, persona, 'other');
  if (due && !holdFollowup) pick = { key: 'followup', reason: `跟進對方之前提過的事：${due.topic}${now() - due.due_at > 3 * 3600e3 ? `（原本想在 ${gapLabelFn(now() - due.due_at)}前問，現在已經晚了，說法要自然）` : ''}` };
  else if (!due && !holdOther && !capped && rel.unanswered < 4) {
    for (const c of candidates(rel, persona, settings, t, log)) {
      if (today.sent[c.key]) continue;
      if (c.every && log.lastCheckin && now() - log.lastCheckin < c.every * 864e5) continue;
      today.sent[c.key] = true; // decide once per window per day, whether or not it fires
      if (Math.random() <= c.prob) { pick = c; break; }
    }
  }
  if (!pick) {
    db.prepare('UPDATE relationships SET proactive_log=? WHERE id=?').run(JSON.stringify({ ...today, lastCheckin: log.lastCheckin, lastPostcard: log.lastPostcard }), rel.id);
    return;
  }
  today.count++;
  const newLog = { ...today, lastCheckin: pick.key === 'checkin' ? now() : log.lastCheckin, lastPostcard: pick.key === 'postcard' ? now() : log.lastPostcard };
  db.prepare('UPDATE relationships SET proactive_log=?, unanswered=unanswered+1 WHERE id=?').run(JSON.stringify(newLog), rel.id);
  userSentToday.count++;
  const sentMsgs = await runTurn({ user, relId: rel.id, trigger: `${pick.reason}（如果和「你們之間的相處習慣」衝突，以相處習慣為準，改用其他自然的話。）`, triggerKey: pick.key, voiceMoment: !!pick.voice });
  // 發送前檢查取消了：不算一次主動、也不算對方沒回
  if (!sentMsgs.length) {
    db.prepare('UPDATE relationships SET unanswered=MAX(unanswered-1,0) WHERE id=?').run(rel.id);
    userSentToday.count--;
  }
}

let running = false;
export async function tick() {
  if (running) return;
  running = true;
  try {
    const t = taipeiParts();
    const dayStart = now() - t.minutes * 60000;
    const users = db.prepare('SELECT * FROM users WHERE COALESCE(disabled,0)=0').all();
    for (const user of users) {
      const rels = db.prepare(`SELECT * FROM relationships WHERE user_id=? AND status='active' AND blocked=0`).all(user.id);
      const sent = { count: db.prepare(`SELECT COUNT(*) n FROM messages WHERE user_id=? AND sender='char' AND proactive=1 AND created_at>=?`).get(user.id, dayStart).n };
      for (const rel of rels) {
        try { await tickRel(rel, user, t, sent); } catch (e) { logIssue({ source: 'scheduler', message: `主動訊息失敗：${e.message}`, error: e, userId: user.id, relId: rel.id }); }
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduler() {
  setInterval(() => tick().catch(e => console.error(e)), config.schedulerMs);
}
