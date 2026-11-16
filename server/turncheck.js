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
import { talkOf } from './persona.js';
import { db } from './db.js';

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
export function ruleProblems(texts, { persona, rel, plan = null, face = false, ts = Date.now() }) {
  const all = texts.join('\n');
  const p = [...timeProblems(texts, persona, ts)];
  const svc = SERVICE.find(r => r.test(all));
  if (svc) p.push(`有客服或助理的口吻（「${all.match(svc)[0]}」），改成朋友傳訊息的說法`);
  if (rel.stage <= 2) { const f = FAWN.find(r => r.test(all)); if (f) p.push(`說了討好的話（「${all.match(f)[0]}」），你們還沒那麼熟，拿掉`); }
  const qs = (all.match(/[?？]/g) || []).length;
  if (qs >= 2) p.push(`一次問了 ${qs} 個問題，最多留一個`);
  if (plan && !plan.ask && qs >= 1 && plan.move !== 'repair') p.push('這輪決定不問問題，但訊息裡有問句');
  if (/^\s*(\d+[.、)]|[-•・])\s/m.test(all)) p.push('用了條列，真人傳訊息不會這樣');
  const meta = all.match(/台詞|劇本|人設|角色扮演|那種版本|平常那種版本|太做作了|我是\s*AI|語言模型|系統設定/);
  if (meta) p.push(`跳出角色談自己的說話方式（「${meta[0]}」），改成真人會有的反應`);
  // 剛認識：不裝熟、不編共同回憶、不問私人狀態
  if (rel.stage === 0) {
    const close = all.match(/晚點見|明天見|想你|寶貝|親愛的|抱抱/);
    if (close) p.push(`你們剛認識，「${close[0]}」太親近了`);
    if (/你那邊.{0,8}(還好|好嗎|沒事吧)/.test(all)) p.push('對剛認識的人問「你那邊還好嗎」太親近，也可能是在講對方沒經歷過的事');
    if (rel.start_type !== 'friend' && ts - rel.created_at < 864e5 && /(上次|之前我們|我們之前|記得我們|那天我們)/.test(all)) p.push('你們今天才認識，不能提「之前」一起發生的事');
  }
  if (face && /(LINE|傳訊息|私訊|訊息給你)/i.test(all) && !/交換|加/.test(all)) p.push('你們現在是當面說話，還沒有對方的聯絡方式，不能說傳訊息');
  if (texts.some(t => [...t].length > 70)) p.push('有一則泡泡太長，拆短或刪掉一些');
  // 口頭禪不能每則都用：最近 4 則已經用過 2 次以上，這次又用
  const cps = (persona.catchphrases || []).filter(c => c && c.length >= 2);
  if (cps.length && rel.id) {
    const recent = db.prepare(`SELECT text FROM messages WHERE rel_id=? AND sender='char' AND kind='text' ORDER BY id DESC LIMIT 4`).all(rel.id).map(r => r.text || '').join('\n');
    const cp = cps.find(c => all.includes(c) && recent.split(c).length - 1 >= 2);
    if (cp) p.push(`口頭禪「${cp}」最近用太多次了，這次不要用`);
  }
  const emo = (all.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (talkOf(persona).emoji === 'none' && emo > 0) p.push('你幾乎不用表情符號，拿掉');
  return p;
}

// 對方剛說的整句話被原封不動搬進回覆（鸚鵡式附和）
function echoProblem(texts, userText) {
  const mine = texts.join('\n').replace(/\s+/g, '');
  for (const part of String(userText || '').split(/[\n，。！？!?、,.~～]+/)) {
    const p = part.replace(/\s+/g, '');
    if ([...p].length >= 5 && mine.includes(p)) return `把對方的話「${p}」原封不動重說了一遍，換成你自己的反應`;
  }
  return null;
}

const TYPES = {
  location_conflict: '說的地點、正在做的事跟「你此刻的狀態」不一致，或沒交代就換了地方',
  contradicts_scene: '跟旁白或之前真的發生的事矛盾（例如把誰撿的、誰掉的講反）',
  contradicts_history: '跟自己前面說過的話矛盾',
  breaks_character: '跳出角色談自己怎麼說話、時間線、設定（「時間有點跳」「剛剛那句講太快」「剛剛太刻意」「那句太硬」「像在背稿」）。老實承認自己是 AI 角色不算',
  dodges_ai: '對方認真問是不是 AI，卻否認或閃避（要老實說自己是 AI 角色，再用自己的方式接下去）',
  repeats_self: '跟自己前一兩輪說的內容幾乎一樣，對話沒有往前',
  not_answering: '沒回應到對方剛說的話或問的問題、答非所問',
  empty_reply: '只有「嗯」「對」這種沒內容的附和，對話接不下去',
  too_much: '比對方長太多、太熱情、一次解釋太多或連續道歉',
  service_tone: '像客服或助理',
  off_plan: '沒照這輪的規劃做',
};

/**
 * 模型層：只判定有沒有問題，不改寫（改寫交回寫手）。回傳問題說明的陣列。
 */
export async function checkReply({ rel, persona, user, userText, texts, plan, sceneText = '', ts = Date.now() }) {
  const t = taipeiParts(ts);
  const res = await jsonCall({
    userId: rel.user_id, kind: 'check', tier: 'cheap', effort: 'low',
    instructions: `你是聊天 App 的送出前檢查。角色「${persona.name}」準備回覆${user.call_name}。你只負責找問題，不用改寫。
現在：${describeNow(ts)}（${dayPeriod(t.hour)}）。
${sceneText}
${plan?.read?.meaning ? `對方這句話的意思：${plan.read.meaning}。` : ''}${plan?.read?.must_address?.length ? `一定要回應到：${plan.read.must_address.join('；')}。` : ''}
${plan ? `這輪的規劃：${MOVES[plan.move]}${plan.material ? `（素材：${plan.material}）` : ''}${plan.ask ? '' : '，不問問題'}。` : ''}
逐項對照，確定有問題才列出來（type＋一句具體說明，指出是哪一句、哪裡不對）；拿不準就不要列。沒問題回空陣列。
${Object.entries(TYPES).map(([k, v]) => `- ${k}：${v}`).join('\n')}`,
    input: [{ role: 'user', content: `最近的對話：\n${recentLines(rel.id, 12).join('\n') || '（還沒有）'}\n\n對方剛說：${userText || '（貼圖或照片）'}\n\n準備送出的回覆：\n${texts.map(x => '- ' + x).join('\n')}` }],
    schema: { type: 'object', additionalProperties: false, properties: {
      problems: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        type: { type: 'string', enum: Object.keys(TYPES) }, detail: { type: 'string' } }, required: ['type', 'detail'] } },
    }, required: ['problems'] },
    schemaName: 'check',
    mock: () => ({ problems: [] }),
  });
  return (res.problems || []).slice(0, 4).map(p => String(p.detail || TYPES[p.type]).slice(0, 120));
}

/**
 * 一般回覆的送出前檢查：規則層每次都跑，模型層對照場景狀態、對話和規劃。
 * 回傳 { texts: 清掉括號旁白後的泡泡, problems: 要請寫手修正的問題 }；不在這裡改寫。
 */
// 對方只回「嗯」「哈哈」時，角色又把前一兩輪講過的事再講一次（對話卡在原地）
function stallProblem(texts, recentChar) {
  const han = (x) => String(x).replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '');
  const prev = recentChar.map(han).filter(Boolean);
  for (const t of texts) {
    const c = han(t);
    for (let i = 0; i + 4 <= c.length; i++) {
      const w = c.slice(i, i + 4);
      if (new Set(w).size >= 3 && prev.some(p => p.includes(w))) return `「${w}」這件事你前面已經講過了，對話卡在原地：這次不要再提它，換一個新的（問對方一個跟眼前有關的小問題，或說一句關於你自己的事）`;
    }
  }
  return null;
}

export async function reviewReply({ rel, persona, user, userText, texts, plan, face = false, rulesOnly = false, sceneText = '', scene = null, out = null, userLow = false, recentChar = [] }) {
  const cleaned = stripNarration(texts);
  if (!cleaned.length) return { texts, problems: [] };
  const problems = ruleProblems(cleaned, { persona, rel, plan, face });
  if (!cleaned.some(x => x.replace(/[＊*][^＊*\n]{1,40}[＊*]/g, '').trim())) problems.push('這一輪只有動作、沒有說出口的話：至少要說一句');
  const echo = echoProblem(cleaned, userText);
  if (echo) problems.push(echo);
  if (userLow) { const st = stallProblem(cleaned, recentChar); if (st) problems.push(st); }
  if (face && out?.scene?.moved) problems.push('你們正在當面說話，不能說自己已經到了別的地方');
  if (rulesOnly || !config.checkModel) return { texts: cleaned, problems };
  try {
    const more = await checkReply({ rel, persona, user, userText, texts: cleaned, plan, sceneText });
    return { texts: cleaned, problems: [...problems, ...more] };
  } catch (e) {
    logIssue({ level: 'warn', source: 'review', message: `送出前檢查失敗，只用規則層：${e.message}`, error: e, userId: rel.user_id, relId: rel.id });
    return { texts: cleaned, problems };
  }
}
