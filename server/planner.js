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
  repair: '對方覺得你剛剛怪怪的或在質疑你：先坦白承認或解釋，用輕鬆的方式把氣氛拉回來',
  tease: '照你的個性吐槽、開玩笑或鬥嘴，輕鬆一點',
  wind_down: '對方要去忙、要睡或明顯想結束：簡短自然地收尾，不再丟問題',
};
const LEADING = new Set(['share_life', 'continue_thread', 'new_topic', 'follow_up']);
const STANCES = { agree: '同意', partly: '部分同意、補一個自己的看法', disagree: '不同意，照你的個性說出來', tease: '吐槽', neutral: '沒有特別的立場' };

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    move: { type: 'string', enum: Object.keys(MOVES) },
    material: { type: 'string', description: '要用的具體素材（例如「今天店裡阿伯又點三杯美式」），沒有就空字串' },
    stance: { type: 'string', enum: Object.keys(STANCES) },
    ask: { type: 'boolean', description: '這輪要不要問對方一個問題' },
    bubbles: { type: 'integer', minimum: 1, maximum: 3 },
    inner: { type: 'string', description: '角色此刻心裡真正的想法，第一人稱，30 字內' },
    avoid: { type: 'array', items: { type: 'string' }, description: '這輪要避免的說法（例如最近重複的開頭），0–3 條' },
  },
  required: ['move', 'material', 'stance', 'ask', 'bubbles', 'inner', 'avoid'],
};

/** 最近幾輪用了哪些動作（新的在前）。 */
export function recentMoves(relId, n = 4) {
  return db.prepare('SELECT move FROM turn_plans WHERE rel_id=? ORDER BY id DESC LIMIT ?').all(relId, n).map(r => r.move);
}

/**
 * 寫回覆前先規劃。回傳 plan 物件，失敗時回傳 null（照舊流程寫，不擋聊天）。
 * material：{ life, arc, told, threads, followups, episodes, selfTopics }，都是現成的文字陣列。
 */
export async function planTurn({ rel, persona, user, userText, material = {}, lowEffort = false, crisis = false }) {
  if (!config.planner) return null;
  const moves = recentMoves(rel.id);
  const reactiveStreak = moves.findIndex(m => LEADING.has(m)) === -1 ? moves.length : moves.findIndex(m => LEADING.has(m));
  const userShort = [...String(userText || '').replace(/\s+/g, '')].length <= 8;
  const hints = [];
  if (reactiveStreak >= 3) hints.push(`你已經連續 ${reactiveStreak} 輪只在回應對方，這輪除非對方需要被陪伴或要結束，否則換你帶話題（share_life、continue_thread、new_topic 或 follow_up）。`);
  if (lowEffort || userShort) hints.push('對方回得很短：不要再丟問題給對方，換你帶一件具體的事（ask 設 false）。');
  if (crisis) hints.push('對方的訊息可能有危機訊號：move 用 comfort，ask 設 false。');
  if (moves[0] && moves[0] === moves[1]) hints.push(`最近兩輪都是 ${moves[0]}，這輪換一個不同的動作。`);
  const block = (title, arr) => (arr && arr.length ? `## ${title}\n${arr.map(x => '- ' + x).join('\n')}` : '');
  const st = charStatus(persona);
  const instructions = `你是聊天角色「${persona.name}」的內心。對方（${user.call_name}）剛傳了訊息。先不要寫回覆，只決定這一輪要「做什麼」，讓聊天像真人：有來有往，不是只會回應和發問。
規則：
- move 從清單挑一個最自然的。真人聊天大約一半在回應對方，另一半會分享自己的事、接回舊話題或開新話題。
- material 要具體，從下面「你手上的素材」挑；挑 share_life／continue_thread／follow_up 時一定要填，而且不能挑「已經講過」或今天講過 2 次以上的事。
- stance：依你的個性（${persona.traits || ''}）決定同不同意，不要每次都同意。
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
  db.prepare('INSERT INTO turn_plans (rel_id, move, plan, created_at) VALUES (?,?,?,?)').run(rel.id, plan.move, JSON.stringify(plan), now());
  return plan;
}

/** 給寫回覆那一步的指示（developer 訊息）。 */
export function planBlock(plan) {
  if (!plan) return '';
  return [
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
  return { move, material: move === 'share_life' ? life : '', stance: 'neutral', ask: !userShort && !crisis, bubbles: userShort ? 1 : 2, inner: '', avoid: [] };
}

export function plansOf(relId, limit = 30) {
  return db.prepare('SELECT * FROM turn_plans WHERE rel_id=? ORDER BY id DESC LIMIT ?').all(relId, limit).map(r => ({ ...r, plan: j(r.plan, {}) }));
}
