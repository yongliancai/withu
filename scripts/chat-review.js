#!/usr/bin/env node
// 聊天問題盤點：把後台累積的回饋整理成一份報告，拿去跟 Claude 討論怎麼改。
//   node scripts/chat-review.js            # 最近 14 天
//   node scripts/chat-review.js 30         # 最近 30 天
// 報告存在 reports/chat-review-日期.md（不會進 GitHub）。
// 內容只有：測試者「同意提供」的語感回饋（已去掉暱稱、電話、email）、意見回饋、
// 測試者自己按「回報問題」附上的對話、系統自動修正的紀錄和統計。不會匯出其他聊天內容。
import fs from 'node:fs';
import path from 'node:path';
import { db, j } from '../server/db.js';

const days = Number(process.argv[2]) || 14;
const since = Date.now() - days * 864e5;
const day = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const q = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return []; } };
const out = [];
const P = (s = '') => out.push(s);
const clip = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

P(`# 聊天問題盤點（最近 ${days} 天，產生於 ${day(Date.now())}）`);

// ---------- 概況 ----------
const users = q(`SELECT COUNT(DISTINCT r.user_id) n FROM messages m JOIN relationships r ON r.id=m.rel_id WHERE m.sender='user' AND m.created_at>=?`, since)[0]?.n || 0;
const msgs = q(`SELECT sender, COUNT(*) n FROM messages WHERE created_at>=? AND sender IN ('user','char') GROUP BY sender`, since);
P(`\n## 概況\n- 有聊天的測試者：${users} 位`);
for (const m of msgs) P(`- ${m.sender === 'user' ? '使用者' : '角色'}訊息：${m.n} 則`);
const short = q(`SELECT COUNT(*) n FROM messages WHERE created_at>=? AND sender='user' AND kind='text' AND length(text)<=3`, since)[0]?.n || 0;
P(`- 使用者回 3 個字以內的訊息：${short} 則（句點、敷衍的指標）`);

// ---------- 回合規劃 ----------
const moves = q(`SELECT move, COUNT(*) n FROM turn_plans WHERE created_at>=? GROUP BY move ORDER BY n DESC`, since);
if (moves.length) {
  const total = moves.reduce((a, b) => a + b.n, 0);
  P(`\n## 角色每輪選的動作（回合規劃，共 ${total} 輪）`);
  for (const m of moves) P(`- ${m.move}：${m.n}（${Math.round(m.n / total * 100)}%）`);
}

const needs = q(`SELECT json_extract(plan,'$.read.need') need, COUNT(*) n FROM turn_plans WHERE created_at>=? AND json_extract(plan,'$.read.need') IS NOT NULL GROUP BY need ORDER BY n DESC`, since);
if (needs.length) {
  const total = needs.reduce((a, b) => a + b.n, 0);
  P(`\n## 角色讀到的對方意圖（共 ${total} 輪）`);
  for (const m of needs) P(`- ${m.need}：${m.n}（${Math.round(m.n / total * 100)}%）`);
  const samples = q(`SELECT plan FROM turn_plans WHERE created_at>=? ORDER BY id DESC LIMIT 15`, since).map(r => j(r.plan, {})).filter(p => p.read?.meaning);
  if (samples.length) { P('\n最近幾輪「讀到的意思 → 決定的動作」：'); for (const p of samples) P(`- ${p.read.need}｜${clip(p.read.meaning, 60)}｜期待：${clip(p.read.expects, 40)} → ${p.move}`); }
}

// ---------- 語感回饋 ----------
const fb = q(`SELECT * FROM msg_feedback WHERE created_at>=? ORDER BY id DESC LIMIT 200`, since);
const bad = fb.filter(f => f.rating < 0), good = fb.filter(f => f.rating > 0);
P(`\n## 語感回饋（使用者同意提供）\n- 怪怪的：${bad.length} 則（其中「聽不懂」自動記下的 ${bad.filter(f => f.source === 'confused').length} 則）\n- 很像真人：${good.length} 則`);
const byChar = {};
for (const f of fb) { const k = f.character || '（未知）'; (byChar[k] ||= { bad: 0, good: 0 })[f.rating < 0 ? 'bad' : 'good']++; }
const worst = Object.entries(byChar).sort((a, b) => b[1].bad - a[1].bad).slice(0, 10);
if (worst.length) { P('\n被評「怪怪的」最多的角色：'); for (const [k, v] of worst) P(`- ${k}：怪 ${v.bad}／像 ${v.good}`); }
if (bad.length) {
  P('\n### 「怪怪的」的例子（新的在前）');
  for (const f of bad.slice(0, 60)) {
    const ctx = j(f.context, []);
    P(`\n**${f.character || ''}**（${f.pack || ''}／${f.archetype || ''}，${day(f.created_at)}${f.source === 'confused' ? '，使用者說聽不懂' : ''}）`);
    for (const c of (Array.isArray(ctx) ? ctx : []).slice(-6)) P(`> ${c.who === '對方' ? '使用者' : '角色'}：${clip(c.text, 120)}`);
    P(`> **角色（被評怪）：${clip(f.char_text, 200)}**`);
    if (f.suggestion) P(`> 使用者覺得應該說：${clip(f.suggestion, 200)}`);
  }
}
if (good.length) {
  P('\n### 「很像真人」的例子');
  for (const f of good.slice(0, 20)) P(`- ${f.character || ''}：${clip(f.char_text, 150)}`);
}

// ---------- 意見回饋 ----------
const ideas = q(`SELECT data, created_at FROM events WHERE name='feedback' AND created_at>=? ORDER BY id DESC LIMIT 100`, since);
if (ideas.length) {
  P(`\n## 意見回饋（我 → 意見回饋，${ideas.length} 則）`);
  for (const e of ideas) { const d = j(e.data, {}); P(`- ${day(e.created_at)}：${clip(d.text ?? d.message ?? d.content ?? e.data, 400)}`); }
}

// ---------- 使用者回報 ----------
const reports = q(`SELECT message, detail, created_at FROM logs WHERE source='user' AND created_at>=? ORDER BY id DESC LIMIT 40`, since);
if (reports.length) {
  P(`\n## 使用者回報問題（聊天室 ⋯ → 回報問題，${reports.length} 則）`);
  for (const r of reports) {
    const d = j(r.detail, {});
    P(`\n**${day(r.created_at)}${d.character ? `・${d.character}` : ""}**：${clip(r.message, 400)}`);
    const recent = d.recent || d.messages || [];
    if (Array.isArray(recent) && recent.length) for (const m of recent.slice(-10)) P(`> ${m.sender === 'user' ? '使用者' : m.sender === 'char' ? '角色' : '旁白'}：${clip(m.text, 140)}`);
  }
}

// ---------- 系統自動修正 ----------
const autos = q(`SELECT message, detail, created_at FROM logs WHERE level='auto' AND created_at>=? ORDER BY id DESC LIMIT 400`, since);
if (autos.length) {
  const kinds = {};
  for (const a of autos) { const k = a.message.replace(/（.*$/, '').slice(0, 40); kinds[k] = (kinds[k] || 0) + 1; }
  P(`\n## 系統自動修正（${autos.length} 次）`);
  for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) P(`- ${k}：${n}`);
  const probs = {};
  for (const a of autos) for (const p of j(a.detail, {}).problems || []) { const k = p.replace(/（「.*?」）/, '').slice(0, 30); probs[k] = (probs[k] || 0) + 1; }
  if (Object.keys(probs).length) { P('\n送出前檢查最常抓到的問題：'); for (const [k, n] of Object.entries(probs).sort((a, b) => b[1] - a[1]).slice(0, 15)) P(`- ${k}：${n}`); }
  P('\n改寫前後的例子：');
  for (const a of autos.filter(x => j(x.detail, {}).draft).slice(0, 25)) {
    const d = j(a.detail, {});
    P(`- 原本：${clip((d.draft || []).join('／'), 160)}\n  改成：${clip((d.rewritten || d.messages || []).join('／'), 160)}${d.problems?.length ? `\n  原因：${clip(d.problems.join('；'), 160)}` : ''}`);
  }
}

// ---------- 警告 ----------
const warns = q(`SELECT source, message, COUNT(*) n FROM logs WHERE level IN ('warn','error') AND created_at>=? AND source IN ('llm','review','scheduler') GROUP BY source, substr(message,1,30) ORDER BY n DESC LIMIT 20`, since);
if (warns.length) { P('\n## 聊天相關的警告與錯誤'); for (const w of warns) P(`- [${w.source}] ${clip(w.message, 80)}：${w.n} 次`); }

const dir = path.resolve('reports');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `chat-review-${new Date().toISOString().slice(0, 10)}.md`);
fs.writeFileSync(file, out.join('\n') + '\n');
console.log(`報告已存好：${file}`);
process.exit(0);
