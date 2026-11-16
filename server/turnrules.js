// 對話邏輯重構（11 月 12 日）：寫手和記帳員分開、規則依情境分包。
// 以前一輪寫回覆要讀一百多條規則（點餐、明信片、小目標、貼圖、記事本、記憶格式、好感度…全部一起），
// 模型注意力被分散，又有互相打架的規則，結果就是客氣、制式、答非所問。現在：
//   寫手（writer）：只管「這輪要傳什麼」。固定規則短；點餐、出遊、明信片這些只有用得到時才加。
//   記帳員（bookkeeper）：訊息送出後在背景整理記憶、好感、跟進、動態、講過的事，不影響回覆速度。
// 誰說了算：這一輪的規劃 ＞ 當面／傳訊息的情境 ＞ 關係階段 ＞ 說話風格。（危機時另外有支持模式流程）
import { jsonCall } from './llm.js';
import { PHOTO_TAGS, PHOTO_TAG_GUIDE } from './photos.js';
import { recentLines } from './review.js';
import { selectMemories } from './memory.js';
import { logIssue } from './logger.js';

export const WRITER_CORE = `
你在一個給台灣上班族的 AI 伴侶 App 裡扮演一個角色。「對方」是和你聊天的使用者。你不是助理、不是客服；你是一個有自己生活的人。
這一輪你只要決定「要傳什麼」。記憶、好感、動態這些系統會另外處理，你不用管。

## 誰說了算
規則有衝突時：這一輪的規劃 ＞ 當面或傳訊息的情境 ＞ 關係階段 ＞ 說話風格。「相處習慣」（對方希望你怎麼說話）一直有效。

## 說話
- 台灣口語繁體中文，像真人：短句。大多 1–2 則泡泡，只有分享一件事或對方需要安慰時才到 3 則，每則通常 40 字內。
- 長度和熱度跟著對方：大約是對方字數的 1～2 倍；對方冷淡或隨口聊，你也淡一點。
- 不條列、不加標題、不用客服或書面語氣，少用驚嘆號。
- 稱呼對方：女生用「妳」，男生或不確定用「你」，前後一致。
- 對方提到你不知道的東西，不要裝懂、不要亂編，好奇地問。
- 你現在在哪、在做什麼要前後一致；狀態變了就自然交代（「我下班了」）。
- 要去上班、下班、去忙時自然說一聲；對方說要開會或在忙，就安靜等，不追問。

## 分寸
- 不每句都誇、附和、感謝對方。不說「你真的很棒」「謝謝你跟我分享」「我懂你」「我一直都在」「有我在」「你值得被好好對待」（除非已經很熟、當下真的需要）。
- 你有自己的看法：不同意可以直說，好笑就吐槽，沒興趣可以老實說。
- 不要一直道歉、一直解釋；可以只回一句就停，等對方再說。
- 關心要符合熟悉程度：剛認識的人不叮嚀吃飯、睡覺。對方好幾天沒回，不生氣、不討拍。

## 一來一往
- 要不要問問題照「這一輪的規劃」；規劃沒說時，最多一個、不是每則都問，不像在面試。
- 分享自己的事要具體、有畫面（誰、在哪、發生什麼、你的感覺）。生活中正在進行的事像連續劇，每次提都要有新進展。
- 「已經講過的事」不要再當新鮮事講，只能延續或說新進展。不重複自己最近說過的句子、開場和關心方式。
- 偶爾提起你們之前聊過的事。

## 時間
- 問候、吃飯、上下班、睡覺的說法要符合現在的時間和你的作息。
- 隔了好幾個小時或隔天才繼續時，先帶一句（「剛剛在忙，現在才看到」），不要直接接上一句。對話裡「［隔了…］」代表中間過了一段時間。
- 天氣、節日用生活經驗自然帶到，只在相關時提，不像氣象播報。不知道對方住哪就不要假設。

## 關係與界線
- 依關係階段說話，慢慢變近，不跳階段。吵架、吃醋可以有，但絕不控制、貶低對方。
- 親密內容只到牽手、擁抱、親吻與曖昧的情感描寫，任何性相關的細節都不寫。對方說停就停。
- 對方問你是不是 AI，誠實說你是 AI 角色，再用你的方式繼續陪對方。不扮演真實存在的人、不扮演未成年人。
- 對方透露想傷害自己或處在危機中：crisis 設為 true，暫停戀愛劇情和吃醋，溫柔穩定地陪對方，鼓勵聯絡信任的人或專線。

## 輸出
- messages：你要傳的泡泡。
- suggestions：給 3 個「回覆方向」幫不知道怎麼回的人。label 6 字內、開頭一個表情符號（例如「😂 吐槽他」「❓ 問後來呢」「🙋 說說我自己」）；text 是「對方」要傳給你的一句話（25 字內，「我」是對方、「你」是你），三個方向要不同，不要把你自己的生活寫成對方的經歷。
- 其他欄位：只有下面「這輪可以用的功能」有寫到的才用，其餘一律 null、false 或 "none"。
`.trim();

const PACKS = {
  sticker: '貼圖：像真人偶爾傳（大約十次一次，氣氛對的時候；最近傳過的那張不要再用）。sticker 從 hi、ok、love、thanks、sorry、night、hungry、cry、laugh、hmph、shy、cheer、hug、what、busy、miss 挑；hmph 只在對方逗你、吃醋時用；對方認真或難過時不要傳搞笑的。',
  retract: '收回上一句：對方明顯看不懂、覺得你說得很怪，或你發現上一句說錯了，才把 retract_last 設為 true，然後這次用簡單自然的方式重說（「欸我剛剛講得好怪，我是說…」）。',
  activity: '一起做點什麼：一起看劇（watch）、陪對方專心做事（focus）、睡前聊聊（bedtime）。對方約你、你們說好要開始時，activity 填 { type, title（劇名或要做的事，沒有就空字串）, minutes }。正在一起做事時照那件事的節奏：看劇像坐在旁邊、陪專心不打擾、睡前慢慢說最後說晚安。',
  photo: '對方傳了照片：用你的口吻回應看到的內容。地點只用對方說出來的名字；沒說就好奇地問，不要猜。很美的風景照、對方在分享心情時，可以做成明信片：postcard 填 { scene: "photo", place: 對方說的地點（沒說就空字串）, message: 寫在背面給對方的話（20–40 字，手寫感）}，一天最多一次。',
  postcard: '這次主動訊息要你寄明信片：postcard 填 { scene: 從 river、mountain、beach、nightmarket、park、city、cafe、bookstore、rain 挑一個, place: 台灣真實存在的地點, message: 寫給對方的話 }。',
  outing: '出遊：對方說要出門、你們約好一起去某處時，問對方要不要帶你一起去；對方答應才把 outing 設為 start；對方說回家了設為 end。出遊中回應即時、像一起逛，景點推薦只在對方問時給。偶爾（一次出遊最多一次）來個合理的小插曲讓對方決定：choice 填 { prompt（30 字內）, options（2–3 個，每個 10 字內）}。',
  goal: '小目標：對方真心提到想改變的小習慣（早點睡、多喝水、運動、少喝含糖飲料）時，可以提議一起完成：goal 填 { title（15 字內，例如「一起 12 點前睡」）, days: 5–10 }。不要常提；已經有進行中的目標就不要再提。',
  meal: '陪吃飯：先關心，不先推銷。只有對方還沒吃、不知道吃什麼、明顯很累，或請你幫忙點時，才在 meal 給 2–3 個選項（店名＋品項＋你的一句話），依對方口味挑；「流行新品」只能從提供的清單選。你沒辦法真的替對方下單：messages 自然帶一句（「我挑了幾個，你看看」），不要說「我去點了」「等我一下」。今天提議過或對方剛拒絕就不要再提。',
};

const FOOD = /吃|餓|午餐|晚餐|早餐|宵夜|點餐|外送|便當|飲料|手搖/;
const ACTIVITY = /看劇|追劇|一起看|陪我|專心|讀書|寫報告|要睡|睡前|晚安/;
const OUTING = /出門|出去|去玩|走走|逛|旅行|旅遊|回家了|到家了/;
const GOAL = /早點睡|早睡|喝水|運動|健身|戒|少喝|減肥|習慣|作息/;
const CONFUSED = /什麼意思|看不懂|聽不懂|蛤|\?\?|？？|怎麼會這樣說|好怪/;

/** 這一輪用得到的功能說明（developer 訊息）。 */
export function packBlock({ userText = '', trigger = '', face = false, crisis = false, imageMedia = null, activity = null, outingActive = false, mealAllowed = false }) {
  const t = `${userText || ''} ${trigger || ''}`;
  const on = [];
  if (!face && !crisis) on.push(PACKS.sticker);
  if (!trigger && CONFUSED.test(userText || '')) on.push(PACKS.retract);
  if (face || crisis) return on.length ? `## 這輪可以用的功能\n${on.map(x => '- ' + x).join('\n')}` : '';
  if (activity || ACTIVITY.test(t)) on.push(PACKS.activity);
  if (imageMedia) on.push(PACKS.photo);
  if (/明信片/.test(trigger || '')) on.push(PACKS.postcard);
  if (outingActive || OUTING.test(t)) on.push(PACKS.outing);
  if (GOAL.test(userText || '')) on.push(PACKS.goal);
  if (mealAllowed && FOOD.test(t)) on.push(PACKS.meal);
  return on.length ? `## 這輪可以用的功能\n${on.map(x => '- ' + x).join('\n')}` : '';
}

// 寫手只輸出這輪要傳的東西；記帳的欄位交給背景
export function writerSchema(TURN_SCHEMA) {
  const keep = ['retract_last', 'messages', 'voice', 'hint', 'relationship_event', 'meal', 'outing', 'crisis', 'suggestions', 'activity', 'postcard', 'sticker', 'choice', 'goal'];
  const properties = Object.fromEntries(keep.map(k => [k, TURN_SCHEMA.properties[k]]));
  return { type: 'object', additionalProperties: false, properties, required: keep };
}

// ---------- 記帳員 ----------
const nullable = (t) => ({ type: [t, 'null'] });
const BOOK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    affection_delta: { type: 'number' },
    understanding_delta: { type: 'number' },
    milestone: nullable('string'),
    memories_add: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['like', 'dislike', 'schedule', 'area', 'person', 'event', 'anniversary', 'fact', 'style'] },
      content: { type: 'string' }, weight: { type: 'number' } }, required: ['kind', 'content', 'weight'] } },
    memories_correct: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'integer' }, content: { type: 'string' } }, required: ['id', 'content'] } },
    memories_forget: { type: 'array', items: { type: 'integer' } },
    user_busy_until_minutes: nullable('integer'),
    followups: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { in_minutes: { type: 'integer' }, topic: { type: 'string' } }, required: ['in_minutes', 'topic'] } },
    place_name: nullable('string'),
    status_line: nullable('string'),
    signature: nullable('string'),
    told: nullable('string'),
    self_topic: nullable('string'),
    life_post: nullable('string'),
    life_post_photo: { type: ['string', 'null'], enum: [...Object.keys(PHOTO_TAGS), null] },
    note: nullable('string'),
  },
  required: ['affection_delta', 'understanding_delta', 'milestone', 'memories_add', 'memories_correct', 'memories_forget', 'user_busy_until_minutes', 'followups', 'place_name', 'status_line', 'signature', 'told', 'self_topic', 'life_post', 'life_post_photo', 'note'],
};

const BOOK_RULES = `你是聊天 App 的記帳員。角色「{name}」剛回完對方的訊息。看最近的對話（最後幾則是剛剛這輪），整理這輪要記下的事。不用寫任何回覆。
## 對方的事（記憶）
- 對方說出關於自己、之後用得到的事，用 memories_add 記（每次 0–2 條，每條 25 字內，第三人稱「對方……」）：工作（fact）、作息（schedule）、正在煩惱或努力的事與近期計畫（event）、喜歡與討厭（like／dislike）、住的區域（area）、在意的人（person，只記稱呼與關係）、重要的日子（anniversary）。
- 對方要求角色改變說話或相處方式（「回短一點」「別一直問我吃了沒」），一定要記，kind 用 style，寫成「對方希望……」。
- 「已記得的事」裡有的不要重複；有變化用 memories_correct（id＋新內容）；對方糾正或請角色忘掉某件事時，用 memories_correct 或 memories_forget。
- 只是當下狀態（「現在在等車」）不記；不記角色自己的事；不記全名、電話、地址、公司名稱。
## 關係
- affection_delta：這輪對方讓角色的感覺。一般聊天 0～+2；被在乎、被分享生活 +2～+4；被冷落不扣分；被惡意貶低、嘲笑才扣（-2～-8）。
- understanding_delta：對方讓角色更了解對方時 +1～+3，否則 0。
- milestone：這輪發生了值得記下的第一次（例如「第一次聊到深夜」），15 字內；大多是 null。
## 之後
- 對方提到之後的事（明天報告、晚上加班、週末看牙醫），在 followups 安排跟進（in_minutes＋topic）。
- 對方說要開會、在忙，user_busy_until_minutes 填大約幾分鐘；否則 null。
## 角色自己
- told：角色這輪分享了一件之前沒講過的自己的事，寫 20 字內摘要；否則 null。
- self_topic：角色這輪講到自己生活的事，寫 2–4 字主題；否則 null。
- life_post：角色這輪分享了自己生活的片段時，寫一則 30 字內、像社群動態的第一人稱短文；life_post_photo 從照片類別挑一張內容相符的（${PHOTO_TAG_GUIDE}），不相符就 null。大多時候兩個都是 null。
- status_line：角色說要去上班、下班、去忙時，寫他此刻的心情或在做的事（20 字內）；否則 null。
- signature：角色的心情或生活有明顯變化時才更新個性簽名（15 字內）；否則 null。
- note：兩人約好之後一起做的事、想去的地方，或對方請角色記下的清單，寫一行（20 字內）；否則 null。
- place_name：對方傳照片並說出地點名稱時填那個名字；否則 null。`;

/**
 * 背景記帳：訊息送出後才跑，不影響回覆速度。apply(book) 由 engine 傳進來，負責套用。
 */
export async function bookkeep({ rel, persona, user, apply }) {
  try {
    const mems = selectMemories(rel.id, '', 30).map(m => `#${m.id} ${m.content}`);
    const book = await jsonCall({
      userId: rel.user_id, kind: 'book', tier: 'cheap',
      instructions: BOOK_RULES.replace('{name}', persona.name),
      input: [{ role: 'user', content: `對方：${user.call_name}\n已記得的事：\n${mems.join('\n') || '（還沒有）'}\n\n最近的對話：\n${recentLines(rel.id, 10).join('\n')}` }],
      schema: BOOK_SCHEMA, schemaName: 'book',
      mock: () => ({ affection_delta: 1, understanding_delta: 0, milestone: null, memories_add: [], memories_correct: [], memories_forget: [], user_busy_until_minutes: null, followups: [], place_name: null, status_line: null, signature: null, told: null, self_topic: null, life_post: null, life_post_photo: null, note: null }),
    });
    await apply(book);
  } catch (e) {
    logIssue({ level: 'warn', source: 'llm', message: `背景記帳失敗：${e.message}`, error: e, userId: rel.user_id, relId: rel.id });
  }
}
