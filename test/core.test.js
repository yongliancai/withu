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

test('場景狀態：相遇後以相遇場景為準，交代換地方才更新，過期才退回作息', async () => {
  const { sceneOf, sceneLine, startEncounterScene, moveScene, setScene } = await import('../server/scene.js');
  const { db: d } = await import('../server/db.js');
  d.prepare(`INSERT INTO users (id,nickname,call_name,recovery_code,created_at) VALUES ('u_s','a','a','S-1',?)`).run(Date.now());
  d.prepare(`INSERT INTO characters (id,user_id,origin,persona,created_at) VALUES ('c_s','u_s','custom','{}',?)`).run(Date.now());
  d.prepare(`INSERT INTO relationships (id,user_id,character_id,created_at) VALUES ('r_s','u_s','c_s',?)`).run(Date.now());
  const persona = { gender: 'female', workplace: '設計公司', schedule: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] } };
  const get = () => d.prepare('SELECT * FROM relationships WHERE id=?').get('r_s');
  assert.equal(sceneOf(get(), persona).fixed, false);
  startEncounterScene('r_s', { place: '大學社團博覽會', incident: '她撿起小卡', narration: '她彎身撿起小卡', face: true });
  let s = sceneOf(get(), persona);
  assert.equal(s.fixed, true); assert.equal(s.mode, 'face');
  assert.match(sceneLine(s, persona), /大學社團博覽會/);
  assert.match(sceneLine(s, persona), /當面/);
  setScene('r_s', { mode: 'remote' });
  assert.match(sceneLine(sceneOf(get(), persona), persona), /必須先在訊息裡交代/);
  moveScene('r_s', '捷運站');
  s = sceneOf(get(), persona);
  assert.equal(s.place, '捷運站'); assert.equal(s.source, 'said');
  setScene('r_s', { until: Date.now() - 1 });
  assert.equal(sceneOf(get(), persona).fixed, false);
});

test('送出前檢查：抓到鸚鵡式附和與當面時換地方，只回報問題不改寫', async () => {
  const { reviewReply } = await import('../server/turncheck.js');
  const rel = { id: 'r_s', user_id: 'u_s', stage: 0, created_at: Date.now(), start_type: 'stranger' };
  const persona = { name: '測', gender: 'female', schedule: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] } };
  const a = await reviewReply({ rel, persona, user: { call_name: 'a' }, userText: '我也不確定欸\n這張是你的嗎', texts: ['不是我的，我也不確定欸。'], rulesOnly: true });
  assert.deepEqual(a.texts, ['不是我的，我也不確定欸。']);
  assert.ok(a.problems.some(p => /原封不動/.test(p)));
  const b = await reviewReply({ rel, persona, user: { call_name: 'a' }, userText: '嗨', texts: ['我到咖啡店了'], face: true, rulesOnly: true, out: { scene: { moved: true, place: '咖啡店' } } });
  assert.ok(b.problems.some(p => /當面/.test(p)));
  const c = await reviewReply({ rel, persona, user: { call_name: 'a' }, userText: '今天好熱', texts: ['真的，我剛剛走出去差點融化'], rulesOnly: true });
  assert.deepEqual(c.problems, []);
});

test('相遇：不再聊滿 3 輪就自動交換', async () => {
  const { shouldWrap } = await import('../server/encounter.js');
  assert.equal(shouldWrap({ turn: 3, userText: '喔喔' }), false);
  assert.equal(shouldWrap({ turn: 2, userText: '我先走了掰掰' }), true);
  assert.equal(shouldWrap({ turn: 6, userText: '嗯' }), true);
});
