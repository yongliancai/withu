import { db, now } from './db.js';

export const bigrams = (s = '') => {
  const t = s.replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
};

// Pick the memories worth bringing into this turn: weight, recency and overlap with what she just said.
export function selectMemories(relId, text = '', limit = 25) {
  const all = db.prepare(`SELECT * FROM memories WHERE rel_id=? AND kind != 'style' ORDER BY updated_at DESC`).all(relId);
  if (all.length <= limit) return all;
  const q = bigrams(text);
  const t = now();
  const scored = all.map(m => {
    let overlap = 0;
    if (q.size) for (const b of bigrams(m.content)) if (q.has(b)) overlap++;
    const ageDays = (t - m.updated_at) / 864e5;
    const kindBoost = m.kind === 'anniversary' || m.kind === 'dislike' ? 1.5 : 0;
    return { m, s: m.weight * 2 + overlap * 1.5 + kindBoost + Math.max(0, 3 - ageDays / 7) + (m.source === 'setting' ? 1 : 0) };
  });
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.m);
}

export function addMemory(rel, kind, content, weight = 1, source = 'real') {
  content = String(content || '').trim().slice(0, 200);
  if (!content) return;
  const dup = content.length < 6
    ? db.prepare('SELECT * FROM memories WHERE rel_id=? AND content=?').get(rel.id, content)
    : db.prepare('SELECT * FROM memories WHERE rel_id=? AND (content=? OR (length(content)>=6 AND (instr(content, ?) > 0 OR instr(?, content) > 0)))')
      .get(rel.id, content, content, content);
  if (dup) {
    // Mentioned again → it matters more.
    db.prepare('UPDATE memories SET weight=MIN(weight+1, 10), content=?, updated_at=? WHERE id=?')
      .run(content.length > dup.content.length ? content : dup.content, now(), dup.id);
    return;
  }
  db.prepare('INSERT INTO memories (rel_id,user_id,kind,content,weight,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(rel.id, rel.user_id, kind, content, Math.max(1, Math.min(5, weight || 1)), source, now(), now());
}

export function correctMemory(rel, id, content) {
  // Corrections are remembered harder than anything else.
  db.prepare('UPDATE memories SET content=?, weight=MIN(weight+3, 10), updated_at=? WHERE id=? AND rel_id=?')
    .run(String(content).slice(0, 200), now(), id, rel.id);
}

export function forgetMemory(rel, id) {
  db.prepare('DELETE FROM memories WHERE id=? AND rel_id=?').run(id, rel.id);
}

// 相處習慣：對方明確要求過的說話／相處方式，每次都帶入
export function habitsOf(relId) {
  return db.prepare(`SELECT id, content FROM memories WHERE rel_id=? AND kind='style' ORDER BY id`).all(relId);
}

// 他自己講過的生活故事：避免重講同一件事
db.exec(`CREATE TABLE IF NOT EXISTS told (id INTEGER PRIMARY KEY AUTOINCREMENT, rel_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at INTEGER NOT NULL)`);
export function addTold(relId, content) {
  content = String(content || '').trim().slice(0, 60);
  if (!content) return;
  const dup = db.prepare('SELECT 1 FROM told WHERE rel_id=? AND content=?').get(relId, content);
  if (!dup) db.prepare('INSERT INTO told (rel_id,content,created_at) VALUES (?,?,?)').run(relId, content, now());
}
export function toldOf(relId, limit = 20) {
  return db.prepare('SELECT content FROM told WHERE rel_id=? ORDER BY id DESC LIMIT ?').all(relId, limit).map(r => r.content).reverse();
}

// 兩句話有多像（0–1）：用來抓「他又講了一樣的話」
export function similarity(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (A.size < 4 || B.size < 4) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}
