// 自動待修清單：把系統紀錄裡沒解決的錯誤，依「同一種問題」歸類計數；
// 有設定 GITHUB_ISSUES_TOKEN + GITHUB_REPO 時，每種新問題自動開一個 GitHub Issue（標籤 auto-bug），
// 讓排程的 Claude 任務去查程式、開修正 PR，再由你確認後部署。
// Issue 裡只放錯誤訊息、程式堆疊、發生在哪個畫面和次數，不放任何使用者資料或聊天內容。
import { db, now, j } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS bug_issues (
  sig TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  sample TEXT,                 -- JSON：堆疊、畫面、版本（已去識別化）
  issue_number INTEGER,
  issue_url TEXT,
  reported_count INTEGER NOT NULL DEFAULT 0
)`);
// 修好了：Issue 被關掉（PR 寫 Fixes #N，合併後 GitHub 會自動關）→ 這裡記下來，相關的系統紀錄也標成已處理
for (const [col, def] of [['closed_at', 'INTEGER'], ['count_at_close', 'INTEGER']]) {
  try { db.exec(`ALTER TABLE bug_issues ADD COLUMN ${col} ${def}`); } catch { /* 已經有了 */ }
}
db.exec(`CREATE TABLE IF NOT EXISTS bug_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`);

const env = process.env;
const repo = () => (env.GITHUB_REPO || '').trim();             // 例如 yongliancai/withu
const token = () => (env.GITHUB_ISSUES_TOKEN || '').trim();
export const githubEnabled = () => !!(repo() && token() && /^[\w.-]+\/[\w.-]+$/.test(repo()));

// 這些不是程式錯誤：使用者回報、安全警告、預算、已自動修正
const SKIP_SOURCES = new Set(['user', 'security', 'budget', 'review']);

// 同一種問題：把數字、id、網址參數拿掉
const norm = (s) => String(s || '').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '(email)').replace(/sk-[\w-]+/g, '(key)').replace(/[\w-]{16,}/g, ':id').replace(/\d+(\.\d+)?/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 160);
// 堆疊裡只留檔名和行號，去掉主機路徑
const cleanStack = (s) => String(s || '').replace(/https?:\/\/[^/\s)]+/g, '').replace(/\/home\/[^\s):]+\/(server|public)\//g, '$1/').replace(/[\w-]{20,}/g, ':id').slice(0, 1500);

const GUESS = {
  client: 'public/app.js（前端）', llm: 'server/llm.js、server/engine.js', tts: 'server/index.js（語音）、server/llm.js', stt: 'server/index.js（語音）、server/llm.js',
  scheduler: 'server/scheduler.js', push: 'server/push.js', photos: 'server/portraits.js、server/photos.js', server: 'server/index.js', memory: 'server/memory.js',
};

function scanLogs() {
  const lastId = db.prepare(`SELECT v FROM bug_meta WHERE k='last_log_id'`).get()?.v || 0;
  const rows = db.prepare(`SELECT id, source, message, detail, created_at FROM logs WHERE id>? AND level='error' AND resolved_at IS NULL AND created_at>? ORDER BY id`).all(lastId, now() - 7 * 86400000);
  const up = db.prepare(`INSERT INTO bug_issues (sig, source, title, count, first_at, last_at, sample) VALUES (?,?,?,1,?,?,?)
    ON CONFLICT(sig) DO UPDATE SET count=count+1, last_at=excluded.last_at, sample=COALESCE(sample, excluded.sample)`);
  let maxId = lastId;
  for (const r of rows) {
    if (SKIP_SOURCES.has(r.source)) continue;
    const d = j(r.detail, {});
    const sig = `${r.source}|${norm(r.message)}`;
    const sample = JSON.stringify({ stack: cleanStack(d.stack || d.error?.stack), route: String(d.url || d.route || d.info?.route || '').replace(/[\w-]{16,}/g, ':id').slice(0, 80), version: d.appVersion || null, kind: d.kind || null, check: d.check || null, status: d.status || d.info?.status || null, path: d.path || null, ua: d.ua ? String(d.ua).replace(/\([^)]*\)/g, '').slice(0, 80) : null });
    up.run(sig, r.source, norm(r.message), r.created_at, r.created_at, sample);
  }
  for (const r of rows) maxId = Math.max(maxId, r.id);
  db.prepare(`INSERT INTO bug_meta (k,v) VALUES ('last_log_id',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`).run(maxId);
  return rows.length;
}

const tw = (t) => new Date(t).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

function issueBody(b) {
  const s = j(b.sample, {});
  return [
    `**自動回報的問題**（伴旅後台 bugwatch）`,
    '',
    `- 來源：\`${b.source}\`${s.kind ? `（${s.kind}）` : ''}`,
    `- 次數：${b.count}（${tw(b.first_at)} ～ ${tw(b.last_at)}）`,
    s.route ? `- 畫面：\`${s.route}\`` : null,
    s.path ? `- API：\`${s.path}\`` : null,
    s.status ? `- HTTP 狀態：${s.status}` : null,
    s.version ? `- App 版本：${s.version}` : null,
    s.ua ? `- 瀏覽器：${s.ua}` : null,
    `- 可能相關的檔案：${GUESS[b.source] || 'server/'}`,
    '',
    '```',
    `${b.title}`,
    s.stack || '（沒有堆疊）',
    '```',
    '',
    '修正方式：在 `withu` repo 找出原因，開一個修正 PR（不要直接推 main），PR 說明寫清楚原因和怎麼驗證。部署前由維護者確認。',
    '',
    '_這個 Issue 不含任何使用者資料或聊天內容。_',
  ].filter(x => x != null).join('\n');
}

async function gh(path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(`https://api.github.com/repos/${repo()}${path}`, {
    method, headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'withu-bugwatch' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${r.status}：${data.message || ''}`);
  return data;
}

// 把這一種問題的系統紀錄標成已處理（後台「系統紀錄」就不會再顯示成待處理）
function resolveLogs(b, note) {
  const rows = db.prepare(`SELECT id, message FROM logs WHERE level='error' AND resolved_at IS NULL AND source=? AND created_at<=?`).all(b.source, now());
  const ids = rows.filter(r => norm(r.message) === b.title).map(r => r.id);
  const upd = db.prepare('UPDATE logs SET resolved_at=?, note=COALESCE(note, ?) WHERE id=?');
  for (const id of ids) upd.run(now(), note, id);
  return ids.length;
}

// 修好之後又發生：至少 6 小時後（留時間部署）又出現 3 次以上，才算「沒修好」
const REGRESS_AFTER = 6 * 3600e3, REGRESS_MIN = 3;

/** 跟 GitHub 對一次：關掉的 Issue → 標成已修好；修好後又一直發生 → 重新打開並留言。 */
async function syncClosed(out) {
  const open = db.prepare('SELECT * FROM bug_issues WHERE issue_number IS NOT NULL AND closed_at IS NULL ORDER BY last_at DESC LIMIT 30').all();
  for (const b of open) {
    const is = await gh(`/issues/${b.issue_number}`);
    if (is.state !== 'closed') continue;
    const at = is.closed_at ? Date.parse(is.closed_at) : now();
    db.prepare('UPDATE bug_issues SET closed_at=?, count_at_close=count, reported_count=count WHERE sig=?').run(at, b.sig);
    resolveLogs(b, `已修好（GitHub #${b.issue_number}）`);
    out.closed++;
  }
  const back = db.prepare(`SELECT * FROM bug_issues WHERE closed_at IS NOT NULL AND count - COALESCE(count_at_close, count) >= ? AND last_at > closed_at + ? LIMIT 5`).all(REGRESS_MIN, REGRESS_AFTER);
  for (const b of back) {
    await gh(`/issues/${b.issue_number}`, { state: 'open' }, 'PATCH');
    await gh(`/issues/${b.issue_number}/comments`, { body: `修好後又發生了：關閉之後又出現 ${b.count - b.count_at_close} 次，最近一次 ${tw(b.last_at)}。可能沒有修到根本原因，或修正還沒部署。` });
    db.prepare('UPDATE bug_issues SET closed_at=NULL, count_at_close=NULL, reported_count=count WHERE sig=?').run(b.sig);
    out.reopened++;
  }
}

/** 整理一次：掃系統紀錄 → 歸類 → 新問題開 Issue、變多很多的補留言。回傳摘要。 */
export async function runBugDigest({ maxNew = 5 } = {}) {
  const scanned = scanLogs();
  const out = { scanned, filed: 0, commented: 0, closed: 0, reopened: 0, error: null };
  if (!githubEnabled()) return out;
  try {
    const fresh = db.prepare(`SELECT * FROM bug_issues WHERE issue_number IS NULL ORDER BY count DESC LIMIT ?`).all(maxNew);
    for (const b of fresh) {
      const issue = { title: `[auto-bug] ${b.title}`.slice(0, 200), body: issueBody(b), labels: ['auto-bug', `src:${b.source}`] };
      // 權杖沒有建立標籤的權限時，改成不加標籤（標題的 [auto-bug] 一樣找得到）
      const r = await gh('/issues', issue).catch(e => (/ 422/.test(e.message) ? gh('/issues', { ...issue, labels: undefined }) : Promise.reject(e)));
      db.prepare('UPDATE bug_issues SET issue_number=?, issue_url=?, reported_count=? WHERE sig=?').run(r.number, r.html_url, b.count, b.sig);
      out.filed++;
    }
    await syncClosed(out);
    // 已經開過、還沒修好的：次數比上次回報多一倍以上（至少多 5 次）就補一則留言
    const grown = db.prepare(`SELECT * FROM bug_issues WHERE issue_number IS NOT NULL AND closed_at IS NULL AND count >= MAX(reported_count * 2, reported_count + 5) LIMIT 5`).all();
    for (const b of grown) {
      await gh(`/issues/${b.issue_number}/comments`, { body: `還在發生：目前共 ${b.count} 次，最近一次 ${tw(b.last_at)}。` });
      db.prepare('UPDATE bug_issues SET reported_count=? WHERE sig=?').run(b.count, b.sig);
      out.commented++;
    }
  } catch (e) { out.error = e.message; }
  return out;
}

export const bugList = () => db.prepare('SELECT sig, source, title, count, first_at, last_at, issue_number, issue_url, closed_at FROM bug_issues ORDER BY (closed_at IS NOT NULL), last_at DESC LIMIT 100').all();

/** 後台手動標成已處理（沒開 GitHub、或不是程式問題時用）；有 Issue 的話也一併關掉。 */
export async function closeBug(sig) {
  const b = db.prepare('SELECT * FROM bug_issues WHERE sig=?').get(sig);
  if (!b) return { error: '找不到' };
  if (b.issue_number && githubEnabled()) {
    try { await gh(`/issues/${b.issue_number}`, { state: 'closed', state_reason: 'completed' }, 'PATCH'); } catch (e) { return { error: e.message }; }
  }
  db.prepare('UPDATE bug_issues SET closed_at=?, count_at_close=count, reported_count=count WHERE sig=?').run(now(), sig);
  return { ok: true, resolved: resolveLogs(b, '後台標成已處理') };
}
