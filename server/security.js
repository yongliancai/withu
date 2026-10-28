// 安全防護：安全標頭、防暴力猜測（登入碼、後台權杖）、後台 IP 白名單。
import crypto from 'node:crypto';
import { config } from './config.js';
import { logIssue } from './logger.js';

// ---------- 安全標頭 ----------
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.publicUrl.startsWith('https')) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  // 只能載入自己網站的程式；字型來自 Google Fonts；照片可能來自圖庫網站
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
}

// ---------- 限流：同一個 IP 在一段時間內最多幾次 ----------
const buckets = new Map();
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 10 * 60000).unref();
export function hit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n++;
  return { over: b.n > max, retrySec: Math.ceil((b.reset - t) / 1000) };
}
export function rateLimit(name, max, windowMs, message = '嘗試太多次了，請過一段時間再試') {
  return (req, res, next) => {
    const r = hit(`${name}|${req.ip}`, max, windowMs);
    if (r.over) {
      if (r.retrySec * 1000 > windowMs - 2000) logIssue({ level: 'warn', source: 'security', message: `「${name}」嘗試次數過多，已暫時擋下`, detail: { ip: req.ip, path: req.path } });
      res.setHeader('Retry-After', String(r.retrySec));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// ---------- 後台 ----------
const adminIps = (process.env.ADMIN_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
export function isAdminRequest(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  return !!config.adminToken && safeEq(token, config.adminToken);
}
/** 所有 /api/admin 的請求先經過這裡：IP 白名單（有設定的話）、權杖比對、猜錯太多次就暫停。 */
export function adminGuard(req, res, next) {
  if (adminIps.length && !adminIps.includes(req.ip)) {
    logIssue({ level: 'warn', source: 'security', message: '不在白名單的 IP 想進後台', detail: { ip: req.ip, path: req.path } });
    return res.status(403).json({ error: '這個網路不能使用後台' });
  }
  if (req.path.startsWith('/pf/')) return next(); // 後台的照片網址另外用簽名驗證
  const blocked = buckets.get(`adminfail|${req.ip}`);
  if (blocked && blocked.n >= 10 && blocked.reset > Date.now()) return res.status(429).json({ error: '權杖錯誤太多次，請 15 分鐘後再試' });
  if (!isAdminRequest(req)) {
    const r = hit(`adminfail|${req.ip}`, 10, 15 * 60000);
    if (r.over) logIssue({ level: 'warn', source: 'security', message: '後台權杖錯誤太多次，已暫時擋下', detail: { ip: req.ip } });
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
export const adminIpList = () => adminIps;
