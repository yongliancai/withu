import path from 'node:path';
import fs from 'node:fs';

// Load .env from the project folder when present (CloudPanel / plain `npm start`).
// Variables already set in the environment (e.g. by Docker) take precedence.
const envFile = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  const before = { ...process.env };
  process.loadEnvFile(envFile);
  Object.assign(process.env, before);
}

const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(env.PORT, 3000),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  publicUrl: env.PUBLIC_URL || 'http://localhost:3000',
  // 女性向群組的邀請碼（INVITE_CODES 是舊名稱，仍然有效）與男性向群組的邀請碼
  inviteCodesF: (env.INVITE_CODES_F || env.INVITE_CODES || 'TEST2026').split(',').map(s => s.trim()).filter(Boolean),
  inviteCodesM: (env.INVITE_CODES_M || (env.OPENAI_API_KEY ? '' : 'TESTM2026')).split(',').map(s => s.trim()).filter(Boolean),
  adminToken: env.ADMIN_TOKEN || '',
  openaiKey: env.OPENAI_API_KEY || '',
  mock: env.MOCK_LLM === '1' || !env.OPENAI_API_KEY,
  modelCheap: env.MODEL_CHEAP || 'gpt-5.4-mini',
  modelGood: env.MODEL_GOOD || 'gpt-5.5',
  effortCheap: env.REASONING_CHEAP || 'none',
  effortGood: env.REASONING_GOOD || 'low',
  ttsModel: env.TTS_MODEL || 'gpt-4o-mini-tts',
  sttModel: env.STT_MODEL || 'gpt-4o-mini-transcribe',
  // USD per 1M tokens, used only for the admin cost estimate
  price: {
    cheapIn: num(env.PRICE_CHEAP_IN, 0.75), cheapCached: num(env.PRICE_CHEAP_CACHED, 0.075), cheapOut: num(env.PRICE_CHEAP_OUT, 4.5),
    goodIn: num(env.PRICE_GOOD_IN, 5), goodCached: num(env.PRICE_GOOD_CACHED, 0.5), goodOut: num(env.PRICE_GOOD_OUT, 30),
    ttsPerChar: num(env.PRICE_TTS_PER_1K_CHARS, 0.015) / 1000,
    sttPerMin: num(env.PRICE_STT_PER_MIN, 0.003),
    imageLow: num(env.PRICE_IMAGE_LOW, 0.02),     // 一張風景照（低畫質）
    imageHigh: num(env.PRICE_IMAGE_HIGH, 0.07),   // 一張角色人像（中畫質）
    usdToTwd: num(env.USD_TWD, 32),
  },
  // 每人每天的上限（控制費用）：他回你的次數、他看照片的張數
  dailyReplyCap: num(env.DAILY_REPLY_CAP, 150),
  dailyPhotoCap: num(env.DAILY_PHOTO_CAP, 20),
  pexelsKey: env.PEXELS_API_KEY || '',      // 照片庫來源一（2026/10 起暫停發新金鑰）
  pixabayKey: env.PIXABAY_API_KEY || '',    // 照片庫來源二（免費金鑰）
  imageModel: env.IMAGE_MODEL || 'gpt-image-2', // AI 生成照片用
  vapidPublic: env.VAPID_PUBLIC_KEY || '',
  vapidPrivate: env.VAPID_PRIVATE_KEY || '',
  vapidSubject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  orderMode: env.ORDER_MODE || 'redirect',   // redirect | api (api adapter not implemented until Uber approves)
  maxActive: num(env.MAX_ACTIVE_RELATIONSHIPS, 5),
  voiceDailyCap: num(env.VOICE_DAILY_CAP, 4),
  stageSpeed: num(env.STAGE_SPEED, 1),       // >1 makes relationships progress faster (for demos)
  schedulerMs: num(env.SCHEDULER_INTERVAL_MS, 60000),
  tz: 'Asia/Taipei',
};
