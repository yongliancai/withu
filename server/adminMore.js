// 後台第二批：系統參數、費用與預算、單一使用者管理、角色生活檢視、公告、新增／停用官方角色。
// 所有路由都需要 Authorization: Bearer <ADMIN_TOKEN>。
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, now, j } from './db.js';
import { allSettings, setSetting, S } from './settings.js';
import { budgetState, rowUsd, sumUsd, periodStarts, resetBudgetCache } from './budget.js';
import { deleteAccount } from './account.js';
import { broadcast, pushEnabled } from './push.js';
import { JOBS, ARCHETYPES, CATEGORIES, VOICES, PROACTIVITY, frameFromOfficial, taipeiParts } from './characters.js';
import { STAGES } from './prompt.js';
import { pastLife } from './lifelog.js';
import { mainOf, photosOf, makeMain, makeLife, portraitFile, LIFE_COUNT } from './portraits.js';
import fs from 'node:fs';
import { runBugDigest, bugList, githubEnabled } from './bugwatch.js';

db.exec(`CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  pushed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`);

/** 給 App 用：目前上架的公告（最新的在前面）。 */
export function activeAnnouncements() {
  return db.prepare('SELECT id, text, created_at at FROM announcements WHERE active=1 ORDER BY id DESC LIMIT 3').all();
}

const usd = (x) => Math.round(x * 100) / 100;

export function mountAdminMore(app) {
  const ok = (req) => config.adminToken && (req.headers.authorization || '') === `Bearer ${config.adminToken}`;
  const A = (method, path, fn) => app[method](`/api/admin${path}`, async (req, res) => {
    if (!ok(req)) return res.status(401).json({ error: 'unauthorized' });
    try { await fn(req, res); } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // ---- 語感調校：使用者的「很像真人／怪怪的」回饋 → 審核 → 變成同類角色的示範例句 ----
  A('get', '/tuning', (req, res) => {
    const status = ['new', 'example', 'ignored'].includes(req.query.status) ? req.query.status : 'new';
    const list = db.prepare(`SELECT id, rating, source, suggestion, context, char_text, pack, archetype, character, status, fixed_text, created_at FROM msg_feedback WHERE status=? ORDER BY id DESC LIMIT 200`).all(status)
      .map(r => ({ ...r, context: j(r.context, []) }));
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM msg_feedback GROUP BY status').all().map(r => [r.status, r.n]));
    const bySrc = db.prepare(`SELECT source, rating, COUNT(*) n FROM msg_feedback WHERE created_at>? GROUP BY source, rating`).all(now() - 7 * 86400000);
    const examples = db.prepare('SELECT * FROM style_examples ORDER BY id DESC LIMIT 300').all();
    res.json({ list, counts, bySrc, examples });
  });
  // 存成示範：好的那句（👍）或後台改寫後的自然說法（👎）
  A('post', '/tuning/:id', (req, res) => {
    const f = db.prepare('SELECT * FROM msg_feedback WHERE id=?').get(Number(req.params.id));
    if (!f) return res.status(404).json({ error: '找不到' });
    if (req.body?.action === 'ignore') { db.prepare(`UPDATE msg_feedback SET status='ignored' WHERE id=?`).run(f.id); return res.json({ ok: true }); }
    const reply = String(req.body?.reply || (f.rating === 1 ? f.char_text : '')).trim().slice(0, 200);
    if (!reply) return res.status(400).json({ error: '請寫上自然的說法' });
    const ctx = j(f.context, []);
    const lastUser = [...ctx].reverse().find(x => x.who === '對方')?.text || '';
    const context = String(req.body?.context ?? lastUser).trim().slice(0, 200);
    if (!context) return res.status(400).json({ error: '請寫上對方說了什麼' });
    const scope = req.body?.scope === 'all' ? 'all' : 'arch';
    db.prepare('INSERT INTO style_examples (pack, archetype, context, reply, feedback_id, active, created_at) VALUES (?,?,?,?,?,1,?)')
      .run(f.pack || 'f25', scope === 'all' ? null : f.archetype, context, reply, f.id, now());
    db.prepare(`UPDATE msg_feedback SET status='example', fixed_text=? WHERE id=?`).run(reply, f.id);
    res.json({ ok: true });
  });
  A('post', '/tuning-examples', (req, res) => {
    const { pack, archetype, context, reply } = req.body || {};
    if (!/^[fm](20|25|30)$/.test(pack || '') || !context?.trim() || !reply?.trim()) return res.status(400).json({ error: '請填完整' });
    db.prepare('INSERT INTO style_examples (pack, archetype, context, reply, active, created_at) VALUES (?,?,?,?,1,?)').run(pack, archetype || null, context.trim().slice(0, 200), reply.trim().slice(0, 200), now());
    res.json({ ok: true });
  });
  A('post', '/tuning-examples/:id', (req, res) => {
    const id = Number(req.params.id);
    if (req.body?.delete) db.prepare('DELETE FROM style_examples WHERE id=?').run(id);
    else db.prepare('UPDATE style_examples SET active=? WHERE id=?').run(req.body?.active ? 1 : 0, id);
    res.json({ ok: true });
  });
  // 匯出成微調用的訓練檔（JSONL；只含去識別化的對話片段和審核過的說法）
  A('get', '/tuning-export', (req, res) => {
    const rows = db.prepare(`SELECT f.context ctx, e.context, e.reply FROM style_examples e JOIN msg_feedback f ON f.id=e.feedback_id WHERE e.active=1`).all();
    const lines = rows.map(r => {
      const msgs = j(r.ctx, []).map(x => ({ role: x.who === '你' ? 'assistant' : 'user', content: x.text }));
      // 最後一句要是對方說的話（後台審核時填的「對方說」）
      const last = [...msgs].reverse().find(m => m.role === 'user');
      if (!last || last.content !== r.context) msgs.push({ role: 'user', content: r.context });
      return JSON.stringify({ messages: [...msgs, { role: 'assistant', content: r.reply }] });
    });
    res.setHeader('Content-Type', 'application/jsonl; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="withu-tuning.jsonl"');
    res.send(lines.join('\n'));
  });

  // ---- 待修清單（自動回報的程式問題） ----
  A('get', '/bugs', (req, res) => res.json({ github: githubEnabled(), repo: process.env.GITHUB_REPO || '', list: bugList() }));
  A('post', '/bugs/run', async (req, res) => res.json(await runBugDigest()));

  // ---- 系統參數 ----
  A('get', '/settings', (req, res) => res.json(allSettings()));
  A('post', '/settings', (req, res) => {
    const errs = [];
    for (const [k, v] of Object.entries(req.body || {})) { const e = setSetting(k, v); if (e) errs.push(e); }
    resetBudgetCache();
    if (errs.length) return res.status(400).json({ error: errs.join('；') });
    res.json({ ok: true, settings: allSettings() });
  });

  // ---- 費用與預算 ----
  A('get', '/costs', (req, res) => {
    const st = budgetState();
    const since = now() - 30 * 864e5;
    const rows = db.prepare('SELECT user_id, kind, model, input_tokens, cached_tokens, output_tokens, units, created_at FROM usage WHERE created_at>=?').all(since);
    const dayKey = (ts) => taipeiParts(ts).date;
    const daily = {};
    for (const r of rows) daily[dayKey(r.created_at)] = (daily[dayKey(r.created_at)] || 0) + rowUsd(r);
    const { month } = periodStarts();
    const mRows = rows.filter(r => r.created_at >= month);
    const byKind = {};
    for (const r of mRows) byKind[r.kind] = (byKind[r.kind] || 0) + rowUsd(r);
    const byUser = {};
    for (const r of mRows) if (r.user_id) byUser[r.user_id] = (byUser[r.user_id] || 0) + rowUsd(r);
    const top = Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([uid, v]) => {
      const u = db.prepare('SELECT nickname FROM users WHERE id=?').get(uid);
      return { id: uid, nickname: u?.nickname || '（已刪除）', usd: usd(v) };
    });
    res.json({
      state: { ...st, dayUsd: usd(st.dayUsd), monthUsd: usd(st.monthUsd) }, usdToTwd: config.price.usdToTwd, mock: config.mock,
      daily: Object.entries(daily).sort().map(([d, v]) => ({ day: d, usd: usd(v) })),
      byKind: Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ kind: k, usd: usd(v) })),
      top,
    });
  });

  // ---- 單一使用者 ----
  A('get', '/testers/:id', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) return res.status(404).json({ error: '找不到這個人' });
    const day = taipeiParts().date;
    const use = db.prepare('SELECT replies, photos, capped FROM daily_use WHERE user_id=? AND day=?').get(u.id, day) || { replies: 0, photos: 0, capped: 0 };
    const { month } = periodStarts();
    const cost = sumUsd(db.prepare('SELECT kind, model, input_tokens, cached_tokens, output_tokens, units FROM usage WHERE user_id=? AND created_at>=?').all(u.id, month));
    const rels = db.prepare('SELECT r.*, c.persona FROM relationships r JOIN characters c ON c.id=r.character_id WHERE r.user_id=? ORDER BY r.created_at DESC').all(u.id).map(r => {
      const p = j(r.persona, {});
      const cnt = db.prepare(`SELECT SUM(sender='user') u, SUM(sender='char') c, MAX(created_at) last FROM messages WHERE rel_id=?`).get(r.id);
      return { id: r.id, name: p.name, gender: p.gender, jobLabel: p.jobLabel, status: r.status, stage: STAGES[r.stage], affection: Math.round(r.affection), understanding: Math.round(r.understanding),
        createdAt: r.created_at, lastAt: cnt.last, userMsgs: cnt.u || 0, charMsgs: cnt.c || 0,
        memories: db.prepare(`SELECT COUNT(*) n FROM memories WHERE rel_id=?`).get(r.id).n };
    });
    res.json({
      id: u.id, nickname: u.nickname, cohort: u.cohort, gender: u.gender, seeks: u.seeks, createdAt: u.created_at, lastActiveAt: u.last_active_at, disabled: !!u.disabled,
      today: { ...use, replyCap: S('dailyReplyCap'), photoCap: S('dailyPhotoCap') }, monthUsd: usd(cost),
      prefs: j(u.prefs, null), rels,
    });
  });
  // 重置今天的用量（等於解除今天的上限）
  A('post', '/testers/:id/reset-today', (req, res) => {
    db.prepare('DELETE FROM daily_use WHERE user_id=? AND day=?').run(req.params.id, taipeiParts().date);
    res.json({ ok: true });
  });
  // 代為處理「刪除我的資料」：帳號和所有資料永久刪除
  A('post', '/testers/:id/delete', (req, res) => {
    if (req.body?.confirm !== 'DELETE') return res.status(400).json({ error: '需要確認' });
    res.json({ ok: deleteAccount(req.params.id) });
  });

  // ---- 角色的生活 ----
  A('get', '/rels/:id/life', (req, res) => {
    const r = db.prepare('SELECT r.*, c.persona FROM relationships r JOIN characters c ON c.id=r.character_id WHERE r.id=?').get(req.params.id);
    if (!r) return res.status(404).json({ error: '找不到' });
    const p = j(r.persona, {});
    const logs = db.prepare('SELECT day, items, summary FROM life_log WHERE rel_id=? ORDER BY day DESC LIMIT 30').all(r.id).map(l => ({ ...l, items: j(l.items, []) }));
    const { digests } = pastLife(r.id);
    res.json({
      name: p.name, jobLabel: p.jobLabel, stage: STAGES[r.stage],
      logs, digests,
      arcs: db.prepare('SELECT id, title, premise, beats, step, status, created_at FROM arcs WHERE rel_id=? ORDER BY id DESC LIMIT 20').all(r.id)
        .map(a => ({ ...a, beats: j(a.beats, []).map(b => b.text) })),
      posts: db.prepare('SELECT id, text, story, created_at FROM posts WHERE rel_id=? ORDER BY id DESC LIMIT 40').all(r.id),
      told: db.prepare('SELECT content FROM told WHERE rel_id=? ORDER BY id DESC LIMIT 30').all(r.id).map(x => x.content),
    });
  });
  A('delete', '/posts/:id', (req, res) => {
    db.prepare('DELETE FROM post_comments WHERE post_id=?').run(req.params.id);
    db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });
  A('delete', '/arcs/:id', (req, res) => {
    db.prepare(`UPDATE arcs SET status='done', ended_at=? WHERE id=?`).run(now(), req.params.id);
    res.json({ ok: true });
  });

  // ---- 公告 ----
  A('get', '/announcements', (req, res) => res.json({ push: pushEnabled(), list: db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 50').all() }));
  A('post', '/announcements', async (req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 200);
    if (!text) return res.status(400).json({ error: '寫點內容' });
    const id = db.prepare('INSERT INTO announcements (text,created_at) VALUES (?,?)').run(text, now()).lastInsertRowid;
    let sent = 0;
    if (req.body?.push) { sent = await broadcast({ title: '伴旅公告', body: text }); db.prepare('UPDATE announcements SET pushed=? WHERE id=?').run(sent, id); }
    res.json({ ok: true, id, sent });
  });
  A('patch', '/announcements/:id', (req, res) => {
    db.prepare('UPDATE announcements SET active=? WHERE id=?').run(req.body?.active ? 1 : 0, req.params.id);
    res.json({ ok: true });
  });

  // ---- AI 功能檢查：聊天、語音合成、語音辨識、圖片生成各試一次（約 NT$1）----
  A('post', '/selftest', async (req, res) => {
    if (config.mock) return res.json({ mock: true, results: [] });
    const { openai, tts, stt } = await import('./llm.js');
    const results = [];
    const run = async (name, model, fn) => {
      const t0 = Date.now();
      try { const extra = await fn(); results.push({ name, model, ok: true, ms: Date.now() - t0, ...extra }); }
      catch (e) { results.push({ name, model, ok: false, ms: Date.now() - t0, error: `${e.status ? e.status + ' ' : ''}${e.message}`.slice(0, 300) }); }
    };
    await run('聊天', config.modelCheap, async () => {
      const r = await openai.responses.create({ model: config.modelCheap, input: '用一句繁體中文打招呼', store: false });
      return { sample: String(r.output_text || '').slice(0, 60) };
    });
    let mp3 = null;
    await run('語音合成', config.ttsModel, async () => {
      mp3 = await tts({ userId: null, text: '你好，今天辛苦了，晚上早點休息。', voice: 'cedar', instructions: '台灣口音的中文，溫柔' });
      return { audio: `data:audio/mpeg;base64,${mp3.toString('base64')}` };
    });
    await run('語音辨識', config.sttModel, async () => {
      if (!mp3) throw new Error('語音合成失敗，沒有聲音可以辨識');
      return { sample: await stt({ userId: null, buffer: mp3, filename: 'test.mp3', durationSec: 3 }) };
    });
    await run('圖片生成', config.imageModel, async () => {
      const r = await openai.images.generate({ model: config.imageModel, size: '1024x1024', quality: 'low', output_format: 'jpeg', n: 1, prompt: 'A cup of latte on a wooden cafe table, natural light, realistic photo. No people, no text.' });
      db.prepare('INSERT INTO usage (user_id,kind,model,units,created_at) VALUES (?,?,?,?,?)').run(null, 'image', config.imageModel, 1, now());
      const b64 = r.data?.[0]?.b64_json;
      if (!b64) throw new Error('沒有拿到圖片');
      return { image: `data:image/jpeg;base64,${b64}` };
    });
    res.json({ results });
  });

  // ---- 角色人像 ----
  // 後台的 <img> 帶不了權杖：用權杖簽一個網址
  const sign = (id) => crypto.createHmac('sha256', config.adminToken || 'x').update(String(id)).digest('hex').slice(0, 20);
  app.get('/api/admin/pf/:id', (req, res) => {
    if (!config.adminToken || req.query.t !== sign(req.params.id)) return res.status(403).end();
    const ph = db.prepare('SELECT * FROM char_photos WHERE id=?').get(Number(req.params.id));
    const f = ph && portraitFile(ph, 'c');
    if (!f || !fs.existsSync(f)) return res.status(404).end();
    res.sendFile(f);
  });
  const jobs = { running: false, done: 0, total: 0, note: '' };
  async function runPortraitJob(list, what) {
    if (jobs.running) return false;
    Object.assign(jobs, { running: true, done: 0, total: list.length, note: { life: '生活照', restyle: '換新畫風' }[what] || '主照' });
    (async () => {
      for (const t of list) {
        const frame = j(t.data, {});
        try {
          if (what === 'restyle') {
            // 換畫風：舊照片全部隱藏，重做主照（插畫）和生活照（不露臉）
            db.prepare('UPDATE char_photos SET hidden=1 WHERE owner=?').run(t.id);
            await makeMain(t.id, frame, { force: true }); await makeLife(t.id, frame);
          } else if (what === 'regen') await makeMain(t.id, frame, { force: true });
          else if (what === 'main') await makeMain(t.id, frame);
          else { if (!mainOf(t.id)) await makeMain(t.id, frame); await makeLife(t.id, frame); }
        } catch (e) { jobs.note = `有失敗：${e.message}`; }
        jobs.done++;
      }
      jobs.running = false;
    })();
    return true;
  }
  A('get', '/portraits', (req, res) => {
    const list = db.prepare(`SELECT id, data, status FROM templates WHERE kind='official' ORDER BY created_at, id`).all().map(t => {
      const f = j(t.data, {});
      const ph = photosOf(t.id);
      return { id: t.id, name: f.name, gender: f.gender, jobLabel: f.jobLabel, status: t.status,
        photos: ph.map(p => ({ id: p.id, kind: p.kind, caption: p.caption, minStage: p.min_stage, paid: !!p.paid, url: `/api/admin/pf/${p.id}?t=${sign(p.id)}` })) };
    });
    res.json({ list, job: jobs, mock: config.mock, lifeCount: LIFE_COUNT, perImageTwd: Math.round(config.price.imageHigh * config.price.usdToTwd * 10) / 10 });
  });
  A('post', '/portraits/:id', async (req, res) => {
    const t = db.prepare(`SELECT id, data FROM templates WHERE id=?`).get(req.params.id);
    if (!t) return res.status(404).json({ error: '找不到' });
    if (config.mock) return res.status(400).json({ error: '測試模式（沒有 OpenAI 金鑰）不能生成' });
    const ok = await runPortraitJob([t], ['main', 'regen', 'life', 'restyle'].includes(req.body?.what) ? req.body.what : 'main');
    res.json(ok ? { ok: true } : { error: '還有其他照片在生成中，等一下再試' });
  });
  A('post', '/portraits-all', async (req, res) => {
    if (config.mock) return res.status(400).json({ error: '測試模式（沒有 OpenAI 金鑰）不能生成' });
    const what = ['life', 'restyle'].includes(req.body?.what) ? req.body.what : 'main';
    const list = db.prepare(`SELECT id, data FROM templates WHERE kind='official' AND status='published'`).all()
      .filter(t => what === 'restyle' ? true : what === 'main' ? !mainOf(t.id) : photosOf(t.id).filter(p => p.kind === 'life').length < LIFE_COUNT);
    if (!list.length) return res.json({ ok: true, count: 0 });
    const ok = await runPortraitJob(list, what);
    res.json(ok ? { ok: true, count: list.length } : { error: '還有其他照片在生成中' });
  });
  A('post', '/portrait-photos/:id/hide', (req, res) => {
    db.prepare('UPDATE char_photos SET hidden=1 WHERE id=?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- 官方角色：新增、上下架 ----
  A('get', '/officials/options', (req, res) => res.json({
    jobs: Object.entries(JOBS).map(([k, v]) => ({ id: k, label: v.label })),
    archetypes: Object.entries(ARCHETYPES).map(([k, v]) => ({ id: k, label: v.label, for: v.for || 'any' })),
    categories: CATEGORIES, voices: VOICES, proactivity: Object.entries(PROACTIVITY).map(([k, v]) => ({ id: k, label: v.label })),
  }));
  A('post', '/officials', (req, res) => {
    const b = req.body || {};
    const str = (k, n = 120) => String(b[k] ?? '').trim().slice(0, n);
    const gender = b.gender === 'female' ? 'female' : 'male';
    if (!str('name', 12)) return res.status(400).json({ error: '請填名字' });
    if (!JOBS[b.job]) return res.status(400).json({ error: '請選職業' });
    if (!ARCHETYPES[b.archetype]) return res.status(400).json({ error: '請選個性類型' });
    const voices = VOICES[gender].map(v => v.id);
    const lines = (k) => String(b[k] || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 6);
    const hairs = gender === 'female' ? ['long', 'wavy', 'bob', 'ponytail'] : ['short', 'curly', 'side', 'part'];
    const pick = (a) => a[crypto.randomInt(a.length)];
    const o = {
      id: `off_${crypto.randomBytes(4).toString('hex')}`, name: str('name', 12), gender, age: Math.max(20, Math.min(45, Number(b.age) || 27)),
      nationality: str('nationality', 10) || '台灣', job: b.job, archetype: b.archetype,
      proactivity: PROACTIVITY[b.proactivity] ? b.proactivity : 'slow', voice: voices.includes(b.voice) ? b.voice : voices[0], hue: crypto.randomInt(360),
      appearance: str('appearance'), traits: str('traits'), values: str('values'), weekend: str('weekend'), intro: str('intro'),
      signature: str('signature', 30), catchphrases: lines('catchphrases'), threads: lines('threads'),
      cats: (Array.isArray(b.cats) ? b.cats : []).filter(c => CATEGORIES.some(x => x.id === c)), home: str('home', 20) || '台北市', birthday: /^\d{2}-\d{2}$/.test(b.birthday || '') ? b.birthday : null,
      look: { hair: pick(hairs), hairColor: pick(['#2B2125', '#3A2A22', '#6B4A32', '#1F1D24']), skin: pick(['#F2CBA8', '#EEC6A2', '#F4D0B0', '#E9BD96']), top: pick(['#F4EBDD', '#E9EEF5', '#6FA8A1', '#3B3A44', '#F2A7C3']), accessory: 'collar', accent: '#C9A86A' },
    };
    if (!o.intro || !o.traits) return res.status(400).json({ error: '請填一句介紹和核心性格' });
    db.prepare(`INSERT INTO templates (id,kind,data,creator_name,created_at) VALUES (?,?,?,?,?)`).run(o.id, 'official', JSON.stringify(frameFromOfficial(o)), '官方', now());
    res.json({ ok: true, id: o.id });
  });
  A('post', '/officials/:id/status', (req, res) => {
    const s = req.body?.status === 'hidden' ? 'hidden' : 'published';
    db.prepare(`UPDATE templates SET status=? WHERE id=? AND kind='official'`).run(s, req.params.id);
    res.json({ ok: true });
  });
}
