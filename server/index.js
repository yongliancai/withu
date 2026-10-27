import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, now, j, logEvent } from './db.js';
import { stt, jsonCall } from './llm.js';
import { JOBS, ARCHETYPES, PROACTIVITY, VOICES, SCENARIOS, AVATAR_HUES, charStatus, MOODS, CATEGORIES } from './characters.js';
import { STAGES } from './prompt.js';
import { id, runTurn, addMessage, getPersona, endRelationship, addStory, ta, startActivity, endActivity, STICKERS, milestone } from './engine.js';
import { presenceOf, replyDelayMs } from './presence.js';
import { crisisSignal } from './safety.js';
import { topicsFor, GAMES, ACTIVITIES, LEAD_REASON, EMOTIONS, pokeReason } from './topics.js';
import { seedOfficial, meet, sharePreview, publishShare, cleanupOrphans } from './meet.js';
import { startScheduler, tick } from './scheduler.js';
import { pushEnabled } from './push.js';
import { adminStats } from './admin.js';
import { logIssue, purgeOldLogs } from './logger.js';
import { mountAdmin, cohortForCode } from './adminRoutes.js';
import { memoirFor } from './memoir.js';
import { anniversariesFor } from './anniv.js';
import { prefsOf } from './prefs.js';
import { userStatus, createUserPost, userPostsOut, charStories, markStorySeen, mediaOwnedBy } from './social.js';
import { feedFor, likePost, commentPost } from './feed.js';
import { LIB_DIR, pickPhoto, photoById, fillLibrary, generatePhotos, photoSources, saveUpload, PHOTO_TAGS, photoCount } from './photos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

seedOfficial();
cleanupOrphans();
setInterval(cleanupOrphans, 10 * 60000);

// ---------- auth ----------
const COOKIE = { httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https'), maxAge: 400 * 864e5 };
function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)').run(token, userId, now());
  res.cookie('sid', token, COOKIE);
}
function auth(req, res, next) {
  const s = req.cookies.sid && db.prepare('SELECT user_id FROM sessions WHERE token=?').get(req.cookies.sid);
  const user = s && db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  if (!user) return res.status(401).json({ error: '請先加入' });
  if (user.disabled) return res.status(401).json({ error: '這個帳號已停用，有問題請聯絡測試負責人' });
  req.user = user;
  db.prepare('UPDATE users SET last_active_at=? WHERE id=?').run(now(), user.id);
  next();
}
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  logIssue({ source: 'server', message: `${req.method} ${req.route?.path || req.path}：${e.message}`, error: e,
    detail: { path: req.originalUrl.replace(/[?].*/, '') }, userId: req.user?.id, relId: req.params?.id });
  if (e?.status === 429 || e?.code === 'credit_balance_exhausted') {
    return res.status(503).json({ error: e?.code === 'credit_balance_exhausted' || e?.type === 'insufficient_quota'
      ? '對方現在沒辦法回覆（AI 服務額度不足），請稍後再試。' : '對方現在有點忙，等一下再試一次。' });
  }
  res.status(500).json({ error: '出了點問題，稍後再試一次。' });
});

const recoveryCode = () => Array.from(crypto.randomBytes(8)).map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('').replace(/(.{4})/, '$1-');

app.post('/api/auth/join', (req, res) => {
  const { invite, nickname, callName, adult, aiAck, gender, seeks } = req.body || {};
  const code0 = String(invite || '').trim();
  const cohort = cohortForCode(code0);
  if (!cohort) return res.status(400).json({ error: '邀請碼不正確' });
  const g = ['female', 'male', 'other'].includes(gender) ? gender : null;
  const sk = ['male', 'female', 'any'].includes(seeks) ? seeks : (cohort === 'm' ? 'female' : 'male');
  if (!adult) return res.status(400).json({ error: '這個 App 只開放 18 歲以上使用' });
  if (!aiAck) return res.status(400).json({ error: '請確認你了解對方是 AI 角色' });
  const nick = String(nickname || '').trim().slice(0, 16);
  if (!nick) return res.status(400).json({ error: '請填暱稱' });
  const uid = id('u_');
  const code = recoveryCode();
  db.prepare('INSERT INTO users (id,nickname,call_name,recovery_code,invite_code,cohort,gender,seeks,settings,created_at,last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(uid, nick, String(callName || nick).trim().slice(0, 16), code, code0, cohort, g, sk, JSON.stringify({ dailyCap: 6, proactiveLevel: 'normal', dndStart: '23:30', dndEnd: '07:30', notifyPreview: 'full' }), now(), now());
  startSession(res, uid);
  logEvent(uid, 'join', { cohort });
  res.json({ ok: true, recoveryCode: code, cohort });
});

app.get('/api/auth/cohort', (req, res) => {
  const c = String(req.query.code || '').trim();
  res.json({ cohort: cohortForCode(c) });
});

app.post('/api/auth/recover', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const u = db.prepare('SELECT id, disabled FROM users WHERE recovery_code=?').get(code);
  if (!u) return res.status(400).json({ error: '找不到這組登入碼' });
  if (u.disabled) return res.status(400).json({ error: '這個帳號已停用，有問題請聯絡測試負責人' });
  startSession(res, u.id);
  res.json({ ok: true });
});

app.post('/api/auth/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(req.cookies.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

// ---------- me ----------
app.get('/api/me', auth, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, nickname: u.nickname, callName: u.call_name, recoveryCode: u.recovery_code, settings: j(u.settings, {}),
    cohort: u.cohort, gender: u.gender, seeks: u.seeks, bio: u.bio || '', prefs: prefsOf(u.id), avatar: u.avatar ? `/api/media/${u.avatar}` : null, status: userStatus(u),
    counts: { rels: db.prepare(`SELECT COUNT(*) n FROM relationships WHERE user_id=? AND status='active'`).get(u.id).n, posts: db.prepare('SELECT COUNT(*) n FROM user_posts WHERE user_id=? AND story=0').get(u.id).n },
    pushKey: pushEnabled() ? config.vapidPublic : null, mock: config.mock, orderMode: config.orderMode });
});

app.patch('/api/me', auth, (req, res) => {
  const b = req.body || {};
  const settings = { ...j(req.user.settings, {}), ...(b.settings || {}) };
  const allowed = ['dailyCap', 'proactiveLevel', 'dndStart', 'dndEnd', 'notifyPreview', 'lunchAt', 'dinnerAt', 'discreetNames', 'portraitStyle', 'showSuggestions', 'realisticDelay', 'notifyAsked', 'appTheme'];
  for (const k of Object.keys(settings)) if (!allowed.includes(k)) delete settings[k];
  const seeks = ['male', 'female', 'any'].includes(b.seeks) ? b.seeks : req.user.seeks;
  const gender = ['female', 'male', 'other'].includes(b.gender) ? b.gender : req.user.gender;
  db.prepare('UPDATE users SET nickname=?, call_name=?, settings=?, seeks=?, gender=?, bio=? WHERE id=?').run(
    String(b.nickname ?? req.user.nickname).slice(0, 16), String(b.callName ?? req.user.call_name).slice(0, 16), JSON.stringify(settings), seeks, gender,
    String(b.bio ?? req.user.bio ?? '').slice(0, 80), req.user.id);
  res.json({ ok: true });
});

// ---------- 你的主頁 ----------
app.post('/api/me/avatar', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '沒有收到照片' });
  const f = `${id('av_')}.jpg`;
  fs.writeFileSync(path.join(config.dataDir, 'uploads', f), req.file.buffer);
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(f, req.user.id);
  res.json({ avatar: `/api/media/${f}` });
});
app.delete('/api/me/prefs', auth, (req, res) => { db.prepare('UPDATE users SET prefs=NULL WHERE id=?').run(req.user.id); res.json({ ok: true }); });
app.post('/api/me/status', auth, (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 30);
  db.prepare('UPDATE users SET status_text=?, status_emoji=?, status_at=? WHERE id=?').run(text || null, text ? String(req.body?.emoji || '').slice(0, 4) : null, text ? now() : null, req.user.id);
  if (text) logEvent(req.user.id, 'user_status', {});
  res.json({ ok: true });
});
app.get('/api/me/posts', auth, (req, res) => res.json(userPostsOut(req.user.id)));
app.post('/api/me/posts', auth, upload.single('photo'), (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text && !req.file) return res.status(400).json({ error: '寫點什麼，或放一張照片' });
  let media = null;
  if (req.file) { media = `${id('up_')}.jpg`; fs.writeFileSync(path.join(config.dataDir, 'uploads', media), req.file.buffer); }
  let audience = req.body?.audience || 'all';
  if (audience !== 'all' && audience !== 'lover') audience = j(audience, []);
  res.json({ id: createUserPost(req.user, { story: req.body?.story === '1', text, media, audience }) });
});
app.delete('/api/me/posts/:id', auth, (req, res) => {
  db.prepare('DELETE FROM user_posts WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});
// 限時動態：你的＋他們的
app.get('/api/stories', auth, (req, res) => {
  res.json({ mine: userPostsOut(req.user.id, { stories: true }),
    chars: charStories(req.user.id).map(g => ({ relId: g.relId, frame: publicFrame(g.persona), items: g.items.map(i => ({ ...i, photo: i.photoId ? photoById(i.photoId) : null })) })) });
});
app.post('/api/stories/:id/seen', auth, (req, res) => { markStorySeen(req.user.id, Number(req.params.id)); res.json({ ok: true }); });

app.get('/api/me/export', auth, (req, res) => {
  const uid = req.user.id;
  const dump = {
    exported_at: new Date().toISOString(),
    user: { nickname: req.user.nickname, call_name: req.user.call_name, created_at: req.user.created_at, settings: j(req.user.settings) },
    characters: db.prepare('SELECT id, origin, persona, created_at FROM characters WHERE user_id=?').all(uid).map(c => ({ ...c, persona: j(c.persona) })),
    relationships: db.prepare('SELECT id, character_id, status, stage, mode, start_type, created_at, ended_at FROM relationships WHERE user_id=?').all(uid),
    messages: db.prepare('SELECT rel_id, sender, kind, text, media, created_at FROM messages WHERE user_id=? ORDER BY id').all(uid),
    memories: db.prepare('SELECT rel_id, kind, content, source, created_at FROM memories WHERE user_id=?').all(uid),
    story: db.prepare('SELECT rel_id, type, title, body, place, media, created_at FROM story WHERE user_id=?').all(uid),
    profile: { bio: req.user.bio || '', status: req.user.status_text || null, avatar: req.user.avatar || null, chat_preferences: j(req.user.prefs, null) },
    my_posts: db.prepare('SELECT story, text, media, audience, created_at FROM user_posts WHERE user_id=? ORDER BY id').all(uid),
    notes: db.prepare(`SELECT n.rel_id, n.author, n.text, n.done, n.created_at FROM notes n JOIN relationships r ON r.id=n.rel_id WHERE r.user_id=?`).all(uid),
    comments_on_their_posts: db.prepare(`SELECT c.text, c.sender, c.created_at FROM post_comments c JOIN posts p ON p.id=c.post_id JOIN relationships r ON r.id=p.rel_id WHERE r.user_id=?`).all(uid),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="my-data.json"');
  res.json(dump);
});

app.delete('/api/me', auth, (req, res) => {
  const uid = req.user.id;
  const files = [
    ...db.prepare('SELECT media FROM messages WHERE user_id=? AND media IS NOT NULL').all(uid).map(r => r.media),
    ...db.prepare('SELECT media FROM user_posts WHERE user_id=? AND media IS NOT NULL').all(uid).map(r => r.media),
    ...(req.user.avatar ? [req.user.avatar] : []),
  ];
  for (const f of files) for (const dir of ['uploads', 'audio']) fs.rmSync(path.join(config.dataDir, dir, path.basename(f)), { force: true });
  db.prepare('DELETE FROM templates WHERE creator_user_id=?').run(uid);
  db.prepare('DELETE FROM events WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM usage WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM messages WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM memories WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM story WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM logs WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM story_views WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM users WHERE id=?').run(uid); // cascades
  res.clearCookie('sid');
  res.json({ ok: true });
});

// ---------- meta, square, meeting ----------
// 版本：git commit（部署後就會變），沒有 git 時用啟動時間
import { execSync } from 'node:child_process';
const APP_VERSION = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return String(Date.now()); } })();
app.get('/api/version', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ v: APP_VERSION }); });

app.get('/api/meta', (req, res) => res.json({ jobs: JOBS, archetypes: ARCHETYPES, proactivity: PROACTIVITY, voices: VOICES, scenarios: SCENARIOS, hues: AVATAR_HUES, stages: STAGES, moods: MOODS, categories: CATEGORIES, emotions: EMOTIONS }));

const publicFrame = (f) => ({ name: f.name, gender: f.gender, age: f.age, nationality: f.nationality, jobLabel: f.jobLabel, job: f.job,
  archetype: f.archetype, archetypeLabel: ARCHETYPES[f.archetype]?.label, look: f.look, proactivity: f.proactivity, appearance: f.appearance,
  traits: f.traits, catchphrases: f.catchphrases, intro: f.intro, hue: f.hue, schedule: f.schedule, workplace: f.workplace, signature: f.signature, cats: f.cats || (f.style === 'anime' || f.look?.style === 'anime' ? ['anime'] : []), photo: f.photo || null,
  avatarPhoto: f.photo ? pickPhoto(f.photo, f.name) : null });

// Who she/he wants to meet (set at sign-up, changeable in 我).
const wanted = (user, frame) => user.seeks === 'any' || frame.gender === user.seeks;

app.get('/api/templates', auth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM templates WHERE status='published'
    AND id NOT IN (SELECT template_id FROM characters WHERE user_id=? AND template_id IS NOT NULL)
    ORDER BY kind='official' DESC, uses DESC, created_at DESC LIMIT 200`).all(req.user.id)
    .filter(t => wanted(req.user, j(t.data)));
  res.json(rows.map(t => ({ id: t.id, kind: t.kind, creator: t.creator_name, frame: publicFrame(j(t.data)) })));
});

app.post('/api/templates/:id/report', auth, (req, res) => {
  db.prepare('UPDATE templates SET reports=reports+1, status=CASE WHEN reports+1>=3 THEN \'hidden\' ELSE status END WHERE id=?').run(req.params.id);
  logEvent(req.user.id, 'report', { template: req.params.id, reason: String(req.body?.reason || '').slice(0, 200) });
  res.json({ ok: true });
});

// 拍照偶遇：看照片判斷是哪種地方（照片不保存）
app.post('/api/encounter/photo', auth, upload.single('photo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '沒有收到照片' });
  const ids = SCENARIOS.map(s => s.id);
  const r = await jsonCall({
    userId: req.user.id, kind: 'scene_photo', tier: 'cheap',
    instructions: `看這張照片是哪一種地方，從這些情境挑最接近的一個：${SCENARIOS.map(s => `${s.id}（${s.label}）`).join('、')}。place 用 10 字內描述你看到的地方（例如「有落地窗的咖啡廳」）。照片裡如果有人，不要描述人。只輸出 JSON。`,
    input: [{ role: 'user', content: [{ type: 'input_text', text: '這是哪裡？' }, { type: 'input_image', image_url: `data:${req.file.mimetype || 'image/jpeg'};base64,${req.file.buffer.toString('base64')}` }] }],
    schema: { type: 'object', additionalProperties: false, properties: { scenario: { type: 'string', enum: ids }, place: { type: 'string' } }, required: ['scenario', 'place'] },
    schemaName: 'scene_photo',
    mock: { scenario: ids[Math.floor(Math.random() * ids.length)], place: '看起來很舒服的地方' },
  });
  logEvent(req.user.id, 'encounter_photo', { scenario: r.scenario });
  res.json({ scenario: r.scenario, label: r.place });
}));

// 依心情認識：推薦適合此刻的人
app.get('/api/mood-picks', auth, (req, res) => {
  const mood = MOODS.find(m => m.id === req.query.mood);
  if (!mood) return res.status(400).json({ error: '沒有這個心情' });
  const all = db.prepare(`SELECT * FROM templates WHERE status='published'
    AND id NOT IN (SELECT template_id FROM characters WHERE user_id=? AND template_id IS NOT NULL)`).all(req.user.id)
    .map(t => ({ ...t, f: j(t.data) })).filter(t => wanted(req.user, t.f));
  let pool = all.filter(t => ARCHETYPES[t.f.archetype]?.moods?.includes(mood.id));
  if (pool.length < 2) pool = pool.concat(all.filter(t => !pool.includes(t)).slice(0, 3 - pool.length));
  const picks = pool.sort(() => Math.random() - 0.5).slice(0, 3).map(t => ({ id: t.id, kind: t.kind, creator: t.creator_name, frame: publicFrame(t.f) }));
  res.json({ mood, picks });
});

// 來場偶遇：given a scenario, suggest 2–3 people who might be there (and sometimes an old flame).
app.get('/api/encounter', auth, (req, res) => {
  const sc = SCENARIOS.find(s => s.id === req.query.scenario);
  const all = db.prepare(`SELECT * FROM templates WHERE status='published'
    AND id NOT IN (SELECT template_id FROM characters WHERE user_id=? AND template_id IS NOT NULL)`).all(req.user.id)
    .map(t => ({ ...t, f: j(t.data) })).filter(t => wanted(req.user, t.f));
  let pool = sc ? all.filter(t => sc.jobs.includes(t.f.job)) : all;
  if (pool.length < 3) pool = pool.concat(all.filter(t => !pool.includes(t)));
  const picks = pool.sort(() => Math.random() - 0.5).slice(0, 3).map(t => ({ id: t.id, kind: t.kind, creator: t.creator_name, frame: publicFrame(t.f) }));
  let reunion = null;
  const ended = db.prepare(`SELECT r.id, c.persona FROM relationships r JOIN characters c ON c.id=r.character_id WHERE r.user_id=? AND r.status='ended' AND r.blocked=0`).all(req.user.id);
  if (ended.length && Math.random() < 0.25) {
    const e = ended[Math.floor(Math.random() * ended.length)];
    reunion = { relId: e.id, frame: publicFrame(j(e.persona)) };
  }
  res.json({ picks, reunion });
});

app.post('/api/meet', auth, wrap(async (req, res) => {
  const r = await meet(req.user, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.json(r);
}));

// ---------- relationships ----------
function ownRel(req, res) {
  const rel = db.prepare('SELECT * FROM relationships WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!rel) { res.status(404).json({ error: '找不到' }); return null; }
  return rel;
}
function templateLook(tid) {
  const t = tid && db.prepare('SELECT data FROM templates WHERE id=?').get(tid);
  return t ? j(t.data, {}).look : undefined;
}
function relSummary(rel) {
  const p = getPersona(rel);
  const last = db.prepare(`SELECT * FROM messages WHERE rel_id=? AND kind != 'card' ORDER BY id DESC LIMIT 1`).get(rel.id);
  const unread = db.prepare(`SELECT COUNT(*) n FROM messages WHERE rel_id=? AND sender='char' AND id>?`).get(rel.id, rel.last_read_id).n;
  return {
    id: rel.id, status: rel.status, stage: rel.stage, stageLabel: STAGES[rel.stage], mode: rel.mode, pinned: !!rel.pinned, starred: !!rel.starred,
    outing: !!rel.outing_active, activity: j(rel.activity), theme: rel.theme || 'default', pendingReplyAt: rel.pending_reply_at || null, charReadId: rel.char_read_id || 0,
    presence: (() => { const pr = presenceOf(rel, p); return { code: pr.code, label: pr.label, lastSeen: pr.lastSeen || null }; })(), statusLine: rel.status_line, statusLineAt: rel.status_line_at, blocked: !!rel.blocked,
    startType: rel.start_type, origin: p._char.origin, canShare: p._char.origin === 'custom' && rel.user_msg_count >= 10,
    frame: publicFrame({ ...p, look: p.look || templateLook(p._char.template_id) }), voice: p.voice, now: charStatus(p).code,
    last: last ? { text: last.kind === 'voice' ? '［語音訊息］' : last.kind === 'photo' ? '［照片］' : last.kind === 'sticker' ? '［貼圖］' : last.text, at: last.created_at, sender: last.sender } : null,
    unread, endedAt: rel.ended_at, createdAt: rel.created_at,
    scenarioId: (() => { const sc = j(rel.scenario, {}); return sc.id || SCENARIOS.find(x => x.label === sc.label)?.id || null; })(),
  };
}

app.get('/api/rels', auth, (req, res) => {
  const rels = db.prepare(`SELECT * FROM relationships WHERE user_id=? ORDER BY COALESCE(last_char_msg_at, created_at) DESC`).all(req.user.id);
  res.json(rels.map(relSummary));
});

app.get('/api/rels/:id', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const settingMemories = db.prepare(`SELECT id, content FROM memories WHERE rel_id=? AND source='setting' ORDER BY id`).all(rel.id);
  res.json({ ...relSummary(rel), settingMemories });
});

const msgOut = (m) => ({ id: m.id, sender: m.sender, kind: m.kind, text: m.text, media: m.media ? `/api/media/${m.media}` : null,
  card: j(m.card), proactive: !!m.proactive, at: m.created_at, suggest: j(m.suggest) });

app.get('/api/rels/:id/messages', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const after = Number(req.query.after) || 0;
  const before = Number(req.query.before) || 0;
  let rows;
  if (after) rows = db.prepare('SELECT * FROM messages WHERE rel_id=? AND id>? ORDER BY id').all(rel.id, after);
  else if (before) rows = db.prepare('SELECT * FROM messages WHERE rel_id=? AND id<? ORDER BY id DESC LIMIT 40').all(rel.id, before).reverse();
  else rows = db.prepare('SELECT * FROM messages WHERE rel_id=? ORDER BY id DESC LIMIT 60').all(rel.id).reverse();
  res.json(rows.map(msgOut));
});

const busyRels = new Set();
app.post('/api/rels/:id/messages', auth, upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'voice', maxCount: 1 }]), wrap(async (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  if (rel.status !== 'active') return res.status(400).json({ error: '這段關係已經結束了' });
  if (busyRels.has(rel.id)) return res.status(429).json({ error: `${ta(getPersona(rel))}還在回上一則` });
  busyRels.add(rel.id);
  try {
    const before = db.prepare('SELECT MAX(id) m FROM messages WHERE rel_id=?').get(rel.id).m || 0;
    let text = String(req.body?.text || '').slice(0, 2000).trim();
    let imageMedia = null;
    const photo = req.files?.photo?.[0];
    const voice = req.files?.voice?.[0];
    if (photo) {
      imageMedia = `${id('p_')}.jpg`;
      fs.writeFileSync(path.join(config.dataDir, 'uploads', imageMedia), photo.buffer);
      addMessage(rel, 'user', 'photo', { text: text || null, media: imageMedia });
      addStory(rel, 'photo', { media: [imageMedia], body: text || null });
      logEvent(req.user.id, 'photo_share', { rel: rel.id });
    } else if (voice) {
      const ext = (voice.mimetype || '').includes('mp4') ? 'm4a' : 'webm';
      const media = `${id('v_')}.${ext}`;
      fs.writeFileSync(path.join(config.dataDir, 'audio', media), voice.buffer);
      text = await stt({ userId: req.user.id, buffer: voice.buffer, filename: `voice.${ext}`, durationSec: Number(req.body?.duration) || 0 });
      addMessage(rel, 'user', 'voice', { text, media });
      logEvent(req.user.id, 'voice_send', { rel: rel.id });
    } else if (req.body?.sticker) {
      const sid = String(req.body.sticker);
      if (!STICKERS[sid]) return res.status(400).json({ error: '沒有這張貼圖' });
      text = STICKERS[sid];
      addMessage(rel, 'user', 'sticker', { text, card: { id: sid } });
    } else {
      if (!text) return res.status(400).json({ error: '空白訊息' });
      const sr = Number(req.body?.storyRef) && db.prepare('SELECT text FROM posts WHERE id=? AND rel_id=?').get(Number(req.body.storyRef), rel.id);
      addMessage(rel, 'user', 'text', { text, card: sr ? { storyReply: (sr.text || '').slice(0, 30) } : null });
    }
    db.prepare('UPDATE relationships SET user_msg_count=user_msg_count+1, last_user_msg_at=?, unanswered=0, user_busy_until=NULL WHERE id=?').run(now(), rel.id);
    const out = await replyOrDefer(req.user, rel, { userText: text, imageMedia });
    const rows = db.prepare('SELECT * FROM messages WHERE rel_id=? AND id>? ORDER BY id').all(rel.id, before);
    res.json({ messages: rows.map(msgOut), ...out });
  } finally {
    busyRels.delete(rel.id);
  }
}));

// 他現在有空就馬上回；在忙或睡覺就排到之後（由排程送出，並推播通知）
async function replyOrDefer(user, rel, { userText = '', imageMedia = null, trigger = null, triggerKey = null }) {
  const fresh = db.prepare('SELECT * FROM relationships WHERE id=?').get(rel.id);
  const persona = getPersona(fresh);
  const settings = j(user.settings, {});
  if (fresh.pending_reply_at && !crisisSignal(userText)) return { pending: { at: fresh.pending_reply_at, presence: presenceOf(fresh, persona) } };
  const delay = replyDelayMs(fresh, persona, { crisis: crisisSignal(userText), settings });
  if (delay > 50000) {
    const at = now() + delay;
    db.prepare('UPDATE relationships SET pending_reply_at=? WHERE id=?').run(at, rel.id);
    if (trigger) db.prepare('INSERT INTO followups (rel_id,due_at,topic) VALUES (?,?,?)').run(rel.id, at, trigger.slice(0, 120));
    return { pending: { at, presence: presenceOf(fresh, persona) } };
  }
  await runTurn({ user, relId: rel.id, userText, imageMedia, trigger, triggerKey });
  return {};
}

// 記事本：你們一起的約定與清單
app.get('/api/rels/:id/notes', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  res.json(db.prepare('SELECT id, author, text, done, created_at at FROM notes WHERE rel_id=? ORDER BY done, id DESC').all(rel.id));
});
app.post('/api/rels/:id/notes', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const text = String(req.body?.text || '').trim().slice(0, 40);
  if (!text) return res.status(400).json({ error: '寫點什麼' });
  db.prepare('INSERT INTO notes (rel_id,author,text,created_at) VALUES (?,?,?,?)').run(rel.id, 'user', text, now());
  res.json({ ok: true });
});
app.patch('/api/rels/:id/notes/:nid', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  if (req.body?.delete) db.prepare('DELETE FROM notes WHERE id=? AND rel_id=?').run(req.params.nid, rel.id);
  else db.prepare('UPDATE notes SET done=? WHERE id=? AND rel_id=?').run(req.body?.done ? 1 : 0, req.params.nid, rel.id);
  res.json({ ok: true });
});
// 搜尋聊天紀錄
app.get('/api/rels/:id/search', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const q = String(req.query.q || '').trim().slice(0, 40);
  if (!q) return res.json([]);
  res.json(db.prepare(`SELECT id, sender, text, created_at at FROM messages WHERE rel_id=? AND kind IN ('text','voice') AND text LIKE ? ORDER BY id DESC LIMIT 50`)
    .all(rel.id, `%${q.replace(/[%_]/g, '')}%`));
});
// 相簿：這段關係裡的照片和明信片
app.get('/api/rels/:id/album', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  res.json(db.prepare(`SELECT * FROM story WHERE rel_id=? AND type IN ('photo','postcard') ORDER BY id DESC`).all(rel.id)
    .map(s => ({ id: s.id, type: s.type, body: s.body, place: s.place, at: s.created_at, photo: s.photo_id ? photoById(s.photo_id) : null, media: (j(s.media) || []).map(f => `/api/media/${f}`), scene: s.scene })));
});
// 聊天室主題
const THEMES = ['default', 'night', 'cafe', 'sea', 'sakura', 'forest'];
app.post('/api/rels/:id/theme', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const t = THEMES.includes(req.body?.theme) ? req.body.theme : 'default';
  db.prepare('UPDATE relationships SET theme=? WHERE id=?').run(t, rel.id);
  logEvent(req.user.id, 'theme', { theme: t });
  res.json({ ok: true });
});

// 話題錦囊
app.get('/api/rels/:id/topics', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  res.json(topicsFor(getPersona(rel)));
});

// 從話題錦囊發起：請他帶話題、玩遊戲、一起做事
app.post('/api/rels/:id/nudge', auth, wrap(async (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  if (rel.status !== 'active') return res.status(400).json({ error: '這段關係已經結束了' });
  if (busyRels.has(rel.id)) return res.status(429).json({ error: `${ta(getPersona(rel))}還在回上一則` });
  const { kind, id: itemId } = req.body || {};
  const persona = getPersona(rel);
  let reason, label, act = null;
  if (kind === 'lead') { reason = LEAD_REASON; label = `你請${persona.name}帶個話題`; }
  else if (kind === 'game') { const g = GAMES.find(x => x.id === itemId); if (!g) return res.status(400).json({ error: '沒有這個遊戲' }); reason = g.reason; label = `你約${persona.name}玩「${g.label}」`; }
  else if (kind === 'activity') {
    const a = ACTIVITIES.find(x => x.id === itemId); if (!a) return res.status(400).json({ error: '沒有這個活動' });
    if (rel.activity) return res.status(400).json({ error: '你們正在一起做別的事' });
    reason = a.reason; label = a.invite.replace('{N}', persona.name);
    if (a.id !== 'meal') act = { type: a.id, title: String(req.body?.title || '').slice(0, 30), minutes: a.minutes };
  } else return res.status(400).json({ error: '不支援' });
  busyRels.add(rel.id);
  try {
    const before = db.prepare('SELECT MAX(id) m FROM messages WHERE rel_id=?').get(rel.id).m || 0;
    addMessage(rel, 'system', 'card', { card: { type: 'nudge', text: label } });
    db.prepare('UPDATE relationships SET last_user_msg_at=?, unanswered=0 WHERE id=?').run(now(), rel.id);
    logEvent(req.user.id, 'nudge', { rel: rel.id, kind, item: itemId || null });
    const out = await replyOrDefer(req.user, rel, { trigger: reason, triggerKey: `nudge_${kind}` });
    if (act && !out.pending) startActivity(db.prepare('SELECT * FROM relationships WHERE id=?').get(rel.id), persona, act);
    const rows = db.prepare('SELECT * FROM messages WHERE rel_id=? AND id>? ORDER BY id').all(rel.id, before);
    res.json({ messages: rows.map(msgOut), ...out });
  } finally { busyRels.delete(rel.id); }
}));

// 出遊小插曲：選一個
app.post('/api/rels/:id/choice', auth, wrap(async (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const m = db.prepare(`SELECT * FROM messages WHERE id=? AND rel_id=? AND kind='card'`).get(Number(req.body?.msgId), rel.id);
  const card = m && j(m.card);
  if (!card || card.type !== 'choice' || card.chosen !== undefined) return res.status(400).json({ error: '已經選過了' });
  const opt = card.options[Number(req.body?.idx)];
  if (!opt) return res.status(400).json({ error: '選項不存在' });
  card.chosen = Number(req.body.idx);
  db.prepare('UPDATE messages SET card=? WHERE id=?').run(JSON.stringify(card), m.id);
  const before = db.prepare('SELECT MAX(id) m FROM messages WHERE rel_id=?').get(rel.id).m || 0;
  addMessage(rel, 'user', 'text', { text: opt });
  db.prepare('UPDATE relationships SET user_msg_count=user_msg_count+1, last_user_msg_at=?, unanswered=0 WHERE id=?').run(now(), rel.id);
  milestone(rel, `一起出門時，你們選了「${opt}」`.slice(0, 40));
  await runTurn({ user: req.user, relId: rel.id, userText: `（${card.prompt}）我選：${opt}` });
  res.json({ messages: db.prepare('SELECT * FROM messages WHERE rel_id=? AND id>? ORDER BY id').all(rel.id, before).map(msgOut) });
}));

// 一起完成的小目標
app.post('/api/rels/:id/goal', auth, wrap(async (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const m = db.prepare(`SELECT * FROM messages WHERE id=? AND rel_id=? AND kind='card'`).get(Number(req.body?.msgId), rel.id);
  const card = m && j(m.card);
  if (!card || card.type !== 'goal' || card.answered) return res.status(400).json({ error: '已經回覆過了' });
  const accept = !!req.body?.accept;
  card.answered = accept ? 'yes' : 'no';
  db.prepare('UPDATE messages SET card=? WHERE id=?').run(JSON.stringify(card), m.id);
  const before = db.prepare('SELECT MAX(id) m FROM messages WHERE rel_id=?').get(rel.id).m || 0;
  if (accept) {
    db.prepare('INSERT INTO goals (rel_id,title,days,created_at) VALUES (?,?,?,?)').run(rel.id, card.title, card.days, now());
    // 每隔一天晚上問一下，不施壓
    for (let d = 1; d <= card.days; d += 2) {
      const t = new Date(Date.now() + d * 864e5); const due = new Date(t.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }) + 'T21:30:00+08:00').getTime();
      db.prepare('INSERT INTO followups (rel_id,due_at,topic) VALUES (?,?,?)').run(rel.id, due, `你們一起在做「${card.title}」。輕鬆地問一句今天怎麼樣、分享你自己的狀況；做不到也沒關係，不要給壓力`);
    }
    logEvent(req.user.id, 'goal_start', { rel: rel.id });
  }
  addMessage(rel, 'user', 'text', { text: accept ? '好啊，一起試試看' : '先不要好了' });
  await runTurn({ user: req.user, relId: rel.id, userText: accept ? `（答應一起完成「${card.title}」）好啊，一起試試看` : '（先不要這個目標）先不要好了' });
  res.json({ messages: db.prepare('SELECT * FROM messages WHERE rel_id=? AND id>? ORDER BY id').all(rel.id, before).map(msgOut) });
}));
app.get('/api/rels/:id/goals', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  res.json(db.prepare(`SELECT * FROM goals WHERE rel_id=? ORDER BY status='active' DESC, id DESC LIMIT 10`).all(rel.id)
    .map(g => ({ id: g.id, title: g.title, days: g.days, done: j(g.done, []), status: g.status, at: g.created_at })));
});
app.post('/api/rels/:id/goals/:gid/done', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const g = db.prepare(`SELECT * FROM goals WHERE id=? AND rel_id=? AND status='active'`).get(req.params.gid, rel.id);
  if (!g) return res.status(404).json({ error: '找不到' });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const done = j(g.done, []);
  if (!done.includes(today)) done.push(today);
  const finished = done.length >= g.days;
  db.prepare('UPDATE goals SET done=?, status=?, ended_at=? WHERE id=?').run(JSON.stringify(done), finished ? 'done' : 'active', finished ? now() : null, g.id);
  if (finished) {
    milestone(rel, `你們一起完成了「${g.title}」`.slice(0, 40));
    db.prepare(`UPDATE followups SET done=1 WHERE rel_id=? AND done=0 AND topic LIKE ?`).run(rel.id, `%${g.title}%`);
  }
  res.json({ done: done.length, days: g.days, finished });
});

// 心情按鈕
app.post('/api/rels/:id/poke', auth, wrap(async (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  if (rel.status !== 'active') return res.status(400).json({ error: '這段關係已經結束了' });
  const e = EMOTIONS.find(x => x.id === req.body?.emotion);
  if (!e || (e.minStage || 0) > rel.stage) return res.status(400).json({ error: '沒有這個心情' });
  if (busyRels.has(rel.id)) return res.status(429).json({ error: `${ta(getPersona(rel))}還在回上一則` });
  const count = Math.max(1, Math.min(99, Number(req.body?.count) || 1));
  busyRels.add(rel.id);
  try {
    const before = db.prepare('SELECT MAX(id) m FROM messages WHERE rel_id=?').get(rel.id).m || 0;
    addMessage(rel, 'user', 'card', { text: `${e.emoji} ${e.label}${count > 1 ? ` ×${count}` : ''}`, card: { type: 'poke', emotion: e.id, emoji: e.emoji, label: e.label, count } });
    db.prepare('UPDATE relationships SET last_user_msg_at=?, unanswered=0 WHERE id=?').run(now(), rel.id);
    logEvent(req.user.id, 'poke', { rel: rel.id, emotion: e.id, count });
    const out = await replyOrDefer(req.user, rel, { trigger: pokeReason(e, count), triggerKey: 'nudge_poke' });
    const rows = db.prepare('SELECT * FROM messages WHERE rel_id=? AND id>? ORDER BY id').all(rel.id, before);
    res.json({ messages: rows.map(msgOut), ...out });
  } finally { busyRels.delete(rel.id); }
}));

// 結束一起做的事
app.post('/api/rels/:id/activity/end', auth, wrap(async (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const before = db.prepare('SELECT MAX(id) m FROM messages WHERE rel_id=?').get(rel.id).m || 0;
  await endActivity(rel, req.user, { reason: 'user' });
  res.json({ messages: db.prepare('SELECT * FROM messages WHERE rel_id=? AND id>? ORDER BY id').all(rel.id, before).map(msgOut) });
}));

// 使用者在聊天室回報問題（同意的話附上最近的對話，方便找原因）
app.post('/api/rels/:id/report-issue', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const text = String(req.body?.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: '寫一下發生了什麼' });
  const recent = req.body?.includeChat
    ? db.prepare(`SELECT id, sender, kind, text, card, proactive, reason, created_at FROM messages WHERE rel_id=? ORDER BY id DESC LIMIT 16`).all(rel.id).reverse()
      .map(m => ({ ...m, text: (m.text || '').slice(0, 300), card: m.card ? j(m.card, {}).type : null }))
    : null;
  const p = getPersona(rel);
  logIssue({ level: 'report', source: 'user', message: text, userId: req.user.id, relId: rel.id,
    detail: { character: p.name, stage: rel.stage, mode: rel.mode, recent, client: String(req.headers['user-agent'] || '').slice(0, 200) } });
  res.json({ ok: true });
});

// 手機端的程式錯誤
app.post('/api/client-log', (req, res) => {
  const s = req.cookies.sid && db.prepare('SELECT user_id FROM sessions WHERE token=?').get(req.cookies.sid);
  const b = req.body || {};
  logIssue({ level: 'error', source: 'client', message: String(b.message || 'client error').slice(0, 300), userId: s?.user_id,
    detail: { stack: String(b.stack || '').slice(0, 2000), url: String(b.url || '').slice(0, 200), ua: String(req.headers['user-agent'] || '').slice(0, 200), appVersion: b.v } });
  res.json({ ok: true });
});

// 舊版的一起散步已移除
app.post('/api/rels/:id/walk', auth, (req, res) => res.status(410).json({ error: '一起散步已經改成「一起做點什麼」，在聊天室左下角的話題錦囊裡' }));


// 角色個人頁（像 LINE）：封面、個性簽名、基本資料、生活動態
app.get('/api/rels/:id/profile', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const p = getPersona(rel);
  const posts = db.prepare('SELECT id, text, photo_id, created_at FROM posts WHERE rel_id=? ORDER BY id DESC LIMIT 30').all(rel.id)
    .map(x => ({ id: x.id, text: x.text, at: x.created_at, photo: x.photo_id ? photoById(x.photo_id) : null }));
  res.json({ ...relSummary(rel), signature: p.signature || '', signatureAt: p.signature_at || null,
    cover: JOBS[p.job]?.scene || 'city', weekend: p.weekend, values: p.values, posts });
});

app.post('/api/rels/:id/read', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  db.prepare('UPDATE relationships SET last_read_id=MAX(last_read_id, ?) WHERE id=?').run(Number(req.body?.lastId) || 0, rel.id);
  res.json({ ok: true });
});

app.patch('/api/rels/:id', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const b = req.body || {};
  if ('starred' in b) db.prepare('UPDATE relationships SET starred=? WHERE id=?').run(b.starred ? 1 : 0, rel.id);
  if ('mode' in b) {
    if (b.mode === 'real' && rel.stage < 1) return res.status(400).json({ error: '成為朋友之後才能開啟真實模式' });
    db.prepare('UPDATE relationships SET mode=? WHERE id=?').run(b.mode === 'real' ? 'real' : 'practice', rel.id);
    logEvent(req.user.id, 'mode', { rel: rel.id, mode: b.mode });
  }
  if ('pinned' in b) { db.prepare('UPDATE relationships SET pinned=? WHERE id=?').run(b.pinned && rel.stage >= 3 ? 1 : 0, rel.id); if (b.pinned && rel.stage >= 3) logEvent(req.user.id, 'pinned', { rel: rel.id }); }
  res.json({ ok: true });
});

app.post('/api/rels/:id/pin', auth, wrap(async (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const accept = !!req.body?.accept;
  db.prepare('UPDATE relationships SET pinned=? WHERE id=?').run(accept && rel.stage >= 3 ? 1 : 0, rel.id);
  if (accept && rel.stage >= 3) logEvent(req.user.id, 'pinned', { rel: rel.id });
  const msgId = Number(req.body?.msgId);
  if (msgId) db.prepare(`UPDATE messages SET card=json_set(card,'$.answered',?) WHERE id=? AND rel_id=?`).run(accept ? 'yes' : 'no', msgId, rel.id);
  addMessage(rel, 'user', 'text', { text: accept ? '好啊' : '先不要啦' });
  db.prepare('UPDATE relationships SET user_msg_count=user_msg_count+1, last_user_msg_at=?, unanswered=0 WHERE id=?').run(now(), rel.id);
  await runTurn({ user: req.user, relId: rel.id, userText: accept ? '（對方答應讓你當置頂）好啊' : '（對方說先不要置頂）先不要啦' });
  res.json({ ok: true });
}));

app.post('/api/rels/:id/end', auth, wrap(async (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  if (rel.status !== 'active') return res.json({ ok: true });
  await endRelationship(rel, getPersona(rel), req.user, 'user_choice');
  res.json({ ok: true });
}));

app.post('/api/rels/:id/block', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  db.prepare('UPDATE relationships SET blocked=? WHERE id=?').run(req.body?.blocked === false ? 0 : 1, rel.id);
  res.json({ ok: true });
});

// Permanently delete a relationship and everything in it.
app.delete('/api/rels/:id', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const files = db.prepare('SELECT media FROM messages WHERE rel_id=? AND media IS NOT NULL').all(rel.id).map(r => r.media);
  for (const f of files) for (const dir of ['uploads', 'audio']) fs.rmSync(path.join(config.dataDir, dir, path.basename(f)), { force: true });
  db.prepare('DELETE FROM characters WHERE id=?').run(rel.character_id); // cascades to relationship and its rows
  res.json({ ok: true });
});

app.put('/api/rels/:id/setting-memories', auth, (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 10) : [];
  db.prepare(`DELETE FROM memories WHERE rel_id=? AND source='setting'`).run(rel.id);
  const ins = db.prepare(`INSERT INTO memories (rel_id,user_id,kind,content,weight,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
  for (const t of items) { const c = String(t).trim().slice(0, 120); if (c) ins.run(rel.id, rel.user_id, 'fact', c, 3, 'setting', now(), now()); }
  res.json({ ok: true });
});

app.post('/api/rels/:id/share-preview', auth, wrap(async (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  res.json(await sharePreview(req.user, rel));
}));
app.post('/api/rels/:id/share', auth, wrap(async (req, res) => {
  const rel = ownRel(req, res); if (!rel) return;
  const r = await publishShare(req.user, rel, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.json(r);
}));

// ---------- meal card ----------
app.post('/api/meal/:msgId/choose', auth, (req, res) => {
  const m = db.prepare(`SELECT * FROM messages WHERE id=? AND user_id=? AND kind='card'`).get(req.params.msgId, req.user.id);
  if (!m) return res.status(404).json({ error: '找不到' });
  const card = j(m.card);
  const opt = card.options?.[Number(req.body?.idx)];
  if (!opt) return res.status(400).json({ error: '選項不存在' });
  card.chosen = opt.idx;
  db.prepare('UPDATE messages SET card=? WHERE id=?').run(JSON.stringify(card), m.id);
  const rel = db.prepare('SELECT * FROM relationships WHERE id=?').get(m.rel_id);
  db.prepare('UPDATE relationships SET meal_declined=0 WHERE id=?').run(rel.id);
  db.prepare('INSERT INTO followups (rel_id,due_at,topic) VALUES (?,?,?)').run(rel.id, now() + 45 * 60000, `對方選了你推薦的「${opt.store} ${opt.item}」，問對方到了沒、好不好吃`);
  logEvent(req.user.id, 'meal_choose', { rel: rel.id, store: opt.store, item: opt.item, trend: opt.is_trend });
  const firstMeal = db.prepare(`SELECT COUNT(*) n FROM events WHERE name='meal_choose' AND json_extract(data,'$.rel')=?`).get(rel.id).n === 1;
  if (firstMeal) {
    db.prepare('INSERT OR IGNORE INTO story (rel_id,user_id,type,title,created_at) VALUES (?,?,?,?,?)').run(rel.id, rel.user_id, 'milestone', `${ta(getPersona(rel))}第一次幫你點餐`, now());
  }
  res.json({ ok: true, url: opt.url });
});

app.post('/api/meal/:msgId/decline', auth, (req, res) => {
  const m = db.prepare(`SELECT * FROM messages WHERE id=? AND user_id=? AND kind='card'`).get(req.params.msgId, req.user.id);
  if (!m) return res.status(404).json({ error: '找不到' });
  const card = j(m.card); card.declined = true;
  db.prepare('UPDATE messages SET card=? WHERE id=?').run(JSON.stringify(card), m.id);
  db.prepare('UPDATE relationships SET meal_declined=meal_declined+1 WHERE id=?').run(m.rel_id);
  logEvent(req.user.id, 'meal_decline', { rel: m.rel_id });
  res.json({ ok: true });
});

// 即將到來的紀念日（聊天列表的小提醒用）
app.get('/api/anniversaries', auth, (req, res) => {
  const rels = db.prepare(`SELECT * FROM relationships WHERE user_id=? AND status='active' AND blocked=0`).all(req.user.id);
  res.json(rels.flatMap(rel => { const p = getPersona(rel); return anniversariesFor(rel, p, { within: 1 }).map(a => ({ ...a, relId: rel.id, name: p.name })); }));
});

// ---------- 動態牆 ----------
app.get('/api/feed', auth, (req, res) => {
  res.json(feedFor(req.user.id).map(({ persona, ...p }) => ({ ...p, frame: publicFrame(persona) })));
});
app.post('/api/feed/:id/like', auth, (req, res) => {
  const r = likePost(req.user.id, Number(req.params.id));
  if (!r) return res.status(404).json({ error: '找不到' });
  res.json(r);
});
app.post('/api/feed/:id/comment', auth, wrap(async (req, res) => {
  const r = await commentPost(req.user, Number(req.params.id), req.body?.text);
  if (!r) return res.status(400).json({ error: '留言不能空白' });
  res.json(r);
}));

// ---------- story ----------
app.get('/api/story', auth, (req, res) => {
  const rels = db.prepare(`SELECT * FROM relationships WHERE user_id=? ORDER BY created_at`).all(req.user.id);
  res.json(rels.map(rel => {
    const items = db.prepare('SELECT * FROM story WHERE rel_id=? ORDER BY created_at DESC').all(rel.id)
      .map(s => ({ id: s.id, type: s.type, title: s.title, body: s.body, place: s.place, scene: s.scene, photo: s.photo_id ? photoById(s.photo_id) : null, media: (j(s.media) || []).map(f => `/api/media/${f}`), at: s.created_at }));
    return { rel: relSummary(rel), items, memoir: memoirFor(rel, getPersona(rel)), anniversaries: rel.status === 'active' ? anniversariesFor(rel, getPersona(rel), { within: 120 }).slice(0, 8) : [] };
  }));
});

// ---------- media (only the owner can fetch) ----------
app.get('/api/media/:file', auth, (req, res) => {
  const f = path.basename(req.params.file);
  const own = db.prepare('SELECT 1 FROM messages WHERE user_id=? AND media=?').get(req.user.id, f)
    || db.prepare(`SELECT 1 FROM story WHERE user_id=? AND media LIKE ?`).get(req.user.id, `%${f}%`)
    || mediaOwnedBy(req.user.id, f);
  if (!own) return res.status(404).end();
  for (const dir of ['uploads', 'audio']) {
    const p = path.join(config.dataDir, dir, f);
    if (fs.existsSync(p)) { res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); return res.sendFile(p); }
  }
  res.status(404).end();
});

// ---------- push & analytics ----------
app.post('/api/push/subscribe', auth, (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'bad subscription' });
  db.prepare('INSERT OR REPLACE INTO push_subs (endpoint,user_id,sub) VALUES (?,?,?)').run(sub.endpoint, req.user.id, JSON.stringify(sub));
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', auth, (req, res) => {
  db.prepare('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').run(req.body?.endpoint || '', req.user.id);
  res.json({ ok: true });
});

const CLIENT_EVENTS = ['app_open', 'coming_soon_click', 'coming_soon_price', 'share_card', 'install_prompt', 'feedback'];
app.post('/api/events', auth, (req, res) => {
  const { name, data } = req.body || {};
  if (CLIENT_EVENTS.includes(name)) logEvent(req.user.id, name, data);
  res.json({ ok: true });
});

// ---------- admin ----------
app.get('/api/admin/stats', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!config.adminToken || token !== config.adminToken) return res.status(401).json({ error: 'unauthorized' });
  res.json(adminStats(['f', 'm'].includes(req.query.cohort) ? req.query.cohort : 'all'));
});
app.post('/api/admin/tick', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!config.adminToken || token !== config.adminToken) return res.status(401).json({ error: 'unauthorized' });
  tick().then(() => res.json({ ok: true }));
});

mountAdmin(app);
// 照片庫（後台）
const adminOk = (req) => config.adminToken && (req.headers.authorization || '') === `Bearer ${config.adminToken}`;
app.get('/api/admin/photos', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  const rows = db.prepare('SELECT * FROM photos WHERE hidden=0 ORDER BY tag, id DESC').all();
  res.json({ pexels: !!config.pexelsKey, sources: photoSources().map(([n]) => n), canGenerate: !config.mock, tags: Object.fromEntries(Object.entries(PHOTO_TAGS).map(([k, v]) => [k, v[0]])), counts: photoCount(),
    rows: rows.map(r => ({ id: r.id, tag: r.tag, thumb: r.thumb || r.url, credit: r.credit, source: r.source })) });
});
app.post('/api/admin/photos/generate', wrap(async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  const counts = photoCount();
  const tags = req.body?.tag ? [String(req.body.tag)] : Object.keys(PHOTO_TAGS).filter(t => (counts[t] || 0) < 3);
  if (!tags.length) return res.json({ ok: true, started: false, reason: '每個類別都已經有照片了' });
  const perTag = Math.min(6, Number(req.body?.perTag) || 3);
  // 一張要十幾秒，背景慢慢做；後台重新整理就看得到進度
  generatePhotos({ tags, perTag }).catch(e => logIssue({ level: 'warn', source: 'photos', message: `AI 生成照片中斷：${e.message}`, error: e }));
  res.json({ ok: true, started: true, images: tags.length * perTag });
}));
app.post('/api/admin/photos/fill', wrap(async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  fillLibrary({ force: !!req.body?.force }).catch(() => {});
  res.json({ ok: true, started: true });
}));
app.post('/api/admin/photos', upload.single('photo'), (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  const tag = String(req.body?.tag || '');
  if (!PHOTO_TAGS[tag] || !req.file) return res.status(400).json({ error: '請選類別和照片' });
  res.json({ id: saveUpload(tag, req.file.buffer, req.file.mimetype, String(req.body?.credit || '').slice(0, 40)) });
});
app.post('/api/admin/photos/:id/hide', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  db.prepare('UPDATE photos SET hidden=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
setTimeout(() => fillLibrary().catch(() => {}), 15000);
setInterval(() => fillLibrary().catch(() => {}), 7 * 864e5);
purgeOldLogs();
setInterval(purgeOldLogs, 864e5);
process.on('unhandledRejection', (e) => logIssue({ source: 'server', message: `未處理的錯誤：${e?.message || e}`, error: e instanceof Error ? e : undefined }));
process.on('uncaughtException', (e) => logIssue({ source: 'server', message: `程式崩潰：${e.message}`, error: e }));

// ---------- static PWA ----------
const pub = path.join(__dirname, '..', 'public');
app.use('/lib', express.static(LIB_DIR, { maxAge: '30d' }));
app.use(express.static(pub, {
  setHeaders(res, p) {
    if (p.endsWith('sw.js') || p.endsWith('.html') || p.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get(['/privacy', '/terms'], (req, res) => res.sendFile(path.join(pub, 'privacy.html')));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(pub, 'index.html')));

app.listen(config.port, () => {
  console.log(`companion listening on :${config.port}${config.mock ? ' (MOCK LLM — set OPENAI_API_KEY for real replies)' : ''}`);
  startScheduler();
});
