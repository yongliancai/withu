// 管理員後台 API：邀請碼、測試者、角色廣場、流行新品、意見回饋、危機事件。
// 所有路由都需要 Authorization: Bearer <ADMIN_TOKEN>。
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, now, j } from './db.js';
import { allPacks, savePack, resetPack } from './styles.js';

db.exec(`
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  cohort TEXT NOT NULL,            -- f | m
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  item TEXT NOT NULL,
  note TEXT,
  source TEXT,
  until TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crisis_reviews (
  event_id INTEGER PRIMARY KEY,
  note TEXT,
  reviewed_at INTEGER NOT NULL
);
`);
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('disabled')) db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
}

/** Which cohort an invite code belongs to (env codes first, then codes made in the admin), or null. */
export function cohortForCode(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  if (config.inviteCodesM.includes(c)) return 'm';
  if (config.inviteCodesF.includes(c)) return 'f';
  const row = db.prepare('SELECT cohort FROM invite_codes WHERE code=? AND active=1').get(c);
  return row ? row.cohort : null;
}

export function activeTrends() {
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare(`SELECT brand, item, note, source, until FROM trends WHERE until IS NULL OR until='' OR until>=? ORDER BY id DESC LIMIT 12`).all(today);
}

const recoveryCode = () => Array.from(crypto.randomBytes(8)).map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('').replace(/(.{4})/, '$1-');

function adminAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!config.adminToken || token !== config.adminToken) return res.status(401).json({ error: 'unauthorized' });
  next();
}

export function mountAdmin(app) {
  const A = (method, path, fn) => app[method](`/api/admin${path}`, adminAuth, (req, res) => {
    try { fn(req, res); } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });
  const nickOf = (uid) => db.prepare('SELECT nickname, cohort FROM users WHERE id=?').get(uid) || {};

  // ---- 1. 邀請碼 ----
  A('get', '/invites', (req, res) => {
    const used = (code) => db.prepare('SELECT COUNT(*) n FROM users WHERE invite_code=?').get(code).n;
    const fromEnv = [
      ...config.inviteCodesF.map(code => ({ code, cohort: 'f' })),
      ...config.inviteCodesM.map(code => ({ code, cohort: 'm' })),
    ].map(c => ({ ...c, source: 'env', active: true, note: '寫在 .env 裡', uses: used(c.code) }));
    const fromDb = db.prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all()
      .map(c => ({ code: c.code, cohort: c.cohort, source: 'admin', active: !!c.active, note: c.note, uses: used(c.code), createdAt: c.created_at }));
    res.json([...fromEnv, ...fromDb]);
  });
  A('post', '/invites', (req, res) => {
    const code = String(req.body?.code || '').trim().slice(0, 40) || `WITHU-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const cohort = req.body?.cohort === 'm' ? 'm' : 'f';
    if (!/^[\w-]{4,40}$/.test(code)) return res.status(400).json({ error: '邀請碼只能用英數字、底線和連字號，4–40 字' });
    if (cohortForCode(code) || db.prepare('SELECT 1 FROM invite_codes WHERE code=?').get(code)) return res.status(400).json({ error: '這組邀請碼已經存在' });
    db.prepare('INSERT INTO invite_codes (code,cohort,note,created_at) VALUES (?,?,?,?)').run(code, cohort, String(req.body?.note || '').slice(0, 80), now());
    res.json({ ok: true, code });
  });
  A('patch', '/invites/:code', (req, res) => {
    db.prepare('UPDATE invite_codes SET active=? WHERE code=?').run(req.body?.active ? 1 : 0, req.params.code);
    res.json({ ok: true });
  });

  // ---- 4. 測試者 ----
  A('get', '/testers', (req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(u => ({
      id: u.id, nickname: u.nickname, cohort: u.cohort || 'f', seeks: u.seeks, gender: u.gender, invite: u.invite_code,
      createdAt: u.created_at, lastActiveAt: u.last_active_at, disabled: !!u.disabled,
      rels: db.prepare(`SELECT COUNT(*) n FROM relationships WHERE user_id=? AND status='active'`).get(u.id).n,
    }));
    res.json(rows);
  });
  A('post', '/testers/:id/disable', (req, res) => {
    const disabled = req.body?.disabled ? 1 : 0;
    db.prepare('UPDATE users SET disabled=? WHERE id=?').run(disabled, req.params.id);
    if (disabled) db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id); // 立即登出所有裝置
    res.json({ ok: true });
  });
  A('post', '/testers/:id/new-code', (req, res) => {
    const code = recoveryCode();
    const r = db.prepare('UPDATE users SET recovery_code=? WHERE id=?').run(code, req.params.id);
    if (!r.changes) return res.status(404).json({ error: '找不到這位測試者' });
    res.json({ ok: true, recoveryCode: code });
  });

  // ---- 2. 角色廣場 ----
  A('get', '/square', (req, res) => {
    const reports = db.prepare(`SELECT user_id, data, created_at FROM events WHERE name='report'`).all().map(r => ({ ...j(r.data, {}), by: nickOf(r.user_id).nickname, at: r.created_at }));
    const rows = db.prepare(`SELECT * FROM templates WHERE kind='shared' ORDER BY created_at DESC`).all().map(t => {
      const f = j(t.data, {});
      return { id: t.id, name: f.name, gender: f.gender, intro: f.intro, traits: f.traits, catchphrases: f.catchphrases, creator: t.creator_name,
        uses: t.uses, status: t.status, createdAt: t.created_at, reports: reports.filter(r => r.template === t.id).map(r => ({ reason: r.reason, by: r.by, at: r.at })) };
    });
    res.json(rows);
  });
  A('post', '/square/:id', (req, res) => {
    const status = req.body?.status === 'published' ? 'published' : 'hidden';
    db.prepare(`UPDATE templates SET status=?, reports=CASE WHEN ?='published' THEN 0 ELSE reports END WHERE id=? AND kind='shared'`).run(status, status, req.params.id);
    res.json({ ok: true });
  });

  // ---- 3. 流行新品 ----
  A('get', '/trends', (req, res) => res.json(db.prepare('SELECT * FROM trends ORDER BY id DESC').all()));
  A('post', '/trends', (req, res) => {
    const b = req.body || {};
    const brand = String(b.brand || '').trim().slice(0, 40), item = String(b.item || '').trim().slice(0, 60);
    if (!brand || !item) return res.status(400).json({ error: '品牌和品項都要填' });
    const until = /^\d{4}-\d{2}-\d{2}$/.test(b.until || '') ? b.until : null;
    db.prepare('INSERT INTO trends (brand,item,note,source,until,created_at) VALUES (?,?,?,?,?,?)')
      .run(brand, item, String(b.note || '').slice(0, 80), String(b.source || '').slice(0, 300), until, now());
    res.json({ ok: true });
  });
  A('delete', '/trends/:id', (req, res) => { db.prepare('DELETE FROM trends WHERE id=?').run(req.params.id); res.json({ ok: true }); });

  // ---- 官方角色設定（每週檢查後調整）----
  const EDITABLE = ['intro', 'traits', 'catchphrases', 'values', 'weekend', 'appearance', 'signature', 'threads'];
  // ---- 說話風格包 ----
  A('get', '/styles', (req, res) => res.json(allPacks()));
  A('post', '/styles/:key', (req, res) => {
    try {
      if (req.body?.reset) resetPack(req.params.key); else savePack(req.params.key, req.body || {});
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  A('get', '/officials', (req, res) => {
    res.json(db.prepare(`SELECT id, data, uses FROM templates WHERE kind='official' ORDER BY id`).all().map(t => {
      const f = j(t.data, {});
      return { id: t.id, uses: t.uses, name: f.name, gender: f.gender, jobLabel: f.jobLabel, archetype: f.archetype, ...Object.fromEntries(EDITABLE.map(k => [k, f[k]])) };
    }));
  });
  A('post', '/officials/:id', (req, res) => {
    const t = db.prepare(`SELECT data FROM templates WHERE id=? AND kind='official'`).get(req.params.id);
    if (!t) return res.status(404).json({ error: '找不到這個角色' });
    const f = j(t.data, {});
    const b = req.body || {};
    const patch = {};
    for (const k of EDITABLE) {
      if (!(k in b)) continue;
      patch[k] = Array.isArray(b[k]) ? b[k].map(x => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 6) : String(b[k] ?? '').slice(0, 200);
    }
    Object.assign(f, patch);
    db.prepare('UPDATE templates SET data=? WHERE id=?').run(JSON.stringify(f), req.params.id);
    // 可選：同步到還沒定型的角色（只改上面這些欄位，不動長出來的個性和記憶）
    let synced = 0;
    if (b.syncUnlocked) {
      for (const c of db.prepare('SELECT id, persona FROM characters WHERE template_id=? AND persona_locked=0').all(req.params.id)) {
        db.prepare('UPDATE characters SET persona=? WHERE id=?').run(JSON.stringify({ ...j(c.persona, {}), ...patch }), c.id);
        synced++;
      }
    }
    res.json({ ok: true, synced });
  });

  // ---- 系統紀錄 ----
  A('get', '/logs', (req, res) => {
    const where = [], args = [];
    if (['error', 'warn', 'report'].includes(req.query.level)) { where.push('level=?'); args.push(req.query.level); }
    if (req.query.source) { where.push('source=?'); args.push(String(req.query.source)); }
    if (req.query.status === 'open') where.push('resolved_at IS NULL');
    if (req.query.status === 'resolved') where.push('resolved_at IS NOT NULL');
    const rows = db.prepare(`SELECT * FROM logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`).all(...args);
    const counts = db.prepare(`SELECT level, COUNT(*) n FROM logs WHERE resolved_at IS NULL GROUP BY level`).all();
    const sources = db.prepare(`SELECT source, COUNT(*) n FROM logs WHERE created_at > ? GROUP BY source`).all(now() - 7 * 864e5);
    res.json({
      counts: Object.fromEntries(counts.map(c => [c.level, c.n])), sources,
      rows: rows.map(l => { const u = l.user_id ? nickOf(l.user_id) : {};
        const rel = l.rel_id && db.prepare('SELECT c.persona FROM relationships r JOIN characters c ON c.id=r.character_id WHERE r.id=?').get(l.rel_id);
        return { id: l.id, level: l.level, source: l.source, message: l.message, detail: j(l.detail, {}), nickname: u.nickname || null,
          character: rel ? j(rel.persona, {}).name : null, at: l.created_at, resolvedAt: l.resolved_at, note: l.note }; }),
    });
  });
  A('post', '/logs/:id', (req, res) => {
    db.prepare('UPDATE logs SET resolved_at=?, note=? WHERE id=?').run(req.body?.resolved === false ? null : now(), String(req.body?.note || '').slice(0, 300), req.params.id);
    res.json({ ok: true });
  });

  // ---- 5. 意見回饋 ----
  A('get', '/feedback', (req, res) => {
    res.json(db.prepare(`SELECT id, user_id, data, created_at FROM events WHERE name='feedback' ORDER BY id DESC LIMIT 300`).all()
      .map(r => { const u = nickOf(r.user_id); return { id: r.id, nickname: u.nickname || '（已刪除帳號）', cohort: u.cohort || 'f', text: j(r.data, {}).text || '', at: r.created_at }; }));
  });

  // ---- 6. 危機事件（只記時間與角色，不顯示對話內容）----
  A('get', '/crisis', (req, res) => {
    const rows = db.prepare(`SELECT e.id, e.user_id, e.data, e.created_at, cr.note, cr.reviewed_at FROM events e
      LEFT JOIN crisis_reviews cr ON cr.event_id=e.id WHERE e.name='crisis' ORDER BY e.id DESC LIMIT 300`).all();
    res.json(rows.map(r => {
      const d = j(r.data, {});
      const u = db.prepare('SELECT nickname, cohort, last_active_at FROM users WHERE id=?').get(r.user_id) || {};
      const rel = d.rel && db.prepare('SELECT c.persona FROM relationships r JOIN characters c ON c.id=r.character_id WHERE r.id=?').get(d.rel);
      return { id: r.id, nickname: u.nickname || '（已刪除帳號）', cohort: u.cohort || 'f', character: rel ? j(rel.persona, {}).name : '',
        at: r.created_at, lastActiveAt: u.last_active_at, note: r.note, reviewedAt: r.reviewed_at };
    }));
  });
  A('post', '/crisis/:id', (req, res) => {
    db.prepare('INSERT INTO crisis_reviews (event_id,note,reviewed_at) VALUES (?,?,?) ON CONFLICT(event_id) DO UPDATE SET note=excluded.note, reviewed_at=excluded.reviewed_at')
      .run(Number(req.params.id), String(req.body?.note || '').slice(0, 300), now());
    res.json({ ok: true });
  });
}
