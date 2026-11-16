// 場景狀態：角色「現在人在哪、在做什麼、是當面還是傳訊息」的唯一來源。
// 以前這件事有三個互不相通的來源（作息表、生活手帳、角色自己說過的話），規劃、寫回覆、檢查各看各的，
// 於是剛在社團博覽會遇到的人，下一句會說自己在咖啡店。現在：
//   - 相遇時由相遇卡寫入；之後只有角色在訊息裡交代「換地方了」才會更新（寫手輸出 scene.moved）。
//   - 規劃、寫手、送出前檢查都讀這一份；有效期間內，作息表和手帳不能蓋過它。
//   - 過了有效期間（沒有新的說法）才退回作息表。
import { db, now, j } from './db.js';
import { charStatus } from './characters.js';

try { db.exec('ALTER TABLE relationships ADD COLUMN scene_state TEXT'); } catch { /* 已經有了 */ }

const HOLD_ENCOUNTER = 3 * 3600e3;   // 相遇後 3 小時內，以相遇場景為準
const HOLD_SAID = 2 * 3600e3;        // 角色自己說的地點，2 小時內有效

/** 目前的場景。fixed = 有程式記錄的現況（不能被作息或手帳蓋掉）。 */
export function sceneOf(rel, persona, ts = Date.now()) {
  const s = j(rel.scene_state, null);
  if (s && s.until > ts) return { ...s, fixed: true };
  return { fixed: false, mode: 'remote', source: 'schedule', place: '', doing: charStatus(persona, ts).label };
}

export function setScene(relId, patch) {
  const cur = j(db.prepare('SELECT scene_state FROM relationships WHERE id=?').get(relId)?.scene_state, {}) || {};
  const next = { ...cur, ...patch };
  db.prepare('UPDATE relationships SET scene_state=? WHERE id=?').run(JSON.stringify(next), relId);
  return next;
}

/** 相遇時建立。 */
export function startEncounterScene(relId, { place, incident, narration, action, whyHere, face }) {
  return setScene(relId, {
    place: String(place || '').slice(0, 40), doing: String(incident || '').slice(0, 120),
    narration: [narration, action].filter(Boolean).join(' ').slice(0, 400), whyHere: String(whyHere || '').slice(0, 80),
    mode: face ? 'face' : 'remote', source: 'encounter', since: now(), until: now() + HOLD_ENCOUNTER,
  });
}

/** 角色在訊息裡交代自己換了地方。 */
export function moveScene(relId, place) {
  place = String(place || '').trim().slice(0, 40);
  if (!place) return null;
  return setScene(relId, { place, doing: '', mode: 'remote', source: 'said', since: now(), until: now() + HOLD_SAID });
}

/** 給模型看的現況說明（規劃、寫手、檢查共用同一段文字）。 */
export function sceneLine(scene, persona) {
  const P = persona?.gender === 'female' ? '她' : '他';
  if (!scene.fixed) return `你此刻的狀態（依你的作息）：${scene.doing}`;
  const mins = Math.max(1, Math.round((Date.now() - (scene.since || Date.now())) / 60000));
  if (scene.source === 'encounter') {
    return [
      `你此刻的狀態（事實，不能改）：${mins} 分鐘前你在「${scene.place}」遇到對方。`,
      scene.narration ? `當時發生的事（旁白，${P === '她' ? '「她」' : '「他」'}指的是你）：${scene.narration}` : `當時發生的事：${scene.doing}`,
      scene.whyHere ? `你會在那裡的原因：${scene.whyHere}` : '',
      scene.mode === 'face'
        ? '你們現在就站在那裡當面說話。'
        : `你們剛交換了 LINE，現在用訊息聊。你人還在「${scene.place}」或正要離開；要去別的地方，必須先在訊息裡交代（例如「我先走去捷運站了」）。`,
      '你的作息表和生活手帳裡，這段時間跟這裡不合的安排都當作沒發生，不要拿來說。',
    ].filter(Boolean).join('\n');
  }
  return `你此刻的狀態（你 ${mins} 分鐘前自己跟對方說的，事實）：你在「${scene.place}」。要換地方必須先在訊息裡交代，不能突然出現在別處。`;
}
