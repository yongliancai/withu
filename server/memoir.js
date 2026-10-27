// 回憶錄：你們一起經歷過的事才會亮起來；還沒發生的只顯示半透明的「？？」，不劇透之後會發生什麼。
import { db, j } from './db.js';

const first = (sql, ...a) => db.prepare(sql).get(...a)?.at || null;
const ms = (rel, title) => first(`SELECT created_at at FROM story WHERE rel_id=? AND type='milestone' AND title=?`, rel.id, title);
const ev = (rel, name, type) => first(`SELECT MIN(created_at) at FROM events WHERE name=? AND json_extract(data,'$.rel')=?${type ? ` AND json_extract(data,'$.type')='${type}'` : ''}`, name, rel.id);

export function memoirFor(rel, persona) {
  const P = persona.gender === 'female' ? '她' : '他';
  const together = ms(rel, '你們在一起了');
  const chapters = [
    { title: '相遇', cards: [
      { id: 'meet', title: '你們第一次見面', at: rel.created_at },
      { id: 'friends', title: '你們成為朋友了', at: ms(rel, '你們成為朋友了') },
      { id: 'photo', title: '第一次分享眼前的風景', at: first(`SELECT MIN(created_at) at FROM story WHERE rel_id=? AND type='photo'`, rel.id) },
      { id: 'meal', title: `${P}第一次幫你點餐`, at: ev(rel, 'meal_choose') },
      { id: 'sticker', title: `${P}第一次傳貼圖給你`, at: first(`SELECT MIN(created_at) at FROM messages WHERE rel_id=? AND sender='char' AND kind='sticker'`, rel.id) },
    ] },
    { title: '靠近', cards: [
      { id: 'postcard', title: `收到${P}寄來的明信片`, at: first(`SELECT MIN(created_at) at FROM story WHERE rel_id=? AND type='postcard' AND scene IS NOT NULL`, rel.id) },
      { id: 'watch', title: '第一次一起看劇', at: ev(rel, 'activity_end', 'watch') },
      { id: 'focus', title: `${P}陪你專心做事`, at: ev(rel, 'activity_end', 'focus') },
      { id: 'bedtime', title: '第一次一起說晚安', at: ev(rel, 'activity_end', 'bedtime') },
      { id: 'note', title: '你們的第一個約定', at: first(`SELECT MIN(created_at) at FROM notes WHERE rel_id=?`, rel.id) },
      { id: 'outing', title: '第一次一起出門', at: first(`SELECT MIN(created_at) at FROM story WHERE rel_id=? AND type='travelogue'`, rel.id) },
    ] },
    { title: '心動', cards: [
      { id: 'flirt', title: '好像不只是朋友了', at: ms(rel, '你們之間，好像不只是朋友了') },
      { id: 'voice', title: `第一次聽見${P}的聲音`, at: first(`SELECT MIN(created_at) at FROM messages WHERE rel_id=? AND sender='char' AND kind='voice'`, rel.id) },
      { id: 'reconcile', title: '吵架之後和好', at: ev(rel, 'reconciled') },
    ] },
    { title: '在一起', cards: [
      { id: 'together', title: '你們在一起了', at: together },
      { id: 'pinned', title: `${P}成為你的置頂`, at: ev(rel, 'pinned') },
      { id: 'month', title: '交往一個月', at: together && Date.now() - together >= 30 * 864e5 ? together + 30 * 864e5 : null },
      { id: 'day100', title: '認識一百天', at: Date.now() - rel.created_at >= 100 * 864e5 ? rel.created_at + 100 * 864e5 : null },
      { id: 'longterm', title: '成為彼此的長期伴侶', at: ms(rel, '你們成為彼此的長期伴侶') },
    ] },
  ];
  const known = new Set(chapters.flatMap(c => c.cards.map(x => x.title)));
  const extra = db.prepare(`SELECT title, created_at at FROM story WHERE rel_id=? AND type='milestone' ORDER BY created_at`).all(rel.id)
    .filter(m => !known.has(m.title) && !/第一次幫你點餐|第一次一起/.test(m.title));
  // 只顯示已經開始的章節：還沒走到的章節（例如「心動」「在一起」）連名字都不出現，不劇透你們之後會怎樣
  const started = chapters.filter(c => c.cards.some(x => x.at));
  const out = started.map(c => ({ title: c.title, total: c.cards.length, unlocked: c.cards.filter(x => x.at).length,
    cards: c.cards.map(x => x.at ? { id: x.id, title: x.title, at: x.at, unlocked: true } : { id: x.id, unlocked: false }) }));
  if (started.length < chapters.length) out.push({ title: '', more: true, cards: [] });
  if (extra.length) out.splice(started.length, 0, { title: '只屬於你們的', total: extra.length, unlocked: extra.length, cards: extra.map((m, i) => ({ id: `x${i}`, title: m.title, at: m.at, unlocked: true })) });
  return out;
}
