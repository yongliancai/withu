// 發送前檢查：主動訊息、晚回的訊息在送出前，先對照「現在的時間」和「最近的聊天紀錄」，
// 避免下午說早安、對方剛說在忙還硬開話題、跟前面的對話接不上這類「亂傳」。
import { db, now } from './db.js';
import { jsonCall } from './llm.js';
import { taipeiParts, describeNow, charStatus } from './characters.js';
import { logIssue } from './logger.js';

export function dayPeriod(h) {
  if (h < 5) return '深夜';
  if (h < 9) return '早上';
  if (h < 11) return '上午';
  if (h < 14) return '中午';
  if (h < 17) return '下午';
  if (h < 19) return '傍晚';
  if (h < 23) return '晚上';
  return '深夜';
}

export function gapLabel(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小時`;
  return `${Math.round(h / 24)} 天`;
}

// 規則檢查：明顯跟時間對不上的說法
export function timeProblems(texts, persona, ts = Date.now()) {
  const t = taipeiParts(ts), h = t.hour + t.minute / 60;
  const all = texts.join(' ');
  const st = charStatus(persona, ts).code;
  const p = [];
  if (/早安|早啊|早上好|早～|早~|早呀/.test(all) && !(h >= 5 && h < 11)) p.push(`現在是${dayPeriod(t.hour)}，不適合說早安`);
  if (/晚安|我先睡|要睡了|去睡囉/.test(all) && h >= 6 && h < 21) p.push(`現在是${dayPeriod(t.hour)}，還不是說晚安的時間`);
  if (/(午餐|午飯|中餐)/.test(all) && /(吃了嗎|要吃什麼|吃什麼|吃了沒)/.test(all) && !(h >= 10.5 && h < 14.5)) p.push('現在不是午餐時間');
  if (/(晚餐|晚飯)/.test(all) && /(吃了嗎|要吃什麼|吃什麼|吃了沒)/.test(all) && !(h >= 16.5 && h < 21.5)) p.push('現在不是晚餐時間');
  if (/(剛下班|終於下班|下班了)/.test(all) && !['commute_out', 'free', 'late'].includes(st)) p.push('依你的作息，你現在還沒下班');
  if (/(去上班|出門上班|準備上班)/.test(all) && !['commute_in', 'sleeping'].includes(st) && !(st === 'free' && h < 11)) p.push('依你的作息，現在不是去上班的時間');
  return p;
}

function recentLines(relId, n = 14) {
  return db.prepare(`SELECT sender, kind, text, created_at FROM messages WHERE rel_id=? AND sender IN ('user','char') AND text IS NOT NULL ORDER BY id DESC LIMIT ?`).all(relId, n).reverse()
    .map(m => `[${describeNow(m.created_at).slice(5)}] ${m.sender === 'user' ? '對方' : '你'}：${m.kind === 'sticker' ? `（貼圖：${m.text}）` : m.text}`);
}

/**
 * Deterministic gate for proactive messages: should he reach out at all right now?
 * Returns a reason string when he should stay quiet.
 */
export function shouldHoldProactive(rel, persona, key, ts = Date.now()) {
  if (key === 'followup' || key === 'focus_end') {
    if (charStatus(persona, ts).code === 'sleeping') return '他在睡覺，醒來再跟進';
    return null;
  }
  if (charStatus(persona, ts).code === 'sleeping') return '他在睡覺';
  if (rel.last_user_msg_at && ts - rel.last_user_msg_at < 20 * 60000) return '你們正在聊天，不插入新話題';
  const last = db.prepare(`SELECT sender, text, created_at FROM messages WHERE rel_id=? AND sender IN ('user','char') ORDER BY id DESC LIMIT 1`).get(rel.id);
  if (last && last.sender === 'char' && /[?？]\s*$/.test(last.text || '') && ts - last.created_at < 4 * 3600e3) return '他上一個問題對方還沒回';
  return null;
}

/**
 * Review a drafted proactive / late message against the clock and the recent chat.
 * Returns { action: 'send' | 'rewrite' | 'skip', messages, reason }.
 */
export async function reviewOutgoing({ rel, persona, user, texts, triggerKey, lateReply, ts = Date.now() }) {
  const t = taipeiParts(ts);
  const rule = timeProblems(texts, persona, ts);
  const res = await jsonCall({
    userId: rel.user_id, kind: 'review', tier: 'cheap',
    instructions: `你是聊天 App 的發送前檢查。角色「${persona.name}」準備傳一段訊息給${user.call_name}。請對照現在的時間和最近的聊天紀錄，判斷這段訊息送出去會不會很奇怪。
現在：${describeNow(ts)}（${dayPeriod(t.hour)}）。${persona.name}此刻：${charStatus(persona, ts).label}。
${lateReply ? `這是晚回的訊息：他${lateReply.why}，隔了 ${lateReply.minutes} 分鐘才回，必須回應對方在這段時間傳的內容。` : `這是他主動傳的訊息（原因：${triggerKey || '主動關心'}）。`}
${rule.length ? `規則檢查已發現：${rule.join('；')}。` : ''}
判斷標準：
- 問候、吃飯、上下班、睡覺的說法要符合現在的時間與他的作息。
- 要接得上最近的對話：不能忽略對方最後說的話、不能重問對方剛回答過的事、不能跟前面說過的事矛盾。
- 對方剛說在忙、要睡了、心情不好時，不要硬開輕鬆的新話題（關心可以）。
- 不要和他最近說過的話重複。
action：send（沒問題）、rewrite（改寫後再送，messages 給改好的 1–3 則泡泡，保持他的口吻和原本的用意）${lateReply ? '' : '、skip（現在不適合傳，整段取消）'}。reason 一句話。只輸出 JSON。`,
    input: [{ role: 'user', content: `最近的聊天紀錄：\n${recentLines(rel.id).join('\n') || '（還沒有）'}\n\n準備送出的訊息：\n${texts.map(x => '- ' + x).join('\n')}` }],
    schema: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: lateReply ? ['send', 'rewrite'] : ['send', 'rewrite', 'skip'] },
      reason: { type: 'string' }, messages: { type: 'array', items: { type: 'string' } },
    }, required: ['action', 'reason', 'messages'] },
    schemaName: 'review',
    mock: () => rule.length
      ? { action: 'rewrite', reason: rule.join('；'), messages: texts.map(x => x.replace(/早安|早啊|早上好/g, '嗨').replace(/晚安/g, '晚點聊')) }
      : { action: 'send', reason: 'ok', messages: [] },
  }).catch(e => ({ action: rule.length && !lateReply ? 'skip' : 'send', reason: `檢查失敗：${e.message}`, messages: [] }));
  if (res.action === 'rewrite' && !res.messages?.length) res.action = rule.length && !lateReply ? 'skip' : 'send';
  if (res.action !== 'send') logIssue({ level: 'warn', source: 'review', message: `發送前檢查：${res.action === 'skip' ? '取消' : '改寫'}（${res.reason}）`, detail: { draft: texts, rewritten: res.messages, trigger: triggerKey, rule }, userId: rel.user_id, relId: rel.id });
  return res;
}
