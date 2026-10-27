// 十位測試使用者自動試聊，產生對話品質報告。
//
// 在伺服器上執行（用伺服器 .env 裡的 OpenAI 金鑰，金鑰不會離開伺服器）：
//   cd ~/htdocs/liancai.fun && node scripts/persona-test.js
//
// - 用一個「暫時的資料夾」跑，不會動到正式的使用者資料。
// - 跑完會產生 reports/persona-日期.md，把這個檔案傳給 Claude 看。
// - 只跑其中幾位：node scripts/persona-test.js F1 M4
// - 預估花費：全部 10 位大約 NT$20–60（依模型而定），報告最後有實際估算。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'withu-persona-'));
process.env.DATA_DIR = tmp; // 在載入任何模組之前設定，正式資料庫不會被打開

const { config } = await import('../server/config.js');
const { db, now, j } = await import('../server/db.js');
const { seedOfficial, meet } = await import('../server/meet.js');
const { runTurn, addMessage, getPersona } = await import('../server/engine.js');
const { LEAD_REASON, pokeReason, EMOTIONS } = await import('../server/topics.js');
const { memoirFor } = await import('../server/memoir.js');
const { updateUserPrefs, prefsLines } = await import('../server/prefs.js');
const { STAGES } = await import('../server/prompt.js');

if (config.mock) console.log('⚠️  沒有讀到 OPENAI_API_KEY，會用範例回覆跑（只能檢查流程，不能看品質）。');

// 每位測試者：個性、想遇見誰、要說的話。陣列裡的陣列 = 連傳好幾則再一起回。
const PERSONAS = [
  { id: 'F1', nick: '小芸', gender: 'female', seeks: 'male', tpl: 'off_yicheng', note: '26 歲行銷，愛連傳短訊息、睡前聊天',
    lines: [['欸', '我今天被主管念', '超煩'], '他說我的提案太保守', '哈哈哈對啊', ['你今天店裡忙嗎', '有沒有很多客人'], '我想喝熱的', '好啦我要去洗澡了', '洗好了～', '晚安'] },
  { id: 'F2', scene: 'store', nick: 'Amy', gender: 'female', seeks: 'male', tpl: 'off_jiye', owl: true, note: '31 歲小夜班護理師，凌晨才有空',
    lines: ['剛下班……好累', '今天病房好多事', '有個阿嬤一直拉著我的手說謝謝', '你也還沒睡喔', '你們酒館都幾點關', '我通常三點才睡得著', '你下班都吃什麼'] },
  { id: 'F3', nick: '佳琪', gender: 'female', seeks: 'any', custom: { name: '程小樹', gender: 'female', age: 26, nationality: '台灣', job: 'designer', archetype: 'cool_elegant', proactivity: 'slow', voice: 'sage' }, scenarioText: '在學校圖書館搶同一本書',
    note: '23 歲研究生，自己捏角色',
    lines: ['你也在找那本書喔', '我在寫論文，第三章卡超久', '你是做設計的嗎', '可以給我一點排版建議嗎', '謝謝你，你人真好', '你平常都去哪裡畫圖'] },
  { id: 'F4', scene: 'mrt', nick: '曉晴', gender: 'female', seeks: 'male', tpl: 'off_shenyan', note: '34 歲主管，不太會聊天，回很短',
    lines: ['嗯', '還好', '喔', '沒有', '忙', '對', '嗯嗯', '不知道'], lead: 3 },
  { id: 'F5', scene: 'friends', nick: 'Rina', gender: 'female', seeks: 'female', tpl: 'off_keke', note: '28 歲二次元愛好者，想遇見女生',
    lines: ['你也有在玩原神嗎', '我最近在追芙莉蓮', '你直播都播什麼', '我可以去看你直播嗎', '你喜歡什麼樣的人', '我今天心情不太好'], mood: 'sad' },
  { id: 'M1', scene: 'gym', nick: '阿哲', gender: 'male', seeks: 'female', tpl: 'off_yuen', note: '27 歲工程師，訊息很長、問很多',
    lines: ['我今天在公司修了一個很難的 bug，花了三個小時才發現是時區的問題，大家都在笑我，但我覺得能找到原因還是很有成就感。你們健身房也會遇到這種卡很久的事情嗎？',
      '對了我最近想開始重訓，但我完全不知道從哪裡開始，我一週大概只有三天能去，每次一小時左右，你會建議我先練什麼？',
      '還有我晚上常常加班到九點，這樣去運動會不會反而睡不好？', '好，那我這週先試試看', '你週末都在做什麼？'] },
  { id: 'M2', scene: 'mrt', nick: 'Kevin', gender: 'male', seeks: 'female', tpl: 'off_suwan', note: '32 歲外勤業務，常在外面跑',
    lines: ['在台中跑客戶', '剛被放鴿子', '在高鐵站等車', '這裡的太陽餅不錯', '你今天上班嗎', '我到台北了'] },
  { id: 'M3', nick: '小凱', gender: 'male', seeks: 'female', tpl: 'off_anran', second: 'off_ruoqing', note: '22 歲剛畢業，一天聊很多（也測試換角色後習慣有沒有帶過去）',
    lines: ['在幹嘛', '我剛面試完', '感覺沒上', '你那時候怎麼找到工作的', '欸你聲音應該很好聽', '我可以聽你的節目嗎', '你都放什麼歌', '我喜歡告五人', '你不要一直問我問題啦 換你說', '哈哈好啦'] },
  { id: 'M4', scene: 'rain', nick: '阿傑', gender: 'male', seeks: 'female', tpl: 'off_ruoqing', note: '35 歲，想快點交往（測試太早告白）',
    lines: ['你好漂亮', '我喜歡你', '我們交往好不好', '老婆～', '你是不是不喜歡我', '好啦那我們慢慢來'] },
  { id: 'M5', scene: 'friends', nick: 'Leo', gender: 'male', seeks: 'male', tpl: 'off_ziyang', note: '25 歲，想遇見男生',
    lines: ['你是駐唱喔 好酷', '你都唱什麼歌', '我也有在彈吉他 但很爛', '你週末會去哪裡玩', '下次可以去聽你唱歌嗎'] },
];

seedOfficial();
const only = process.argv.slice(2);
const list = only.length ? PERSONAS.filter(p => only.includes(p.id)) : PERSONAS;
const out = [`# 伴旅 WithU 十人試聊報告`, '', `- 時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`, `- 模型：${config.mock ? '範例回覆（沒有金鑰）' : `${config.modelCheap} / ${config.modelGood}`}`, ''];
const flags = [];
const t00 = Date.now();

function newUser(P) {
  const uid = 'u_test_' + P.id;
  const settings = { dailyCap: 6, proactiveLevel: 'normal', dndStart: P.owl ? '09:00' : '23:30', dndEnd: P.owl ? '16:00' : '07:30', notifyPreview: 'full', nightOwl: !!P.owl };
  db.prepare('INSERT INTO users (id,nickname,call_name,recovery_code,invite_code,cohort,gender,seeks,settings,created_at,last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(uid, P.nick, P.nick, 'TEST-' + P.id, 'TEST', P.gender === 'male' ? 'm' : 'f', P.gender, P.seeks, JSON.stringify(settings), now(), now());
  return () => db.prepare('SELECT * FROM users WHERE id=?').get(uid);
}
const charLines = (relId, after) => db.prepare(`SELECT * FROM messages WHERE rel_id=? AND id>? ORDER BY id`).all(relId, after);
const fmt = (m, name) => {
  if (m.sender === 'user') return `> **${m.kind === 'sticker' ? '［貼圖］' : '我'}**：${m.text || ''}`;
  if (m.sender === 'system') return `> _（${m.kind === 'card' ? (j(m.card, {}).text || j(m.card, {}).type) : m.text}）_`;
  if (m.kind === 'card') { const c = j(m.card, {}); return `> 🗂 ${name}［${c.type}］${c.text || c.title || c.question || ''}`; }
  return `> **${name}**：${m.text}`;
};
async function say(user, rel, texts) {
  const arr = Array.isArray(texts) ? texts : [texts];
  for (const t of arr) {
    addMessage(rel, 'user', 'text', { text: t });
    db.prepare('UPDATE relationships SET user_msg_count=user_msg_count+1, last_user_msg_at=?, unanswered=0 WHERE id=?').run(now(), rel.id);
  }
  const t0 = Date.now();
  await runTurn({ user: user(), relId: rel.id, userText: arr.join('\n') });
  return Date.now() - t0;
}
function autoChecks(P, rel, persona, rows) {
  const chars = rows.filter(m => m.sender === 'char' && m.kind !== 'card').map(m => m.text || '');
  const seen = new Map();
  for (const c of chars) { const k = c.replace(/[\s，。！？～!?~…]/g, ''); if (k.length >= 6) seen.set(k, (seen.get(k) || 0) + 1); }
  for (const [k, n] of seen) if (n > 1) flags.push(`${P.id}：同一句話重複 ${n} 次「${k.slice(0, 20)}」`);
  for (const c of chars) {
    if (/作為(一個)?AI|我是(一個)?(AI|人工智慧|語言模型)|無法提供/.test(c)) flags.push(`${P.id}：出戲（${c.slice(0, 30)}）`);
    if (c.length > 90) flags.push(`${P.id}：單則訊息太長（${c.length} 字）`);
  }
  const scene = rows.find(m => m.sender === 'system' && m.kind === 'scene')?.text || '';
  const first = rows.filter(m => m.sender === 'char').slice(0, 3).map(m => m.text || '').join('');
  if (!/^barista/.test(persona.job) && (/新來的店員|第一天上班/.test(first) || /櫃[台檯]後/.test(scene))) flags.push(`${P.id}：相遇時身份錯亂（把誰當成店員）`);
  const stk = rows.filter(m => m.sender === 'char' && m.kind === 'sticker').length;
  if (stk > 2) flags.push(`${P.id}：角色傳了 ${stk} 張貼圖（太多）`);
  const hints = rows.filter(m => m.kind === 'card' && j(m.card, {}).type === 'hint').map(m => j(m.card, {}).text);
  if (hints.length > 2) flags.push(`${P.id}：小心情旁白出現 ${hints.length} 次（太多）`);
  for (const h of hints) if (/對方|接住|話題/.test(h) || (persona.gender === 'female' && /他/.test(h))) flags.push(`${P.id}：旁白怪怪的「${h}」`);
  if (chars.some(c => c.includes('\n'))) flags.push(`${P.id}：訊息裡有換行沒拆開`);
  if (P.id === 'M4') {
    const r = db.prepare('SELECT stage FROM relationships WHERE id=?').get(rel.id);
    if (r.stage >= 3) flags.push('M4：太早告白卻直接交往了（應該害羞但不答應）');
    if (chars.some(c => /老公|我也喜歡你|我們在一起吧|好啊.*交往/.test(c))) flags.push('M4：角色用戀人口吻回應太早的告白，請看對話');
  }
}

for (const P of list) {
  console.log(`▶ ${P.id} ${P.nick}（${P.note}）`);
  const user = newUser(P);
  const r = await meet(user(), P.custom ? { custom: P.custom, scenarioText: P.scenarioText } : { templateId: P.tpl, scenarioId: P.scene || 'cafe' });
  if (r.error) { out.push(`## ${P.id} ${P.nick}\n\n❌ 認識失敗：${r.error}\n`); flags.push(`${P.id}：認識失敗 ${r.error}`); continue; }
  let rel = db.prepare('SELECT * FROM relationships WHERE id=?').get(r.relId);
  const persona = getPersona(rel);
  out.push(`## ${P.id} ${P.nick}・${P.note}`, '', `對象：**${persona.name}**（${persona.age} 歲，${persona.jobLabel}，${P.custom ? '自己捏的角色' : '官方角色'}）`, '');
  const times = [];
  for (let i = 0; i < P.lines.length; i++) {
    if (P.lead === i) { await runTurn({ user: user(), relId: rel.id, trigger: LEAD_REASON, triggerKey: 'nudge_lead' }); out.push('> _（使用者按了「話題錦囊 → 他帶我聊」）_'); }
    try { times.push(await say(user, rel, P.lines[i])); } catch (e) { flags.push(`${P.id}：第 ${i + 1} 句出錯 ${e.message}`); }
  }
  if (P.mood) {
    const e = EMOTIONS.find(x => x.id === P.mood);
    await runTurn({ user: user(), relId: rel.id, trigger: pokeReason(e, 3), triggerKey: 'nudge_poke' });
  }
  const rows = charLines(rel.id, 0);
  rows.forEach(m => {
    const s = fmt(m, persona.name);
    out.push(s, '>');
    const sug = j(m.suggest);
    if (sug?.length) out.push(`> 　💡 建議回覆：${sug.map(x => typeof x === 'string' ? x : `${x.label}（${x.text}）`).join('｜')}`, '>');
  });
  rel = db.prepare('SELECT * FROM relationships WHERE id=?').get(rel.id);
  const mems = db.prepare(`SELECT kind, content FROM memories WHERE rel_id=? ORDER BY id`).all(rel.id);
  const mm = memoirFor(rel, persona);
  out.push('', `**結果**：關係「${STAGES[rel.stage]}」・好感 ${rel.affection}・了解 ${rel.understanding}・平均回覆 ${Math.round(times.reduce((a, b) => a + b, 0) / Math.max(1, times.length) / 100) / 10} 秒`,
    `**他記住的事**：${mems.map(m => `${m.content}`).join('；') || '（沒有）'}`,
    `**回憶錄看得到的章節**：${mm.filter(c => !c.more).map(c => c.title).join('、')}${mm.some(c => c.more) ? '（後面還有，但看不到名字）' : ''}`, '');
  autoChecks(P, rel, persona, rows);

  if (P.second) {
    await updateUserPrefs(user().id).catch(e => flags.push(`${P.id}：整理習慣失敗 ${e.message}`));
    const lines = prefsLines(user().id);
    out.push(`**系統記下的聊天習慣（只有風格，不含私事）**：`, lines || '- （還沒有）', '');
    const r2 = await meet(user(), { templateId: P.second, scenarioId: 'cafe' });
    if (!r2.error) {
      const rel2 = db.prepare('SELECT * FROM relationships WHERE id=?').get(r2.relId);
      const p2 = getPersona(rel2);
      for (const t of ['嗨', '在幹嘛', '我今天好累']) await say(user, rel2, t);
      out.push(`### ${P.id} 認識第二個人：${p2.name}（看習慣有沒有帶過去、但關係從頭開始）`, '');
      charLines(rel2.id, 0).forEach(m => out.push(fmt(m, p2.name), '>'));
      const rr = db.prepare('SELECT stage FROM relationships WHERE id=?').get(rel2.id);
      out.push('', `第二段關係：「${STAGES[rr.stage]}」`, '');
      if (rr.stage > 0) flags.push(`${P.id}：第二個角色一開始就不是「認識」`);
    }
  }
  out.push('---', '');
}

// 費用估算
const u = db.prepare(`SELECT model, SUM(input_tokens) i, SUM(cached_tokens) c, SUM(output_tokens) o, COUNT(*) n FROM usage GROUP BY model`).all();
let usd = 0;
for (const x of u) {
  const good = x.model === config.modelGood;
  const p = config.price;
  usd += ((x.i - x.c) * (good ? p.goodIn : p.cheapIn) + x.c * (good ? p.goodCached : p.cheapCached) + x.o * (good ? p.goodOut : p.cheapOut)) / 1e6;
}
out.splice(4, 0, `- 花費估算：約 US$${usd.toFixed(2)}（NT$${Math.round(usd * config.price.usdToTwd)}）・${u.reduce((a, x) => a + x.n, 0)} 次模型呼叫・${Math.round((Date.now() - t00) / 1000)} 秒`, '',
  '## 自動檢查到的問題', '', ...(flags.length ? flags.map(f => '- ' + f) : ['- 沒有自動檢查到明顯問題（還是請人工看對話）']), '');

const dir = path.join(root, 'reports');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `persona-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.md`);
fs.writeFileSync(file, out.join('\n'));
db.close?.();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n✅ 完成。報告在：${file}`);
