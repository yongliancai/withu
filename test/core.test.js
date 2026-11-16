// 基本回歸測試（測試模式，不需要 OpenAI 金鑰）：node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'withu-test-'));
// 假的 OpenAI：收到請求後不回應，用來測逾時
const slow = http.createServer(() => {}).listen(0);
process.env.OPENAI_API_KEY = 'test';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${slow.address().port}/v1`;
process.env.LLM_TIMEOUT_MS = '400';
process.env.MODERATION_TIMEOUT_MS = '300';

const { wellFormed, jsonCall } = await import('../server/llm.js');
const { crisisLevel } = await import('../server/safety.js');
const { runTurn, turnBusy } = await import('../server/engine.js');
const { db, now } = await import('../server/db.js');

test.after(() => { slow.closeAllConnections?.(); slow.close(); });

test('被切半的表情符號會換成合法字串', () => {
  const bad = '哈' + '😂'.slice(0, 1);
  assert.equal(bad.isWellFormed(), false);
  assert.equal(wellFormed(bad).isWellFormed(), true);
  assert.equal(wellFormed([{ role: 'user', content: bad }])[0].content.isWellFormed(), true);
});

test('AI 呼叫卡住時會在設定的時間內逾時', async () => {
  const t0 = Date.now();
  await assert.rejects(jsonCall({ kind: 'test', instructions: 'x', input: [{ role: 'user', content: 'x' }], schema: { type: 'object', additionalProperties: false, properties: {}, required: [] } }), /timed out|timeout/i);
  assert.ok(Date.now() - t0 < 5000, '應該在幾秒內放棄');
});

test('危機分級：關鍵字直接算 high；內容審核逾時時退回關鍵字結果', async () => {
  assert.equal(await crisisLevel('我不想活了'), 'high');
  const t0 = Date.now();
  assert.equal(await crisisLevel('今天有點累'), 'none');
  assert.ok(Date.now() - t0 < 3000);
});

test('同一段關係的回合會排隊，排程的主動訊息遇到忙碌就不傳', async () => {
  // 佔住一個回合（用不存在的關係讓它很快失敗也可以，重點是排隊行為）
  let release; const gate = new Promise(r => { release = r; });
  const order = [];
  const relId = 'r_test_lock';
  // 第一個回合：關係不存在會丟錯，但在那之前先確認鎖有建立
  const a = runTurn({ relId, user: {}, userText: 'a' }).catch(e => { order.push('a:' + e.message); });
  assert.equal(turnBusy(relId), true);
  const b = runTurn({ relId, user: {}, trigger: 'x', skipIfBusy: true }).then(r => { order.push('b:' + JSON.stringify(r)); });
  release(); await gate; await a; await b;
  assert.deepEqual(order, ['a:relationship not active', 'b:[]']);
  assert.equal(turnBusy(relId), false);
});
