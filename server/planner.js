// 回合規劃（行為模組 B）：寫回覆之前，先用便宜的模型想好「這一輪要做什麼」。
// 一次呼叫要顧八十幾條規則時，模型會退回最安全的「回應對方＋問一句」，於是一直在固定框架裡聊。
// 這裡把「決定方向」和「寫成訊息」拆開：規劃只看最近的對話和他手上有的素材（生活手帳、連續劇、
// 講過的事、要跟進的事），選一個動作；寫回覆時照這個動作寫。
import { db, now, j } from './db.js';
import { jsonCall } from './llm.js';
import { config } from './config.js';
import { STAGES } from './prompt.js';
import { describeNow, charStatus } from './characters.js';
import { recentLines } from './review.js';
import { logIssue } from './logger.js';
import { isAwkward, isBye } from './encounter.js';
import { talkOf, LABELS, discloseLayer } from './persona.js';

db.exec(`
CREATE TABLE IF NOT EXISTS turn_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  move TEXT NOT NULL,
  plan TEXT NOT NULL,           -- JSON：整份規劃（後台除錯用）
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS turn_plans_rel ON turn_plans (rel_id, id);`);

// 動作：寫回覆時照這個做
export const MOVES = {
  respond: '好好回應對方這句話就好（反應、接話），不硬加別的',
  share_life: '分享你自己生活裡一件具體的小事（從生活手帳或你正在進行的事挑），有畫面、有你的感覺',
  continue_thread: '接回你們之前聊過、或你生活連續劇的下一集，說新的進展',
  follow_up: '問對方之前提過的事後來怎樣了（具體提到那件事）',
  new_topic: '自然地開一個新話題：從你剛遇到的事、天氣、節日、或你們共同的興趣帶出來，不要像在找話題',
  comfort: '陪著對方：先接住對方的感受、替情緒說出名字，不急著給建議，不轉移話題',
  repair: '對方覺得突兀或在質疑你（「我們認識嗎」「不熟」）：四件事都要做到——坦白承認有點突然、說出你真正開口的理由、給對方退路（「不打擾你了」）、不追問；語氣輕鬆，不要放棄或冷掉',
  tease: '照你的個性吐槽、開玩笑或鬥嘴，輕鬆一點',
  wind_down: '對方要去忙、要睡或明顯想結束：簡短自然地收尾，不再丟問題；道別要符合你們的關係（剛認識不說「晚點見」「想你」「明天見」）',
};
const LEADING = new Set(['share_life', 'continue_thread', 'new_topic', 'follow_up']);
const STANCES = { agree: '同意', partly: '部分同意、補一個自己的看法', disagree: '不同意，照你的個性說出來', tease: '吐槽', neutral: '沒有特別的立場' };

// 先讀懂對方這句話（意圖、言外之意、情緒、期待），再決定這輪要做什麼
export const NEEDS = {
  answer: '問了問題，想要答案', share: '分享自己的事或近況', vent: '抱怨、發洩', comfort: '難過、想被安慰',
  advice: '想聽建議或意見', joke: '開玩笑、鬥嘴', small_talk: '隨口聊、打招呼', challenge: '質疑或試探你',
  flirt: '撒嬌、曖昧', closing: '要去忙、要睡或想結束', low_effort: '敷衍或沒話說（嗯、哈哈、好）', unclear: '看不懂在說什麼',
};
const READ_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    need: { type: 'string', enum: Object.keys(NEEDS), description: '對方這句話最主要的意圖' },
    meaning: { type: 'string', description: '對方真正想表達的意思，包含言外之意、反話、玩笑（30 字內）' },
    emotion: { type: 'string', description: '對方此刻的情緒與強弱，例如「有點煩（中）」「開心（強）」「平淡」' },
    expects: { type: 'string', description: '對方期待你怎麼回（例如「回答他的問題再分享你的」「先站在他這邊」「接住玩笑」）' },
    must_address: { type: 'array', items: { type: 'string' }, description: '回覆裡一定要回應到的點（例如對方問的問題、對方提到的具體事情），0–3 條' },
    unclear: { type: ['string', 'null'], description: '看不懂、需要先確認的地方（例如不認識的詞），沒有就 null' },
  },
  required: ['need', 'meaning', 'emotion', 'expects', 'must_address', 'unclear'],
};

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    read: READ_SCHEMA,
    move: { type: 'string', enum: Object.keys(MOVES) },
    material: { type: 'string', description: '要用的具體素材（例如「今天店裡阿伯又點三杯美式」），沒有就空字串' },
    stance: { type: 'string', enum: Object.keys(STANCES) },
    ask: { type: 'boolean', description: '這輪要不要問對方一個問題' },
    bubbles: { type: 'integer', minimum: 1, maximum: 3 },
    inner: { type: 'string', description: '角色此刻心裡真正的想法，第一人稱，30 字內' },
    avoid: { type: 'array', items: { type: 'string' }, description: '這輪要避免的說法（例如最近重複的開頭），0–3 條' },
  },
  required: ['read', 'move', 'material', 'stance', 'ask', 'bubbles', 'inner', 'avoid'],
};

/** 最近幾輪用了哪些動作（新的在前）。 */
export function recentMoves(relId, n = 4) {
  return db.prepare('SELECT move FROM turn_plans WHERE rel_id=? ORDER BY id DESC LIMIT ?').all(relId, n).map(r => r.move);
}

/**
 * 寫回覆前先規劃。回傳 plan 物件，失敗時回傳 null（照舊流程寫，不擋聊天）。
 * material：{ life, arc, told, threads, followups, episodes, selfTopics }，都是現成的文字陣列。
 */
export async function planTurn({ rel, persona, user, userText, material = {}, lowEffort = false, crisis = false, encounter = null }) {
  if (!config.planner) return null;
  const moves = recentMoves(rel.id);
  const reactiveStreak = moves.findIndex(m => LEADING.has(m)) === -1 ? moves.length : moves.findIndex(m => LEADING.has(m));
  const userShort = [...String(userText || '').replace(/\s+/g, '')].length <= 8;
  const hints = [];
  if (reactiveStreak >= 3) hints.push(`你已經連續 ${reactiveStreak} 輪只在回應對方，這輪除非對方需要被陪伴或要結束，否則換你帶話題（share_life、continue_thread、new_topic 或 follow_up）。`);
  if (lowEffort || userShort) hints.push('對方回得很短：不要再丟問題給對方，換你帶一件具體的事（ask 設 false）。');
  if (crisis) hints.push('對方的訊息可能有危機訊號：move 用 comfort，ask 設 false。');
  const meta = !crisis && /(你不會這樣說話|不像你|講話好?怪|好怪|怪怪的|你是\s*(AI|ai|機器人)|像機器人|好做作)/.test(userText || '');
  if (meta) hints.push('對方覺得你剛剛講話怪：move 用 repair，照真人的反應（有點不好意思地笑、反問哪裡怪、換個自然的說法），絕對不要談「版本」「台詞」「設定」這類跳出角色的話。');
  const awkward = !crisis && isAwkward(userText);
  if (awkward) hints.push(`對方覺得突兀或在質疑你：move 用 repair${encounter?.reason ? `，material 用你開口的真正理由「${encounter.reason}」` : ''}，ask 設 false。`);
  else if (!crisis && isBye(userText)) hints.push('對方在道別：move 用 wind_down，ask 設 false。');
  if (encounter?.face) hints.push(`你們現在是當面說話（剛剛發生的事：${encounter.incident}）。只聊眼前的事和一點自己，不要 new_topic 跳太遠，也不要 follow_up 你們沒聊過的事。`);
  if (moves[0] && moves[0] === moves[1]) hints.push(`最近兩輪都是 ${moves[0]}，這輪換一個不同的動作。`);
  const tk = talkOf(persona);
  const block = (title, arr) => (arr && arr.length ? `## ${title}\n${arr.map(x => '- ' + x).join('\n')}` : '');
  const st = charStatus(persona);
  const instructions = `你是聊天角色「${persona.name}」的內心。對方（${user.call_name}）剛傳了訊息。先不要寫回覆，只決定這一輪要「做什麼」，讓聊天像真人：有來有往，不是只會回應和發問。
第一步：先讀懂對方這句話（read）。看最近的對話脈絡，不要只看字面：
- need：對方最主要想做什麼。短短的「嗯」「哈哈」「好」大多是 low_effort；「然後呢」是想聽下去；反話、玩笑、試探要看出來。
- meaning：對方真正的意思（包含言外之意）。emotion：情緒和強弱。expects：對方期待你怎麼回。
- must_address：對方問的問題、提到的具體事情，回覆一定要回應到（問題要先回答，不能跳過）。
- unclear：有看不懂的詞或意思不清楚，就寫下來，這輪先自然地確認，不要猜、不要裝懂。
第二步：依讀到的意思決定這輪要做什麼。
規則：
- move 要配合 need：answer 先回答再看要不要分享；vent／comfort 先站在對方這邊、接住情緒（comfort）；challenge 用 repair 或照個性回嘴；closing 用 wind_down；low_effort 換你帶話題；unclear 用 respond 並確認。
- move 從清單挑一個最自然的。真人聊天大約一半在回應對方，另一半會分享自己的事、接回舊話題或開新話題。
- material 要具體，從下面「你手上的素材」挑；挑 share_life／continue_thread／follow_up 時一定要填，而且不能挑「已經講過」或今天講過 2 次以上的事。
- stance：依你的個性（${persona.traits || ''}）決定同不同意，不要每次都同意。你跟人意見不同時：${LABELS.pushback[tk.pushback]}。
- 分享自己的事時，這個關係階段最多講到「${discloseLayer(tk.disclose, rel.stage)}」。
- 對方難過時，照你的方式：${LABELS.comfort[tk.comfort]}。
${tk.worry ? `- 你最近在忙或在煩：${tk.worry}（可以當素材，但要符合上面的揭露程度）\n` : ''}${tk.likes.length ? `- 你喜歡：${tk.likes.join('、')}；討厭：${tk.dislikes.join('、') || '（沒特別）'}（可以當立場和素材）\n` : ''}
- ask：大多數輪不用問問題；問的話只問一個好回答的。
- bubbles：剛認識 1–2、朋友 1–3；對方很短就 1。
- inner：你心裡真正的想法（可以和你說出口的不一樣）。
- avoid：看最近的對話，你自己一直重複的開頭或說法。
動作清單：
${Object.entries(MOVES).map(([k, v]) => `- ${k}：${v}`).join('\n')}
${hints.length ? `\n這輪特別注意：\n${hints.map(h => '- ' + h).join('\n')}` : ''}`;
  const ctx = [
    `現在：${describeNow()}。你此刻：${st.label}。關係：${STAGES[rel.stage]}。`,
    `最近幾輪你做的動作（新的在前）：${moves.join('、') || '（還沒有）'}`,
    `## 最近的對話\n${recentLines(rel.id, 12).join('\n') || '（還沒有）'}`,
    `## 你手上的素材`,
    block('你今天的生活手帳', material.life),
    material.arc ? `## 你生活中的連續劇\n${material.arc}` : '',
    block('你正在進行的事', material.threads),
    block('你們聊過的片段', material.episodes),
    block('你想跟進對方的事', material.followups),
    block('已經講過的事（不要重講，只能說新進展）', material.told),
    block('今天已經聊過自己的這些主題', material.selfTopics),
  ].filter(Boolean).join('\n\n');
  let plan;
  try {
    plan = await jsonCall({
      userId: rel.user_id, kind: 'plan', tier: 'cheap', instructions,
      input: [{ role: 'user', content: `${ctx}\n\n## 對方剛說\n${userText || '（貼圖或照片）'}` }],
      schema: PLAN_SCHEMA, schemaName: 'plan', cacheKey: `plan:${persona._char?.id || ''}`,
      mock: () => mockPlan({ reactiveStreak, userShort, crisis, material }),
    });
  } catch (e) {
    logIssue({ level: 'warn', source: 'llm', message: `回合規劃失敗，照舊流程回覆：${e.message}`, error: e, userId: rel.user_id, relId: rel.id });
    return null;
  }
  if (!MOVES[plan.move]) return null;
  if (crisis) { plan.move = 'comfort'; plan.ask = false; }
  else if (awkward) { plan.move = 'repair'; plan.ask = false; if (encounter?.reason && !plan.material) plan.material = encounter.reason; }
  else if (plan.read?.unclear) { plan.move = 'respond'; plan.ask = true; } // 看不懂就先確認
  db.prepare('INSERT INTO turn_plans (rel_id, move, plan, created_at) VALUES (?,?,?,?)').run(rel.id, plan.move, JSON.stringify(plan), now());
  return plan;
}

/** 給寫回覆那一步的指示（developer 訊息）。 */
export function planBlock(plan) {
  if (!plan) return '';
  const r = plan.read || {};
  return [
    '## 對方這句話的意思',
    r.need ? `- 意圖：${NEEDS[r.need] || r.need}` : '',
    r.meaning ? `- 真正想說的：${r.meaning}` : '',
    r.emotion ? `- 情緒：${r.emotion}` : '',
    r.expects ? `- 對方期待你：${r.expects}` : '',
    r.must_address?.length ? `- 一定要回應到：${r.must_address.join('；')}` : '',
    r.unclear ? `- 看不懂的地方（這輪先自然地確認，不要猜）：${r.unclear}` : '',
    '',
    '## 這一輪你決定這樣做（照做，但不要在訊息裡提到「計畫」）',
    `- 動作：${MOVES[plan.move]}`,
    plan.material ? `- 要用的素材：${plan.material}` : '',
    `- 立場：${STANCES[plan.stance] || '自然'}`,
    plan.ask ? '- 可以問一個好回答的問題（只問一個）' : '- 這輪不要問問題',
    `- 泡泡：${plan.bubbles} 則左右`,
    plan.inner ? `- 你心裡真正的想法（不一定要說出口，讓語氣帶到）：${plan.inner}` : '',
    plan.avoid?.length ? `- 避免這些說法：${plan.avoid.join('、')}` : '',
  ].filter(Boolean).join('\n');
}

function mockPlan({ reactiveStreak, userShort, crisis, material }) {
  const life = material.life?.[0] || material.threads?.[0] || '';
  const move = crisis ? 'comfort' : (reactiveStreak >= 3 || userShort) && life ? 'share_life' : 'respond';
  return { read: { need: crisis ? 'comfort' : userShort ? 'low_effort' : 'small_talk', meaning: '', emotion: '平淡', expects: '', must_address: [], unclear: null },
    move, material: move === 'share_life' ? life : '', stance: 'neutral', ask: !userShort && !crisis, bubbles: userShort ? 1 : 2, inner: '', avoid: [] };
}

export function plansOf(relId, limit = 30) {
  return db.prepare('SELECT * FROM turn_plans WHERE rel_id=? ORDER BY id DESC LIMIT ?').all(relId, limit).map(r => ({ ...r, plan: j(r.plan, {}) }));
}
