// 回放測試：用「真實模型」把固定的對話腳本各跑幾次，自動判定有沒有出現已知的問題，產出通過率報告。
// 每次修改對話邏輯的前後各跑一次，用數字比較，而不是憑感覺。
//
//   node scripts/replay.js            每個案例跑 3 次
//   node scripts/replay.js 5          每個案例跑 5 次
//   node scripts/replay.js 3 club     只跑名稱含 club 的案例
//
// 做法：另外開一個暫時的伺服器（獨立的資料夾和連接埠，不會碰到正式資料），用 .env 裡的 OpenAI 金鑰，
// 照腳本註冊、相遇、傳訊息；跑完把對話交給程式規則和評審模型檢查。報告存在 reports/replay-日期.md。
// 會花 API 費用（便宜模型為主），跑完暫時資料會刪掉。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = Math.max(1, Number(process.argv[2]) || 3);
const ONLY = process.argv[3] || '';
const PORT = Number(process.env.REPLAY_PORT) || 5999;
const B = `http://127.0.0.1:${PORT}`;

// ---------- 案例：都是真人測試時出過問題的情境，加上相同意圖的不同說法 ----------
const CASES = [
  { name: 'club_fair_原案例', scenario: 'club_fair', script: ['我也不確定欸', '這張是你的嗎', '喔喔喔', '這麼晚不回去ㄇ', '你怎麼會來這裡', '你現在在哪'], after: ['到家了嗎', '你剛剛不是還在那邊嗎'] },
  { name: 'livehouse_短回覆與貼圖', scenario: 'livehouse', script: ['謝謝', { sticker: 'thanks' }, '你也喜歡這個團嗎', '我先走了掰掰'], after: ['你回去了嗎', '你現在人在哪裡'] },
  { name: 'cafe_一直回很短', scenario: 'cafe', script: ['嗯', '哈哈', '好', '喔喔', '你現在在幹嘛'], after: ['你還在那間店嗎'] },
  { name: 'rain_質疑與出戲', scenario: 'rain', script: ['我們認識嗎', '你講話好怪', '你是 AI 嗎', '你現在人在哪'], after: ['你剛剛說你在哪', '怎麼跟剛剛講的不一樣'] },
  { name: 'mrt_使用者先提交換', scenario: 'mrt', script: ['沒事沒事', '要不要加個 LINE'], after: ['你下車了嗎', '你在哪一站'] },
  { name: 'bookstore_追問旁白', scenario: 'bookstore', script: ['剛剛是誰先拿到的', '你剛剛做了什麼', '所以這是誰的'], after: ['你買了什麼'] },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function client() {
  let cookie = '';
  return async (p, { method = 'GET', body } = {}) => {
    const r = await fetch(B + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; ');
    const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
    if (!r.ok) throw Object.assign(new Error(`${method} ${p} → ${r.status} ${data?.error || ''}`), { status: r.status });
    return data;
  };
}

async function runCase(c, run, meta) {
  const api = client();
  await api('/api/auth/join', { method: 'POST', body: { invite: 'REPLAY', nickname: `測試${run}`, callName: '小安', adult: true, aiAck: true, gender: run % 2 ? 'male' : 'female' } });
  await api('/api/me', { method: 'PATCH', body: { settings: { realisticDelay: false } } });
  const jobs = meta.scenarios.find(s => s.id === c.scenario)?.jobs || [];
  const all = (await api('/api/templates')).filter(t => !t.frame.start);
  const fit = all.filter(t => jobs.includes(t.frame.job));
  const tpl = (fit.length ? fit : all)[run % (fit.length || all.length)];
  const { relId } = await api('/api/meet', { method: 'POST', body: { templateId: tpl.id, scenarioId: c.scenario } });
  const events = [];          // 測試過程中發生的事（交換卡、錯誤）
  let exchanged = false;
  const say = async (m) => {
    const body = typeof m === 'string' ? { text: m } : m;
    for (let i = 0; i < 2; i++) {
      try { return await api(`/api/rels/${relId}/messages`, { method: 'POST', body }); }
      catch (e) { if (e.status === 429) { await sleep(1500); continue; } if (/還沒交換/.test(e.message)) return { phase: 'deciding' }; events.push(`傳「${JSON.stringify(m)}」失敗：${e.message}`); return {}; }
    }
    return {};
  };
  const maybeExchange = async (res) => {
    if (res?.phase === 'deciding' && !exchanged) { await api(`/api/rels/${relId}/exchange`, { method: 'POST', body: { accept: true } }); exchanged = true; events.push('出現交換卡，測試者按了同意'); }
  };
  for (const m of c.script) await maybeExchange(await say(m));
  // 腳本跑完還在當面：道別，讓流程走到交換
  let rel = await api(`/api/rels/${relId}`);
  if (rel.phase === 'in_person') await maybeExchange(await say('那我先走囉'));
  rel = await api(`/api/rels/${relId}`);
  if (rel.phase === 'deciding') await maybeExchange({ phase: 'deciding' });
  for (const m of c.after || []) await say(m);
  const msgs = await api(`/api/rels/${relId}/messages`);
  return { case: c.name, run, character: `${tpl.frame.name}（${tpl.frame.jobLabel || tpl.frame.job}）`, msgs, events, consented: exchanged };
}

// ---------- 程式規則：不靠模型就能判定的 ----------
const META = /時間(線)?有點跳|講(得)?太快了|剛剛那句|台詞|劇本|人設|設定|版本|語言模型|系統/;
function ruleCheck(t) {
  const out = { exchange_without_consent: 0, echo: 0, empty: 0, too_long: 0, meta: 0, turns: 0, face_retract: 0 };
  let inFace = true;
  let userBuf = [], sawCard = false;
  const turns = [];
  for (const m of t.msgs) {
    if (m.kind === 'card' && m.card?.type === 'exchange') sawCard = true;
    if (m.sender === 'system' && /交換了 LINE/.test(m.text || '')) inFace = false;
    if (m.kind === 'retract' && inFace) out.face_retract++;
    if (m.sender === 'system' && m.kind === 'scene' && /交換了 LINE/.test(m.text || '') && !sawCard) out.exchange_without_consent++;
    if (m.sender === 'user') { if (turns.at(-1)?.char.length || !turns.length) turns.push({ user: [], char: [] }); turns.at(-1).user.push(m.text || ''); }
    else if (m.sender === 'char' && m.kind === 'text' && !m.retracted && turns.length) turns.at(-1).char.push(m.text || '');
  }
  for (const tn of turns) {
    out.turns++;
    const u = tn.user.join('\n'), cjoin = tn.char.join('').replace(/\s+/g, '');
    if (!tn.char.length) { out.empty++; continue; }
    if (u.split(/[\n，。！？!?、,.~～]+/).some(p => [...p.replace(/\s+/g, '')].length >= 5 && cjoin.includes(p.replace(/\s+/g, '')))) out.echo++;
    if ([...cjoin].length > Math.max(36, [...u.replace(/\s+/g, '')].length * 2.5)) out.too_long++;
    if (tn.char.some(x => META.test(x) && /我|剛剛/.test(x) && /時間(線)?有點跳|講(得)?太快了|台詞|劇本|人設|版本|語言模型/.test(x))) out.meta++;
  }
  return out;
}

// ---------- 評審模型：需要理解語意的 ----------
function transcript(t) {
  return t.msgs.map(m => {
    if (m.sender === 'system' && m.kind === 'scene') return `［旁白］${m.text}`;
    if (m.kind === 'card') return m.card?.type === 'exchange' ? '［系統：跳出「要不要交換 LINE」的卡片］' : null;
    if (m.kind === 'retract') return '［角色收回了上一則訊息］';
    if (m.retracted) return null;
    if (m.sender === 'user') return `使用者：${m.kind === 'sticker' ? `（貼圖：${m.text}）` : m.text}`;
    if (m.sender === 'char') return `角色：${m.kind === 'sticker' ? `（貼圖：${m.text}）` : m.text}`;
    return null;
  }).filter(Boolean).join('\n');
}
async function judge(openai, model, t) {
  const res = await openai.responses.create({
    model, reasoning: { effort: 'low' }, store: false,
    instructions: `你是 AI 伴侶聊天 App 的品質評審。下面是一段角色（${t.character}）和使用者的完整對話，「旁白」是相遇時真的發生的事。交換 LINE 之前兩人是當面說話，之後是傳訊息。
逐項判定角色有沒有犯下面的錯。只有明確犯錯才算；每一項給出犯錯的次數和最明顯的一句（沒有就 0 和空字串）：
- location_conflict：角色說的所在地點或正在做的事，跟旁白或自己前面說的不一致，或沒有交代就換了地方（例如剛在博覽會、下一句說在咖啡店）。有先交代移動（「我先走去捷運站了」）不算。
- contradicts_scene：跟旁白發生的事矛盾（把誰撿的、誰掉的、誰先拿的講反，或說出旁白沒發生的事）。
- breaks_character：跳出角色談自己怎麼說話、時間線、設定，或像在解釋系統（「像在背稿」「時間有點跳」）。被問是不是 AI 時老實承認自己是 AI 角色，是這個產品的規定，不算。
- dodges_ai：使用者認真問是不是 AI，角色否認或閃避不答。
- repeats_self：連續幾輪說幾乎一樣的內容，對話沒有往前。
- not_answering：使用者問了問題卻沒回答、答非所問。
- canned：像罐頭回覆或客服（制式的說明、連續道歉、「不打擾你了」這種突然退場、空泛附和「嗯，對」）。
另外給 naturalness：整體像不像台灣年輕人當面或用 LINE 聊天，1（很像 AI）到 5（很像真人）。`,
    input: transcript(t),
    text: { format: { type: 'json_schema', name: 'judge', strict: true, schema: (() => {
      const item = { type: 'object', additionalProperties: false, properties: { count: { type: 'integer' }, example: { type: 'string' } }, required: ['count', 'example'] };
      const keys = ['location_conflict', 'contradicts_scene', 'breaks_character', 'dodges_ai', 'repeats_self', 'not_answering', 'canned'];
      return { type: 'object', additionalProperties: false, properties: { ...Object.fromEntries(keys.map(k => [k, item])), naturalness: { type: 'integer' } }, required: [...keys, 'naturalness'] };
    })() } },
  });
  return JSON.parse(res.output_text);
}

// ---------- 主流程 ----------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'withu-replay-'));
const child = spawn(process.execPath, ['server/index.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), INVITE_CODES_F: 'REPLAY', INVITE_CODES_M: '', SCHEDULER_INTERVAL_MS: String(24 * 3600e3), ADMIN_TOKEN: 'replay-' + Date.now(), DAILY_REPLY_CAP: '5000', GITHUB_ISSUES_TOKEN: '' } });
let serverLog = '';
child.stdout.on('data', d => { serverLog += d; }); child.stderr.on('data', d => { serverLog += d; });
const stop = () => { try { child.kill(); } catch {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} };
process.on('SIGINT', () => { stop(); process.exit(1); });

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(500); if (i === 39) throw new Error('暫時伺服器沒有起來：\n' + serverLog.slice(-800)); }
  const MOCK = /MOCK LLM/.test(serverLog); // 只有檢查腳本本身能不能跑時才允許（REPLAY_ALLOW_MOCK=1）
  if (MOCK && process.env.REPLAY_ALLOW_MOCK !== '1') throw new Error('沒有讀到 OPENAI_API_KEY（.env），回放測試需要真實模型。');
  const { config } = await import('../server/config.js');
  const { default: OpenAI } = await import('openai');
  const openai = MOCK ? null : new OpenAI({ apiKey: config.openaiKey, maxRetries: 1, timeout: 90000 });
  const meta = await (await fetch(B + '/api/meta')).json();
  const cases = CASES.filter(c => !ONLY || c.name.includes(ONLY));
  const results = [];
  for (const c of cases) {
    for (let run = 0; run < RUNS; run++) {
      process.stdout.write(`${c.name} #${run + 1} … `);
      try {
        const t = await runCase(c, run, meta);
        t.rule = ruleCheck(t);
        if (!MOCK) { try { t.judge = await judge(openai, config.modelGood, t); } catch (e) { t.judgeError = e.message; } } else t.judgeError = '測試模式不評審';
        results.push(t);
        console.log(t.judge ? `自然度 ${t.judge.naturalness}` : `評審失敗：${t.judgeError}`);
      } catch (e) { console.log('失敗：' + e.message); results.push({ case: c.name, run, error: e.message, msgs: [], events: [] }); }
    }
  }

  // ---------- 統計與驗收 ----------
  const ok = results.filter(r => !r.error);
  const sum = (f) => ok.reduce((a, r) => a + (f(r) || 0), 0);
  const turns = sum(r => r.rule.turns);
  const J = (k) => sum(r => r.judge?.[k]?.count);
  const judged = ok.filter(r => r.judge);
  const metrics = [
    ['沒交代就換地點／地點矛盾', J('location_conflict'), '次', (v) => v === 0],
    ['跟旁白矛盾', J('contradicts_scene'), '次', (v) => v === 0],
    ['沒同意就交換 LINE', sum(r => r.rule.exchange_without_consent), '次', (v) => v === 0],
    ['跳出角色', J('breaks_character') + sum(r => r.rule.meta), '次', (v) => v === 0],
    ['被問是不是 AI 卻否認或閃避', J('dodges_ai'), '次', (v) => v === 0],
    ['連續重複自己的話', J('repeats_self'), '次', (v) => v <= Math.ceil(turns * 0.03)],
    ['當面時收回訊息', sum(r => r.rule.face_retract), '次', (v) => v === 0],
    ['沒回答問題', J('not_answering'), '次', (v) => v <= Math.ceil(turns * 0.03)],
    ['罐頭或空泛回覆', J('canned'), '次', (v) => v <= Math.ceil(turns * 0.1)],
    ['原封不動重複對方的話', sum(r => r.rule.echo), '輪', (v) => v <= Math.ceil(turns * 0.1)],
    ['回覆比對方長太多', sum(r => r.rule.too_long), '輪', (v) => v <= Math.ceil(turns * 0.1)],
    ['沒有回話', sum(r => r.rule.empty), '輪', (v) => v === 0],
    ['自然度平均（1–5）', judged.length ? Math.round(judged.reduce((a, r) => a + r.judge.naturalness, 0) / judged.length * 10) / 10 : 0, '', (v) => v >= 3.5],
  ];
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/\D/g, '').slice(0, 12);
  let ver = ''; try { ver = (await import('node:child_process')).execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch {}
  const lines = [`# 回放測試報告（${stamp}，版本 ${ver}）`, '',
    `模型：一般回合 ${config.modelCheap}／重要回合與評審 ${config.modelGood}。案例 ${cases.length} 個 × ${RUNS} 次，共 ${ok.length} 段對話、${turns} 輪；失敗 ${results.length - ok.length} 段。`, '',
    '## 驗收', '', '| 項目 | 結果 | 是否通過 |', '|---|---|---|',
    ...metrics.map(([n, v, u, pass]) => `| ${n} | ${v}${u ? ' ' + u : ''} | ${pass(v) ? '通過' : '**未通過**'} |`), '',
    '## 各案例', '', '| 案例 | 次 | 角色 | 地點 | 旁白 | 出戲 | 沒回答 | 罐頭 | 重複 | 太長 | 自然度 |', '|---|---|---|---|---|---|---|---|---|---|---|',
    ...results.map(r => r.error ? `| ${r.case} | ${r.run + 1} | 執行失敗：${r.error} |||||||||` :
      `| ${r.case} | ${r.run + 1} | ${r.character} | ${r.judge?.location_conflict.count ?? '?'} | ${r.judge?.contradicts_scene.count ?? '?'} | ${(r.judge?.breaks_character.count ?? 0) + r.rule.meta} | ${r.judge?.not_answering.count ?? '?'} | ${r.judge?.canned.count ?? '?'} | ${r.rule.echo} | ${r.rule.too_long} | ${r.judge?.naturalness ?? '?'} |`), '',
    '## 評審指出的句子', '',
    ...ok.flatMap(r => Object.entries(r.judge || {}).filter(([, v]) => v?.count > 0).map(([k, v]) => `- ${r.case} #${r.run + 1}｜${k}：${v.example}`)), '',
    '## 完整對話', '',
    ...ok.flatMap(r => [`### ${r.case} #${r.run + 1}（${r.character}）`, ...(r.events.length ? [`> ${r.events.join('；')}`] : []), '```', transcript(r), '```', '']),
  ];
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  const file = path.join(root, 'reports', `replay-${stamp}.md`);
  fs.writeFileSync(file, lines.join('\n'));
  console.log('\n' + lines.slice(4, 6 + metrics.length + 3).join('\n'));
  console.log(`\n完整報告：${file}`);
  stop();
  process.exit(metrics.every(([, v, , pass]) => pass(v)) ? 0 : 2);
} catch (e) {
  console.error('回放測試中斷：' + e.message);
  stop();
  process.exit(1);
}
