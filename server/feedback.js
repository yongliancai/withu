// 語感回饋：使用者對角色某一句話的評價（很像真人／怪怪的），以及聊天中「聽不懂、什麼意思」的自動偵測。
// - 只有同意「用我的回饋改善角色」的人才會被收進資料庫，而且只存那幾句對話、去掉名字等個資。
// - 後台「語感調校」審核：把怪的改成自然的說法 → 變成同類角色的示範（立刻生效）；累積夠多再拿去微調模型。
import { db, now, j, logEvent } from './db.js';
import { packKey } from './styles.js';

db.exec(`CREATE TABLE IF NOT EXISTS msg_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  rel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL,        -- 1 很像真人、-1 怪怪的
  source TEXT NOT NULL,           -- user（使用者按的）| confused（使用者說聽不懂）
  suggestion TEXT,                -- 使用者覺得應該怎麼說
  context TEXT,                   -- 前面幾句對話（去掉個資，JSON）
  char_text TEXT NOT NULL,        -- 被評價的那句
  pack TEXT, archetype TEXT, character TEXT,
  status TEXT NOT NULL DEFAULT 'new',   -- new | example | ignored
  fixed_text TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (message_id, user_id, source)
)`);

export const consented = (user) => !!j(user.settings, {}).feedbackConsent;

// 去掉個資：使用者的名字、電話、email、網址、長串數字
function scrub(text, user) {
  let t = String(text || '');
  for (const n of [user.nickname, user.call_name].filter(x => x && x.length >= 1)) t = t.split(n).join('（對方）');
  return t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '（email）').replace(/https?:\/\/\S+/g, '（網址）').replace(/\d[\d\s-]{6,}\d/g, '（號碼）').slice(0, 300);
}

function contextOf(msg, user) {
  return db.prepare(`SELECT sender, text FROM messages WHERE rel_id=? AND id<? AND sender IN ('user','char') AND kind IN ('text','voice') ORDER BY id DESC LIMIT 6`)
    .all(msg.rel_id, msg.id).reverse().map(m => ({ who: m.sender === 'user' ? '對方' : '你', text: scrub(m.text, user) }));
}

/** 記一筆回饋。沒同意就不存（回傳 false）。 */
export function addFeedback(user, msg, { rating, source = 'user', suggestion = null }) {
  if (!consented(user)) return false;
  const c = db.prepare('SELECT persona FROM characters WHERE id=(SELECT character_id FROM relationships WHERE id=?)').get(msg.rel_id);
  const p = j(c?.persona, {});
  db.prepare(`INSERT INTO msg_feedback (message_id,rel_id,user_id,rating,source,suggestion,context,char_text,pack,archetype,character,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(message_id,user_id,source) DO UPDATE SET rating=excluded.rating, suggestion=COALESCE(excluded.suggestion, suggestion), created_at=excluded.created_at, status='new'`)
    .run(msg.id, msg.rel_id, user.id, rating, source, suggestion ? scrub(suggestion, user) : null, JSON.stringify(contextOf(msg, user)), scrub(msg.text, user), packKey(p), p.archetype || null, p.name || null, now());
  logEvent(user.id, 'msg_feedback', { rating, source });
  return true;
}

// 對方說「什麼意思」「看不懂」「怎麼會這樣說」：代表上一句他說得不自然
const CONFUSED = /什麼意思|甚麼意思|啥意思|看不懂|聽不懂|不懂你|你在說什麼|你在講什麼|怎麼會這樣說|怎麼這樣說|講話好怪|說話好怪|好奇怪的說法|蛤[?？]{1,}$|^[?？]{2,}$|你是說.{0,10}嗎|你的意思是/;
export function detectConfusion(user, relId, userText) {
  if (!userText || !CONFUSED.test(userText.trim())) return false;
  const last = db.prepare(`SELECT * FROM messages WHERE rel_id=? AND sender='char' AND kind IN ('text','voice') ORDER BY id DESC LIMIT 1`).get(relId);
  if (!last) return false;
  return addFeedback(user, last, { rating: -1, source: 'confused', suggestion: null });
}
