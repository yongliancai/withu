// 每日備份：資料庫（線上安全備份，不用停機）＋使用者上傳的照片、語音、角色人像。
//
//   node scripts/backup.js              → 備份到 data/backups/，保留最近 14 份
//   BACKUP_DIR=/某個路徑 node scripts/backup.js   → 備份到別的資料夾（例如另一顆硬碟、掛載的雲端硬碟）
//   BACKUP_KEEP=30                      → 保留幾份
//   BACKUP_RCLONE=gdrive:withu-backup   → 另外用 rclone 上傳一份到雲端（需要先在主機上設定好 rclone）
//
// 建議用 crontab 每天凌晨 4 點跑一次（見 docs/security.md）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const outDir = path.resolve(process.env.BACKUP_DIR || path.join(dataDir, 'backups'));
const keep = Number(process.env.BACKUP_KEEP) || 14;
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/\D/g, '').slice(0, 12); // 例如 202610281557
const dbOut = path.join(outDir, `companion-${stamp}.db`);
const db = new Database(path.join(dataDir, 'companion.db'), { readonly: true });
await db.backup(dbOut);
db.close();

// 照片、語音、角色人像、照片庫打包成一個檔
const dirs = ['uploads', 'audio', 'portraits', 'library'].filter(d => fs.existsSync(path.join(dataDir, d)));
const tarOut = path.join(outDir, `files-${stamp}.tar.gz`);
if (dirs.length) execFileSync('tar', ['-czf', tarOut, '-C', dataDir, ...dirs]);

// 只保留最近幾份
for (const prefix of ['companion-', 'files-']) {
  const list = fs.readdirSync(outDir).filter(f => f.startsWith(prefix)).sort();
  for (const f of list.slice(0, Math.max(0, list.length - keep))) fs.rmSync(path.join(outDir, f));
}

if (process.env.BACKUP_RCLONE) {
  execFileSync('rclone', ['copy', dbOut, process.env.BACKUP_RCLONE]);
  if (fs.existsSync(tarOut)) execFileSync('rclone', ['copy', tarOut, process.env.BACKUP_RCLONE]);
}
const size = (f) => fs.existsSync(f) ? `${(fs.statSync(f).size / 1048576).toFixed(1)} MB` : '—';
console.log(`備份完成：${dbOut}（${size(dbOut)}）、${tarOut}（${size(tarOut)}）${process.env.BACKUP_RCLONE ? '，已上傳到 ' + process.env.BACKUP_RCLONE : ''}`);
