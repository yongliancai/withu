import OpenAI, { toFile } from 'openai';
import { config } from './config.js';
import { db, now } from './db.js';
import { logIssue } from './logger.js';

export const openai = config.mock ? null : new OpenAI({ apiKey: config.openaiKey });

function logUsage(userId, kind, model, usage, units = 0) {
  db.prepare(`INSERT INTO usage (user_id,kind,model,input_tokens,cached_tokens,output_tokens,units,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    userId || null, kind, model,
    usage?.input_tokens || 0, usage?.input_tokens_details?.cached_tokens || 0,
    usage?.output_tokens || 0, units, now());
}

/**
 * Call the Responses API and get JSON back that matches `schema`.
 * tier: 'cheap' | 'good'
 */
export async function jsonCall({ userId, kind, tier = 'cheap', instructions, input, schema, schemaName, cacheKey, mock }) {
  if (config.mock) {
    const out = typeof mock === 'function' ? mock() : mock;
    logUsage(userId, kind, 'mock', { input_tokens: 0, output_tokens: 0 });
    return out;
  }
  const model = tier === 'good' ? config.modelGood : config.modelCheap;
  const effort = tier === 'good' ? config.effortGood : config.effortCheap;
  let res;
  try {
    res = await openai.responses.create({
    model,
    instructions,
    input,
    reasoning: effort ? { effort } : undefined,
    text: { format: { type: 'json_schema', name: schemaName || 'out', schema, strict: true } },
    prompt_cache_key: cacheKey,
    safety_identifier: userId || undefined,
    store: false,
    });
  } catch (e) {
    logIssue({ source: 'llm', message: `AI 呼叫失敗（${kind}）：${e.message}`, error: e, detail: { kind, model }, userId });
    throw e;
  }
  logUsage(userId, kind, model, res.usage);
  try {
    return JSON.parse(res.output_text);
  } catch (e) {
    logIssue({ source: 'llm', message: `AI 回傳的格式不正確（${kind}）`, detail: { kind, model, status: res.status, incomplete: res.incomplete_details, output: String(res.output_text).slice(0, 1500) }, userId });
    throw new Error('LLM returned invalid JSON: ' + String(res.output_text).slice(0, 200));
  }
}

export async function tts({ userId, text, voice, instructions }) {
  if (config.mock) { logUsage(userId, 'tts', 'mock', null, text.length); return null; }
  let res;
  try {
    res = await openai.audio.speech.create({ model: config.ttsModel, voice, input: text, instructions, response_format: 'mp3' });
  } catch (e) {
    logIssue({ level: 'warn', source: 'tts', message: `語音合成失敗，改傳文字：${e.message}`, error: e, detail: { voice, length: text.length }, userId });
    throw e;
  }
  logUsage(userId, 'tts', config.ttsModel, null, text.length);
  return Buffer.from(await res.arrayBuffer());
}

export async function stt({ userId, buffer, filename, durationSec }) {
  if (config.mock) { logUsage(userId, 'stt', 'mock', null, durationSec || 0); return '（測試模式）這是一段語音訊息'; }
  const file = await toFile(buffer, filename || 'voice.webm');
  let res;
  try {
    res = await openai.audio.transcriptions.create({ model: config.sttModel, file, language: 'zh' });
  } catch (e) {
    logIssue({ source: 'stt', message: `語音轉文字失敗：${e.message}`, error: e, detail: { filename, bytes: buffer?.length, durationSec }, userId });
    throw e;
  }
  logUsage(userId, 'stt', config.sttModel, null, durationSec || 0);
  return res.text;
}

const SEVERE = ['sexual', 'sexual/minors', 'hate', 'hate/threatening', 'harassment/threatening', 'violence/graphic', 'self-harm/instructions', 'self-harm/intent', 'illicit/violent'];

export async function moderate(text) {
  if (config.mock || !text) return { flagged: false };
  try {
    const r = await openai.moderations.create({ model: 'omni-moderation-latest', input: text });
    const res = r.results[0];
    const hit = Object.keys(res.categories).filter(k => res.categories[k]);
    // 只擋真正不行的類別；一般的戲劇衝突（打架、受傷、被欺負）會被標成 violence，這類放行
    const severe = hit.filter(k => SEVERE.includes(k));
    return { flagged: severe.length > 0, categories: severe, all: hit };
  } catch (e) {
    logIssue({ level: 'warn', source: 'llm', message: `內容審核呼叫失敗，先放行：${e.message}`, error: e });
    return { flagged: false };
  }
}
