// 送出前檢查（行為模組 D）：每一則一般回覆送出前都過一次。
// 規則層（不花錢、不增加延遲）：時間用詞、客服腔、討好話、一次問太多、條列、括號旁白。
// 模型層（便宜模型）：對照最近的對話和這輪的規劃，看接不接得上、像不像真人。
// 有問題最多重寫一次；檢查失敗就照原本的送，不擋聊天。
import { jsonCall } from './llm.js';
import { config } from './config.js';
import { timeProblems, recentLines, dayPeriod } from './review.js';
import { describeNow, charStatus, taipeiParts } from './characters.js';
import { MOVES } from './planner.js';
import { logIssue } from './logger.js';

// 客服、助理腔：真人朋友傳 LINE 不會這樣講
const SERVICE = [/您/, /請問/, /有什麼(我)?可以(幫|為)/, /希望(這|以上)?(對你)?有(幫助|幫到)/, /隨時(都)?(可以)?(告訴|跟)我/, /如果你(還)?需要(任何|什麼)/, /很高興(能)?(為你|幫你|跟你分享)/, /祝你(有個)?(愉快|美好)/];
// 討好、過度肯定：剛認識或朋友階段說這些很假
const FAWN = [/你真的(很|好)棒/, /謝謝你(願意)?(跟我)?分享/, /我(完全)?懂你/, /我一直都在/, /有我在/, /你值得被(好好)?對待/, /你已經做得很好了/];

/** 拿掉模型偶爾寫進訊息裡的括號旁白或系統文字。回傳清理後的泡泡（空的會被拿掉）。 */
export function stripNarration(texts) {
  return texts
    .map(t => String(t)
      .replace(/[（(]\s*(系統|旁白|動作|場景|提示|備註|內心|心想|OS)[^）)]*[）)]/g, '')
      .replace(/^[（(][^）)]{4,}[）)]$/, '')
      .trim())
    .filter(Boolean);
}

/** 規則層：回傳問題清單（空陣列 = 沒問題）。 */
export function ruleProblems(texts, { persona, rel, plan = null, ts = Date.now() }) {
  const all = texts.join('\n');
  const p = [...timeProblems(texts, persona, ts)];
  const svc = SERVICE.find(r => r.test(all));
  if (svc) p.push(`有客服或助理的口吻（「${all.match(svc)[0]}」），改成朋友傳訊息的說法`);
  if (rel.stage <= 2) { const f = FAWN.find(r => r.test(all)); if (f) p.push(`說了討好的話（「${all.match(f)[0]}」），你們還沒那麼熟，拿掉`); }
  const qs = (all.match(/[?？]/g) || []).length;
  if (qs >= 2) p.push(`一次問了 ${qs} 個問題，最多留一個`);
  if (plan && !plan.ask && qs >= 1 && plan.move !== 'repair') p.push('這輪決定不問問題，但訊息裡有問句');
  if (/^\s*(\d+[.、)]|[-•・])\s/m.test(all)) p.push('用了條列，真人傳訊息不會這樣');
  if (texts.some(t => [...t].length > 70)) p.push('有一則泡泡太長，拆短或刪掉一些');
  return p;
}

/**
 * 模型層：看這段回覆接不接得上、像不像真人、有沒有照規劃做。
 * 回傳 { action: 'send' | 'rewrite', messages, reason }。
 */
export async function checkReply({ rel, persona, user, userText, texts, plan, problems = [], ts = Date.now() }) {
  const t = taipeiParts(ts);
  const res = await jsonCall({
    userId: rel.user_id, kind: 'check', tier: 'cheap',
    instructions: `你是聊天 App 的送出前檢查。角色「${persona.name}」（${persona.traits || ''}）準備回覆${user.call_name}。判斷這段回覆像不像真人朋友在傳 LINE、接不接得上對話。
現在：${describeNow(ts)}（${dayPeriod(t.hour)}）。${persona.name}此刻：${charStatus(persona, ts).label}。
${plan ? `這輪的規劃：${MOVES[plan.move]}${plan.material ? `（素材：${plan.material}）` : ''}${plan.ask ? '' : '，不問問題'}。` : ''}
${problems.length ? `規則檢查已發現：${problems.join('；')}。這些一定要改。` : ''}
判斷標準：
- 要回應到對方剛說的話，不能答非所問、不能重問對方剛回答過的事、不能跟前面說過的事矛盾。
- 不像客服或助理；不過度熱情、不每句都附和或誇對方；長度跟對方差不多。
- 有照規劃做（例如規劃要分享自己的事，就要真的分享，而不是只問對方）。
- 不要和他最近說過的話重複開頭或說法。
沒問題就 send、messages 給空陣列。有問題就 rewrite：messages 給改好的 1–3 則泡泡，保持他的口吻、原本的用意和規劃。reason 一句話。`,
    input: [{ role: 'user', content: `最近的對話：\n${recentLines(rel.id, 12).join('\n') || '（還沒有）'}\n\n對方剛說：${userText || '（貼圖或照片）'}\n\n準備送出的回覆：\n${texts.map(x => '- ' + x).join('\n')}` }],
    schema: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['send', 'rewrite'] },
      reason: { type: 'string' }, messages: { type: 'array', items: { type: 'string' } },
    }, required: ['action', 'reason', 'messages'] },
    schemaName: 'check',
    mock: () => problems.length
      ? { action: 'rewrite', reason: problems.join('；'), messages: texts.map(x => x.replace(/您/g, '你').replace(/請問/g, '')).slice(0, 3) }
      : { action: 'send', reason: 'ok', messages: [] },
  });
  if (res.action === 'rewrite' && !res.messages?.length) res.action = 'send';
  return res;
}

/**
 * 一般回覆的送出前檢查：規則層每次都跑；有問題、或開啟模型層時再問模型。最多改寫一次。
 * 回傳要送出的泡泡。
 */
export async function reviewReply({ rel, persona, user, userText, texts, plan }) {
  const cleaned = stripNarration(texts);
  if (!cleaned.length) return texts;
  const problems = ruleProblems(cleaned, { persona, rel, plan });
  if (!problems.length && !config.checkModel) return cleaned;
  try {
    const rv = await checkReply({ rel, persona, user, userText, texts: cleaned, plan, problems });
    if (rv.action !== 'rewrite') return cleaned;
    const out = stripNarration(rv.messages).slice(0, 3);
    if (!out.length) return cleaned;
    logIssue({ level: 'auto', source: 'review', message: `送出前檢查：改寫一般回覆（${rv.reason}）`, detail: { draft: cleaned, rewritten: out, problems, move: plan?.move }, userId: rel.user_id, relId: rel.id });
    return out;
  } catch (e) {
    logIssue({ level: 'warn', source: 'review', message: `送出前檢查失敗，照原本的送：${e.message}`, error: e, userId: rel.user_id, relId: rel.id });
    return cleaned;
  }
}
