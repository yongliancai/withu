// 相遇卡與開場（行為模組 I）
// 以前旁白和角色的第一句是分開產生的，於是角色會說「差點撞到你」「你那邊雨大嗎」這種旁白裡沒發生的事，
// 也會當面看一眼就直接傳私訊。現在先產生一張「相遇卡」，旁白、搭話理由、開場白、怎麼交換聯絡方式
// 全部從同一張卡來：
//   1. 卡片：incident（真的發生的小事）、reason_type（只能從六種搭話理由挑）、旁白、3 組開場白候選
//   2. 開場白挑跟這位使用者最近遇過的角色開場最不像的一組
//   3. 當面相遇 2–4 輪（phase = in_person，畫面用對白框顯示）→ 自然收尾、交換聯絡方式 → 進入聊天
//      依心情認識的人可以選擇不交換（phase = parted），之後再偶遇
import { db, now, j } from './db.js';
import { jsonCall } from './llm.js';
import { personaBlock } from './prompt.js';
import { similarity } from './memory.js';
import { describeNow } from './characters.js';

export const REASONS = {
  job: '職業需要（店員服務、護理師問訪客、消防員確認警報）',
  slip: '小失誤（送錯餐、拿錯傘、坐錯位子）',
  help: '順手幫忙（撿東西、幫忙按微波爐）',
  third_party: '第三方牽線（寵物、共同朋友、店員介紹）',
  shared: '共同處境（躲雨、排隊、停電、捷運延誤）',
  object: '物品（掉了東西、同款包包、同一本書）',
};

// 使用者想怎麼開始
export const OPENINGS = {
  him: { label: '他主動搭話', guide: '角色先開口，可以稍微主動。' },
  me: { label: '我先開口', guide: '使用者會先開口。角色不說開場白，旁白停在兩人對上眼、使用者正要開口的那一刻。' },
  slow: { label: '慢慢來', guide: '角色很低調：只說一句很短、不帶問題的話，讓使用者決定要不要接。' },
  drama: { label: '戲劇性一點', guide: 'incident 可以比較有戲（例如東西灑了、一起被困在電梯、搶到同一個東西），但仍是台灣日常會發生的事，不要危險、不要浪漫套路。' },
};

// 入口決定開場溫度
const ENTRY = {
  person: '使用者先選了這個人才來，對角色有明確好感：開場可以稍主動。搭話理由優先從角色職業和情境找。',
  scene: '使用者想要一場巧遇：開場中性、有巧合感。搭話理由從場景本身找。',
  mood: '使用者此刻心情不好：開場低壓、給退路，使用者不接話也完全自然。搭話理由用很小的善意或第三方（寵物、店員工作）。不能點破對方的心情、不曖昧、不講自己的煩惱。',
};

const CARD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    incident: { type: 'string', description: '這次相遇真的發生的一件小事（一句話），旁白一定要寫到' },
    reason_type: { type: 'string', enum: Object.keys(REASONS) },
    reason_to_talk: { type: 'string', description: '角色開口的真正理由（被問「我們認識嗎」時可以老實說出來）' },
    narration: { type: 'string', description: '2–3 句第二人稱旁白，寫出地點、時間感和 incident' },
    openers: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } }, description: '3 組不同的開場白，每組 1–2 句當面說的話' },
    contact_exchange: { type: 'string', description: '之後兩人怎麼自然地交換 LINE（一句話，例如「他說之後咖啡豆到貨可以通知你，問要不要加 LINE」）' },
    suggestions: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' }, text: { type: 'string' } }, required: ['label', 'text'] } },
  },
  required: ['incident', 'reason_type', 'reason_to_talk', 'narration', 'openers', 'contact_exchange', 'suggestions'],
};

/** 這位使用者最近遇過的角色開場（拿來避免同一個範本）。 */
function recentOpeners(userId, limit = 6) {
  return db.prepare(`SELECT m.text FROM messages m JOIN relationships r ON r.id=m.rel_id
    WHERE r.user_id=? AND m.sender='char' AND m.kind='text' AND m.id IN (SELECT MIN(id) FROM messages WHERE sender='char' GROUP BY rel_id)
    ORDER BY m.id DESC LIMIT ?`).all(userId, limit).map(r => r.text).filter(Boolean);
}

/** 挑跟最近的開場最不像的一組。 */
export function pickOpener(candidates, recent) {
  let best = candidates[0], bestScore = Infinity;
  for (const c of candidates) {
    const s = Math.max(0, ...recent.map(r => similarity(c.join(''), r)));
    if (s < bestScore) { best = c; bestScore = s; }
  }
  return best;
}

export async function makeEncounterCard({ userId, frame, label, roles, scene, entry, opening, startFriend }) {
  const recent = recentOpeners(userId);
  const op = OPENINGS[opening] || OPENINGS.him;
  const res = await jsonCall({
    userId, kind: 'scene', tier: 'good',
    instructions: `${personaBlock(frame)}

你要為這次相遇做一張「相遇卡」。旁白和角色當面說的話都從這張卡產生，所以不能互相矛盾。
規則：
- incident：這次真的發生的一件小事。旁白一定要寫到；開場白只能提旁白裡發生的事（旁白沒寫撞到就不能說「差點撞到你」，旁白沒下雨就不能問「雨大嗎」）。
- reason_type 只能從下面挑一種，reason_to_talk 要是真人會開口的理由：
${Object.entries(REASONS).map(([k, v]) => `  - ${k}：${v}`).join('\n')}
- ${startFriend ? '你們本來就認識、有彼此的 LINE：旁白寫你們在這裡碰到的那一刻，開場白是你事後傳的訊息，接著旁白的事講。' : '這是「當面」相遇，還沒有對方的聯絡方式。開場白是當面說的話，不是傳訊息。'}
- 開場照 ARE：先講你們眼前共同看到的事，再透露一點自己，最多一個好回答、跟場景有關的問題。不讚美外表、不講套路、不硬搞笑。
- ${startFriend ? '你們本來就認識，語氣自然但還只是朋友，只能引用設定裡的過去。' : '你們是陌生人：不裝熟、不編共同回憶、不問私人狀態（「你那邊還好嗎」對陌生人太親近）、不叫小名。'}
- 3 組開場白要明顯不同（開頭的字、句型、有沒有問句都不同），也不要像下面這些「這位使用者最近遇過的開場」：
${recent.length ? recent.map(r => `  - ${r}`).join('\n') : '  （還沒有）'}
- 旁白的時間要符合現在的真實時間；情境名稱裡的時間和現在不合時，以現在為準。
- suggestions：給使用者 3 個回話方向（label 6 字內、開頭一個表情符號；text 是使用者當面會說的一句話，20 字內）。
入口：${ENTRY[entry] || ENTRY.person}
使用者想要的開始方式：${op.label}——${op.guide}`,
    input: [{ role: 'user', content: `現在的真實時間：${describeNow()}\n情境：${label}\n${roles ? '身份：' + roles + '\n' : ''}地點：${scene.place || label}${scene.mood ? `\n使用者此刻的心情：${scene.mood}` : ''}` }],
    schema: CARD_SCHEMA, schemaName: 'encounter_card',
    mock: () => ({
      incident: '你伸手去拿最後一個位子旁邊的插座，剛好對方也伸了手',
      reason_type: 'shared', reason_to_talk: '兩個人都要用同一個插座',
      narration: `${label}。你伸手去拿桌邊的插座，旁邊的人也剛好伸了手，兩個人都停在半空中。`,
      openers: [['啊，你先用吧', '我手機還有一點電'], ['這間店插座真的太少了', '你先'], ['欸 同時'], ],
      contact_exchange: `${frame.name}說之後找到不缺插座的店可以分享，問要不要加 LINE`,
      suggestions: [{ label: '😊 謝謝他', text: '謝謝，那我用一下就好' }, { label: '😂 吐槽', text: '這店插座真的很難搶欸' }, { label: '🙋 問他', text: '你常來這間嗎？' }],
    }),
  });
  const openers = (res.openers || []).filter(o => o?.length);
  return { ...res, opener: opening === 'me' ? [] : pickOpener(openers.length ? openers : [['嗨']], recent).slice(0, opening === 'slow' ? 1 : 2) };
}

// ---------- 當面階段 ----------
export function encounterOf(rel) {
  const sc = j(rel.scenario, {});
  return { phase: sc.phase || 'chat', card: sc.card || null, entry: sc.entry || null, opening: sc.opening || null, faceTurns: sc.faceTurns || 0, sc };
}

export function setEncounter(relId, patch) {
  const r = db.prepare('SELECT scenario FROM relationships WHERE id=?').get(relId);
  const sc = { ...j(r?.scenario, {}), ...patch };
  db.prepare('UPDATE relationships SET scenario=? WHERE id=?').run(JSON.stringify(sc), relId);
  return sc;
}

const BYE = /(掰|拜拜|bye|再見|先走了|我先走|要走了|我先去|下次見|先這樣)/i;
const AWKWARD = /((我們|我跟你)(認識|很熟)嗎|不熟|你誰|你是誰|你哪位|認識我嗎|幹嘛(突然)?找我|怎麼會有我的|好突然|你要幹嘛)/;

export function isAwkward(text = '') { return AWKWARD.test(text); }
export function isBye(text = '') { return BYE.test(text); }

/**
 * 當面階段寫回覆時的指示。turn 從 1 開始算（使用者第幾次當面回話）。
 * wrap：這輪要收尾並（依入口）交換聯絡方式。
 */
export function faceBlock({ card, entry, turn, wrap, persona }) {
  const lines = [
    '## 你們現在是「當面」說話（還沒有對方的聯絡方式，不是在傳訊息）',
    `相遇卡（這次真的發生的事，只能引用這裡有的）：${card.incident}`,
    `你開口的真正理由：${card.reason_to_talk}`,
    `這是你們當面的第 ${turn} 輪。說話要像當面講的：短、口語，可以帶一點動作感，但不要寫括號旁白。`,
    '不要說「剛加上 LINE」「傳訊息給你」這類話；不要提議之後一起去哪裡。sticker、voice、meal、postcard、activity、outing 都不要用。',
  ];
  if (wrap) {
    lines.push(entry === 'mood'
      ? '這輪自然地收尾、道別（例如你要回去上班了）。不要主動要聯絡方式，App 會讓對方自己決定要不要交換。'
      : `這輪自然地收尾，並照這個方式提出交換 LINE：${card.contact_exchange}。說完就道別，不要再丟新問題。`);
  } else if (turn >= 2) {
    lines.push('如果對方表現出想走或想結束，就自然收尾。');
  }
  return lines.join('\n');
}

/** 這輪結束後，當面階段要不要收尾。 */
export function shouldWrap({ turn, userText }) {
  return turn >= 3 || isBye(userText);
}
