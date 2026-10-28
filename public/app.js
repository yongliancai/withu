// 伴旅 WithU — PWA front end (no build step).
import { portraitSVG, sceneSVG, LOOK_OPTIONS, setPortraitStyle, stickerSVG, STICKER_LIST, mascotSVG, APP_THEMES } from './art.js';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const tabs = $('#tabs');

const S = { me: null, meta: null, rels: [], timers: [], room: null };

async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: form ? undefined : body ? { 'content-type': 'application/json' } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401) { S.me = null; if (!/^#\/(welcome|join|recover)$/.test(location.hash)) location.hash = '#/welcome'; throw new Error('unauth'); }
  if (!res.ok) { const err = new Error(data?.error || '連線有點問題，再試一次'); err.data = data; err.status = res.status; throw err; }
  return data;
}
const track = (name, data) => api('/api/events', { method: 'POST', body: { name, data } }).catch(() => {});

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2400);
}
function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }

// ---------- small helpers ----------
const pad = (n) => String(n).padStart(2, '0');
function hhmm(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return '剛剛'; if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60); if (h < 24) return `${h} 小時前`;
  const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`;
}
function dayLabel(ts) {
  const d = new Date(ts), t = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, t)) return '今天';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (same(d, y)) return '昨天';
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
function dateStr(ts) { const d = new Date(ts); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; }

// 頭像小變化：season / festival accessory. A surprise, not a status.
function seasonMark(d = new Date()) {
  const m = d.getMonth() + 1, day = d.getDate();
  if (m === 10 && day >= 24) return '🎃';
  if (m === 12 && day >= 18 && day <= 26) return '🎄';
  if (m === 2 && day >= 10 && day <= 15) return '🌹';
  if (m >= 3 && m <= 5) return '🌸';
  if (m >= 6 && m <= 8) return '🍉';
  if (m >= 9 && m <= 11) return '🍂';
  return '🧣';
}
function avatar(frame, size = 48, { lover = false, season = true } = {}) {
  const discreet = S.me?.settings?.discreetNames;
  const f = discreet ? { hue: frame?.hue, name: '' } : frame;
  const usePhoto = !discreet && S.me?.settings?.portraitStyle === 'photo' && frame?.avatarPhoto;
  return `<span class="avatar${lover ? ' lover' : ''}${usePhoto ? ' photo' : ''}" style="--s:${size}px">${usePhoto ? `<img src="${esc(frame.avatarPhoto.thumb)}" alt="" loading="lazy">` : portraitSVG(f, size)}
    ${season ? `<span class="season">${seasonMark()}</span>` : ''}</span>`;
}
// 情境插圖卡片：用在「在哪裡遇見」和「來場偶遇」
function sceneCards(list, picked) {
  return `<div class="scene-grid">${list.map(s => `<button class="scene-card" data-s="${s.id}" aria-pressed="${s.id === picked}">
    <span class="art">${sceneSVG(s.id, { label: s.label })}</span><span class="lb">${esc(s.label)}</span></button>`).join('')}</div>`;
}
// 代名詞：ta(frame) 依角色性別；TA() 依使用者想遇見的人
const ta = (f) => (f?.gender === 'female' ? '她' : '他');
const TA = () => (S.me?.seeks === 'female' ? '她' : S.me?.seeks === 'any' ? 'TA' : '他');
const displayName = (frame) => S.me?.settings?.discreetNames ? (frame.name || '').slice(0, 1) + (frame.gender === 'female' ? '小姐' : '先生') : frame.name;

// ---------- sheet ----------
// 非同步打開的視窗：等資料回來時，如果使用者已經開了別的視窗，就不要蓋掉它
let sheetGen = 0;
const sheetGuard = () => { const g = sheetGen; return () => g === sheetGen; };
function openSheet(html, mount) {
  sheetGen++;
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const myGen = sheetGen;
  const close = () => { if (myGen === sheetGen) { root.innerHTML = ''; sheetGen++; } };
  $('.sheet-backdrop', root).onclick = close;
  mount?.($('.sheet', root), close);
  return close;
}

// ---------- routing ----------
const routes = [
  [/^#\/welcome$/, renderWelcome],
  [/^#\/join$/, renderJoin],
  [/^#\/recover$/, renderRecover],
  [/^#\/meet(?:\/(\w+))?$/, renderMeet],
  [/^#\/chat\/([\w-]+)$/, renderRoom],
  [/^#\/profile\/([\w-]+)$/, renderProfile],
  [/^#\/chat$/, renderChatList],
  [/^#\/feed$/, renderFeed],
  [/^#\/explore$/, renderExplore],
  [/^#\/story$/, renderStory],
  [/^#\/me$/, renderMe],
  [/^#\/settings$/, renderSettings],
];
async function route() {
  clearTimers();
  $('#sheet-root').innerHTML = ''; sheetGen++;
  let hash = location.hash || '#/chat';
  if (!S.me && !/^#\/(welcome|join|recover)$/.test(hash)) {
    try { S.me = await api('/api/me'); } catch { return; }
  }
  if (!S.meta) S.meta = await fetch('/api/meta').then(r => r.json());
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      const tab = hash.split('/')[1];
      const showTabs = ['chat', 'feed', 'explore', 'story', 'me', 'settings'].includes(tab) && !/^#\/chat\//.test(hash);
      tabs.hidden = !showTabs;
      if (showTabs && tab !== 'chat') refreshBadge();
      if (showTabs && tab !== 'feed') refreshFeedDot();
      $$('a', tabs).forEach(a => a.setAttribute('aria-current', a.dataset.tab === (tab === 'settings' ? 'me' : tab) ? 'page' : 'false'));
      window.scrollTo(0, 0);
      return fn(...m.slice(1));
    }
  }
  location.hash = '#/chat';
}
window.addEventListener('hashchange', route);

// ======================================================================
// Onboarding
// ======================================================================
function renderWelcome() {
  tabs.hidden = true;
  app.innerHTML = `<div class="welcome">
    <div class="hero-art">${sceneSVG('city', { label: '黃昏的城市' })}</div>
    <div class="mark">伴旅<span class="mark-en">WithU</span></div>
    <p class="lede">不只在 App 裡陪你聊天。<br>會報備、會陪你吃飯，也想看看你眼前的世界。</p>
    <a class="btn block" href="#/join" style="text-align:center;text-decoration:none">開始</a>
    <p class="fine">已經在別的裝置用過？<a href="#/recover">用登入碼回來</a><br>
    測試版・對方是 AI 角色，不是真人・限 18 歲以上</p>
  </div>`;
}

function renderJoin() {
  tabs.hidden = true;
  app.innerHTML = `<div class="page" style="padding-bottom:32px">
    <a class="icon-btn back" href="#/welcome" aria-label="返回">${icon('back')}</a>
    <h1>先讓對方知道怎麼叫你</h1>
    <form id="f">
      <label class="field"><span>邀請碼</span><input class="input" name="invite" autocomplete="off" required></label>
      <label class="field"><span>暱稱</span><input class="input" name="nickname" maxlength="16" required></label>
      <label class="field"><span>希望對方怎麼稱呼你</span><input class="input" name="callName" maxlength="16" placeholder="例如：小芸、阿哲"></label>
      <div class="field"><span>你是</span>${chipGroup('gender', [['female', '女生'], ['male', '男生'], ['other', '不想說']], '')}</div>
      <div class="field"><span>你想遇見</span>${chipGroup('seeks', [['male', '男生'], ['female', '女生'], ['any', '都可以']], '')}<p class="small muted" style="margin:6px 0 0">之後可以在「我」裡面改。</p></div>
      <p class="small muted">作息、喜好不用填，對方會從聊天裡慢慢認識你。</p>
      <label class="check"><input type="checkbox" name="adult" required><span>我已年滿 18 歲</span></label>
      <label class="check"><input type="checkbox" name="aiAck" required><span>我了解對方是 AI 角色，不是真人；對話會交由 AI 服務（OpenAI，美國）處理。</span></label>
      <p class="small muted">繼續即表示你同意<a href="/privacy" target="_blank">隱私權政策與使用條款</a>。</p>
      <button class="btn block" style="margin-top:14px">繼續</button>
    </form></div>`;
  const pick = { gender: '', seeks: '' };
  let seeksTouched = false;
  $$('[data-group]').forEach(g => $$('.chip', g).forEach(c => c.onclick = () => {
    $$('.chip', g).forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    pick[g.dataset.group] = c.dataset.v;
    if (g.dataset.group === 'seeks') seeksTouched = true;
  }));
  const setSeeks = (v) => { if (seeksTouched) return; pick.seeks = v; $$('[data-group="seeks"] .chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === v))); };
  // 邀請碼決定測試群組，並預選「想遇見」（仍可自己改）
  $('[name=invite]').onchange = async (e) => {
    const r = await fetch(`/api/auth/cohort?code=${encodeURIComponent(e.target.value.trim())}`).then(x => x.json()).catch(() => ({}));
    if (r.cohort) setSeeks(r.cohort === 'm' ? 'female' : 'male');
  };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (!pick.seeks) return toast('選一下你想遇見誰');
    try {
      const r = await api('/api/auth/join', { method: 'POST', body: { ...fd, ...pick, adult: !!fd.adult, aiAck: !!fd.aiAck } });
      S.me = await api('/api/me');
      app.innerHTML = `<div class="page" style="padding-bottom:32px"><h1>這是你的登入碼</h1>
        <p>換手機或清掉瀏覽器資料時，用它回來。之後也能在「我」裡面找到。</p>
        <div class="code-box">${esc(r.recoveryCode)}</div>
        <button class="btn block" id="go">好，去認識${TA()}</button></div>`;
      $('#go').onclick = () => { location.hash = '#/meet'; };
    } catch (err) { toast(err.message); }
  };
}

function renderRecover() {
  tabs.hidden = true;
  app.innerHTML = `<div class="page"><a class="icon-btn back" href="#/welcome" aria-label="返回">${icon('back')}</a>
    <h1>用登入碼回來</h1>
    <form id="f"><label class="field"><span>登入碼</span><input class="input" name="code" placeholder="XXXX-XXXX" autocomplete="off" required></label>
    <button class="btn block">回來</button></form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/auth/recover', { method: 'POST', body: { code: e.target.code.value } }); S.me = await api('/api/me'); location.hash = '#/chat'; }
    catch (err) { toast(err.message); }
  };
}

// ======================================================================
// Meeting: 我想認識他（先選人） / 來場偶遇吧（先選情境）
// ======================================================================
const M = { templateId: null, custom: null, frame: null, scenarioId: null, scenarioText: '', reunionRelId: null, mood: null };

// 分類篩選列
function catChips(list, cur) {
  const cats = (S.meta.categories || []).filter(c => list.some(t => (t.frame.cats || []).includes(c.id)));
  if (!cats.length) return '';
  return `<div class="cat-row" role="tablist">${[{ id: '', label: '全部' }, ...cats].map(c => `<button class="cat${cur === c.id ? ' on' : ''}" data-cat="${c.id}" role="tab" aria-selected="${cur === c.id}">${esc(c.label)}</button>`).join('')}</div>`;
}
const inCat = (t, cat) => !cat || (t.frame.cats || []).includes(cat);

// 角色的 AI 人像（還沒認識時是模糊的），一定標示 AI 生成
function portraitThumb(url, name, cls = 'pt-tile') {
  return `<span class="${cls}"><img src="${esc(url)}" alt="${esc(name)}的照片（AI 生成）" loading="lazy"><i class="ai-tag">AI 生成</i></span>`;
}
function personCard(t, pressed = false) {
  const f = t.frame;
  return `<button class="person" data-id="${esc(t.id)}" aria-pressed="${pressed}">
    ${t.portrait ? portraitThumb(t.portrait, f.name, 'pt-mini') : avatar(f, 56, { season: false })}
    <span class="grow"><span class="nm">${esc(f.name)}</span>
      <div class="info">${esc(f.age)} 歲・${esc(f.nationality)}・${esc(f.jobLabel)}・${esc(f.archetypeLabel || '')}</div>
      <div class="intro">${esc(f.intro || '')}</div>
      ${t.kind === 'shared' ? `<div class="info">由 ${esc(t.creator)} 塑造</div>` : ''}</span></button>`;
}

async function renderMeet(step) {
  tabs.hidden = true;
  const back = `<a class="icon-btn back" href="${S.rels.length ? '#/chat' : '#/meet'}" aria-label="返回">${icon('back')}</a>`;
  if (!step) {
    Object.assign(M, { templateId: null, custom: null, frame: null, scenarioId: null, scenarioText: '', reunionRelId: null, mood: null });
    app.innerHTML = `<div class="page" style="padding-bottom:32px">${back}
      <h1>你想怎麼遇見${TA()}？</h1>
      <button class="choice" data-go="person"><b>我想認識${TA()}</b><span>先選一個人，再決定你們在哪裡遇見</span></button>
      <button class="choice" data-go="scene"><b>來場偶遇吧</b><span>先選一個情境，看看誰可能出現在那裡</span></button>
      <button class="choice" data-go="mood"><b>依心情認識</b><span>說說你現在的心情，遇見適合此刻的人</span></button></div>`;
    $$('[data-go]').forEach(b => b.onclick = () => { location.hash = `#/meet/${b.dataset.go}`; });
    return;
  }
  if (step === 'person') {
    const list = await api('/api/templates');
    let cat = S.meetCat || '';
    const draw = () => {
      const shown = list.filter(t => inCat(t, cat));
      app.innerHTML = `<div class="page" style="padding-bottom:32px"><a class="icon-btn back" href="#/meet" aria-label="返回">${icon('back')}</a>
        <h1>想認識誰？</h1>${catChips(list, cat)}
        ${shown.length ? `<div class="people">${shown.map(t => personCard(t)).join('')}</div>` : '<p class="muted">現有的角色你都認識了，自己捏一個吧。</p>'}
        <h2>都不是你想要的？</h2><button class="choice" id="custom"><b>自己捏一個</b><span>點選${TA()}的框架，個性會在聊天中慢慢長出來</span></button></div>`;
      $$('[data-cat]').forEach(b => b.onclick = () => { cat = S.meetCat = b.dataset.cat; draw(); });
      $$('.person').forEach(b => b.onclick = () => {
        const t = list.find(x => x.id === b.dataset.id);
        M.templateId = t.id; M.frame = t.frame; M.custom = null;
        location.hash = '#/meet/where';
      });
      $('#custom').onclick = () => { location.hash = '#/meet/custom'; };
    };
    draw();
    return;
  }
  if (step === 'mood') return renderMood();
  if (step === 'custom') return renderCustom();
  if (step === 'where') return renderWhere();
  if (step === 'scene') return renderScenePick();
  if (step === 'who') return renderWho();
  location.hash = '#/meet';
}

function chipGroup(name, options, value) {
  return `<div class="chips" data-group="${name}">${options.map(([v, l]) =>
    `<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(l)}</button>`).join('')}</div>`;
}
function bindChips(root, state, onChange) {
  $$('[data-group]', root).forEach(g => $$('.chip', g).forEach(c => c.onclick = () => {
    $$('.chip', g).forEach(x => x.setAttribute('aria-pressed', 'false'));
    c.setAttribute('aria-pressed', 'true');
    state[g.dataset.group] = c.dataset.v;
    onChange?.(g.dataset.group);
  }));
}

function renderCustom(prev) {
  const meta = S.meta;
  const defGender = S.me?.seeks === 'female' ? 'female' : 'male';
  const st = prev || { gender: defGender, age: '28', nationality: '台灣', job: defGender === 'female' ? 'designer' : 'engineer',
    proactivity: 'slow', voice: '', hue: meta.hues[Math.floor(Math.random() * meta.hues.length)],
    hairColor: LOOK_OPTIONS.hairColor[1][0], top: LOOK_OPTIONS.top[0][0], glasses: '0' };
  const P = st.gender === 'female' ? '她' : '他';
  const voices = meta.voices[st.gender] || meta.voices.male;
  if (!voices.find(v => v.id === st.voice)) st.voice = voices[0].id;
  const archList = Object.entries(meta.archetypes).filter(([, v]) => !v.for || v.for === st.gender);
  if (!archList.find(([k]) => k === st.archetype)) st.archetype = archList[0][0];
  const hairs = LOOK_OPTIONS.hair[st.gender];
  if (!hairs.find(([k]) => k === st.hair)) st.hair = hairs[0][0];
  const jobs = Object.entries(meta.jobs).map(([k, v]) => [k, v.label]);
  const pro = Object.entries(meta.proactivity).map(([k, v]) => [k, v.label]);
  const look = () => ({ hair: st.hair, hairColor: st.hairColor, top: st.top, skin: '#F1C9A6', accessory: 'collar', accent: '#9AA7B8', glasses: st.glasses === '1', style: st.style === 'anime' ? 'anime' : undefined });
  app.innerHTML = `<div class="page" style="padding-bottom:32px"><a class="icon-btn back" href="#/meet/person" aria-label="返回">${icon('back')}</a>
    <h1>${P}是什麼樣的人？</h1>
    <div class="builder-face" id="face">${portraitSVG({ hue: st.hue, look: look(), gender: st.gender }, 132)}</div>
    <label class="field"><span>名字</span><input class="input" id="nm" maxlength="12" value="${esc(st.name || '')}" placeholder="${st.gender === 'female' ? '例如：林語晴' : '例如：陳亦安'}"></label>
    <div class="field"><span>性別</span>${chipGroup('gender', [['male', '男生'], ['female', '女生']], st.gender)}</div>
    <div class="field"><span>髮型</span>${chipGroup('hair', hairs, st.hair)}</div>
    <div class="field"><span>髮色</span>${chipGroup('hairColor', LOOK_OPTIONS.hairColor, st.hairColor)}</div>
    <div class="field"><span>穿著</span>${chipGroup('top', LOOK_OPTIONS.top, st.top)}</div>
    <div class="field"><span>眼鏡</span>${chipGroup('glasses', [['0', '不戴'], ['1', '戴眼鏡']], st.glasses)}</div>
    <div class="field"><span>畫風</span>${chipGroup('style', LOOK_OPTIONS.style, st.style || 'real')}</div>
    <div class="field"><span>年齡</span>${chipGroup('age', [['24', '24'], ['28', '28'], ['32', '32'], ['36', '36'], ['42', '42']], st.age)}</div>
    <div class="field"><span>國籍</span>${chipGroup('nationality', [['台灣', '台灣'], ['日本', '日本'], ['韓國', '韓國'], ['香港', '香港'], ['法國', '法國']], st.nationality)}</div>
    <div class="field"><span>職業（決定${P}的作息）</span>${chipGroup('job', jobs, st.job)}</div>
    <div class="field"><span>角色原型</span>${chipGroup('archetype', archList.map(([k, v]) => [k, v.label]), st.archetype)}<p class="small muted" id="archdesc" style="margin-top:8px"></p></div>
    <div class="field"><span>主動程度</span>${chipGroup('proactivity', pro, st.proactivity)}</div>
    <div class="field"><span>聲線（之後不能換）</span>${chipGroup('voice', voices.map(v => [v.id, v.label]), st.voice)}</div>
    <label class="field"><span>外觀描述（選填）</span><input class="input" id="ap" maxlength="80" value="${esc(st.appearance || '')}" placeholder="例如：笑起來有酒窩、常穿深色毛衣"></label>
    <p class="small muted">個性、幽默感、說話方式，會在你們當朋友的時候慢慢長出來。不能使用真人或現有作品角色。</p>
    <button class="btn block" id="next">下一步：在哪裡遇見${P}</button></div>`;
  const desc = () => { $('#archdesc').textContent = meta.archetypes[st.archetype]?.desc || ''; };
  desc();
  bindChips(app, st, (k) => {
    if (k === 'gender') return renderCustom(st);
    if (['hair', 'hairColor', 'top', 'glasses', 'style'].includes(k)) $('#face').innerHTML = portraitSVG({ hue: st.hue, look: look(), gender: st.gender }, 132);
    if (k === 'archetype') desc();
  });
  $('#nm').oninput = (e) => { st.name = e.target.value; };
  $('#ap').oninput = (e) => { st.appearance = e.target.value; };
  $('#next').onclick = () => {
    if (!st.name?.trim()) return toast(`幫${P}取個名字吧`);
    M.custom = { ...st, look: look() }; M.templateId = null;
    M.frame = { name: st.name, hue: st.hue, job: st.job, jobLabel: meta.jobs[st.job].label, gender: st.gender, look: look() };
    location.hash = '#/meet/where';
  };
}

function renderWhere() {
  if (!M.frame) { location.hash = '#/meet'; return; }
  const sc = S.meta.scenarios;
  const rec = sc.filter(s => s.jobs.includes(M.frame.job));
  const rest = sc.filter(s => !rec.includes(s));
  app.innerHTML = `<div class="page" style="padding-bottom:32px"><a class="icon-btn back" href="#/meet/person" aria-label="返回">${icon('back')}</a>
    <h1>你們在哪裡遇見？</h1>
    ${rec.length ? `<div class="list-label">適合${esc(M.frame.jobLabel)}的情境</div>${sceneCards(rec)}<div class="list-label" style="margin-top:18px">其他情境</div>` : ''}
    ${sceneCards(rest)}
    <h2>或自己寫</h2>
    <textarea class="input" id="free" rows="3" maxlength="300" placeholder="例如：${ta(M.frame)}是我國中同班的青梅竹馬，畢業後在同學會重逢">${esc(M.scenarioText || '')}</textarea>
    <p class="small muted">只能從陌生人或朋友開始；戀人要靠你們一起走到。</p>
    <button class="btn block" id="go">就這樣遇見${ta(M.frame)}</button></div>`;
  let picked = null;
  $$('[data-s]').forEach(b => b.onclick = () => { $$('[data-s]').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); picked = b.dataset.s; $('#free').value = ''; });
  $('#free').oninput = () => { if ($('#free').value) { picked = null; $$('[data-s]').forEach(x => x.setAttribute('aria-pressed', 'false')); } };
  $('#go').onclick = () => {
    M.scenarioText = $('#free').value.trim(); M.scenarioId = picked;
    if (!M.scenarioText && !M.scenarioId) return toast('選一個情境，或自己寫一個');
    doMeet();
  };
}

function renderScenePick() {
  app.innerHTML = `<div class="page" style="padding-bottom:32px"><a class="icon-btn back" href="#/meet" aria-label="返回">${icon('back')}</a>
    <h1>今天會在哪裡偶遇？</h1>
    <button class="choice" id="snap"><b>📷 拍一張你現在在的地方</b><span>看看會在這裡遇見誰；照片只用來判斷情境，不會保存</span></button>
    <input type="file" id="snapIn" accept="image/*" capture="environment" hidden>
    ${sceneCards(S.meta.scenarios)}
    <h2>或自己寫</h2>
    <textarea class="input" id="free" rows="3" maxlength="300" placeholder="例如：週末在大稻埕的老咖啡店，下午有點悶">${esc(M.scenarioText || '')}</textarea>
    <button class="btn block" id="go" style="margin-top:14px">看看誰在那裡</button></div>`;
  let picked = null;
  $$('[data-s]').forEach(b => b.onclick = () => { $$('[data-s]').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); picked = b.dataset.s; });
  $('#snap').onclick = () => $('#snapIn').click();
  $('#snapIn').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    $('#snap').innerHTML = '<b>正在看你拍的地方…</b><span>稍等一下</span>';
    try {
      const fd = new FormData(); fd.append('photo', await shrinkImage(f, 768), 'scene.jpg');
      const r = await api('/api/encounter/photo', { method: 'POST', form: fd });
      M.scenarioId = r.scenario; M.scenarioText = '';
      toast(r.label ? `看起來像是：${r.label}` : '找到了');
      location.hash = '#/meet/who';
    } catch (err) { toast(err.message); $('#snap').innerHTML = '<b>📷 拍一張你現在在的地方</b><span>再試一次，或直接選下面的情境</span>'; }
  };
  $('#go').onclick = () => {
    M.scenarioText = $('#free').value.trim(); M.scenarioId = picked;
    if (!M.scenarioText && !M.scenarioId) return toast('選一個情境，或自己寫一個');
    location.hash = '#/meet/who';
  };
}

// 依心情認識
async function renderMood() {
  app.innerHTML = `<div class="page" style="padding-bottom:32px"><a class="icon-btn back" href="#/meet" aria-label="返回">${icon('back')}</a>
    <h1>你現在的心情是？</h1><p class="muted">只用在這一次的相遇，不會被記錄下來。</p>
    <div class="mood-grid">${S.meta.moods.map(m => `<button class="choice" data-mood="${m.id}"><b>${esc(m.label)}</b><span>遇見${esc(m.want)}</span></button>`).join('')}</div>
    <div id="moodPicks"></div></div>`;
  $$('[data-mood]').forEach(b => b.onclick = async () => {
    $$('[data-mood]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    const r = await api(`/api/mood-picks?mood=${b.dataset.mood}`);
    M.mood = r.mood.id; M.scenarioId = r.mood.scenario; M.scenarioText = '';
    $('#moodPicks').innerHTML = `<h2>此刻適合遇見的人</h2>${r.mood.friend ? `<p class="small muted">先從朋友開始，${TA()}會陪你把心情說清楚。</p>` : ''}
      ${r.picks.length ? `<div class="people">${r.picks.map(t => personCard(t)).join('')}</div>` : '<p class="muted">現有的角色你都認識了。</p>'}`;
    $$('#moodPicks .person').forEach(p => p.onclick = () => { const t = r.picks.find(x => x.id === p.dataset.id); M.templateId = t.id; M.frame = t.frame; doMeet(); });
    $('#moodPicks').scrollIntoView({ behavior: 'smooth' });
  });
}

async function renderWho() {
  if (!M.scenarioId && !M.scenarioText) { location.hash = '#/meet/scene'; return; }
  const r = await api(`/api/encounter?scenario=${encodeURIComponent(M.scenarioId || '')}`);
  app.innerHTML = `<div class="page" style="padding-bottom:32px"><a class="icon-btn back" href="#/meet/scene" aria-label="返回">${icon('back')}</a>
    <h1>可能在這裡出現的人</h1>
    ${r.reunion ? `<button class="choice" id="reunion"><b>……是${esc(r.reunion.frame.name)}？</b><span>你們曾經在一起過。${ta(r.reunion.frame)}好像也看見你了。</span></button>` : ''}
    ${r.picks.length ? `<div class="people">${r.picks.map(t => personCard(t)).join('')}</div>` : (r.reunion ? '' : '<p class="muted">今天這裡好像沒有新面孔。換個情境，或到「我想認識${TA()}」自己捏一個。</p>')}</div>`;
  $$('.person').forEach(b => b.onclick = () => {
    const t = r.picks.find(x => x.id === b.dataset.id);
    M.templateId = t.id; M.frame = t.frame; doMeet();
  });
  if (r.reunion) $('#reunion').onclick = () => { M.reunionRelId = r.reunion.relId; M.frame = r.reunion.frame; doMeet(); };
}

async function doMeet() {
  app.innerHTML = `<div class="going"><div>${avatar(M.frame, 72, { season: false })}<p class="hand" style="margin-top:18px">正在前往你們相遇的地方……</p></div></div>`;
  try {
    const r = await api('/api/meet', { method: 'POST', body: { templateId: M.templateId, custom: M.custom, scenarioId: M.scenarioId, scenarioText: M.scenarioText, reunionRelId: M.reunionRelId, mood: M.mood } });
    location.hash = `#/chat/${r.relId}`;
  } catch (e) {
    const back = M.templateId && !M.reunionRelId && location.hash !== '#/meet/who' ? '#/meet/where' : (M.scenarioText ? '#/meet/scene' : null);
    if (M.scenarioText && e.data) {
      // 情境被擋：說明原因，給改寫版本，保留原本寫的內容
      if (back) { location.hash = back; await new Promise(r => setTimeout(r, 120)); } else history.back();
      openSheet(`<h3>這個情境需要改一下</h3><p>${esc(e.message)}</p>
        ${e.data.rewrite ? `<div class="card" style="max-width:100%"><div class="small muted" style="margin-bottom:4px">改寫建議</div><p class="hand" style="font-size:16px;margin:0">${esc(e.data.rewrite)}</p></div>
        <button class="btn block" id="useRw" style="margin-top:12px">用這個版本</button>` : ''}
        <button class="btn ghost block" id="editRw" style="margin-top:10px">我自己改</button>`, (sheet, close) => {
        $('#useRw', sheet) && ($('#useRw', sheet).onclick = () => { close(); M.scenarioText = e.data.rewrite; M.scenarioId = null; if (location.hash === '#/meet/scene') location.hash = '#/meet/who'; else doMeet(); });
        $('#editRw', sheet).onclick = () => { close(); $('#free')?.focus(); };
      });
      return;
    }
    toast(e.message);
    setTimeout(() => history.back(), 600);
  }
}

// ======================================================================
// 聊天（首頁）
// ======================================================================
async function renderChatList() {
  const draw = async () => {
    S.rels = await api('/api/rels'); refreshBadge(S.rels);
    const active = S.rels.filter(r => r.status === 'active');
    if (!active.length) {
      app.innerHTML = `<div class="page"><h1>聊天</h1>${installBanner()}<div class="empty"><div class="empty-art">${sceneSVG('city', { label: '黃昏的城市' })}</div><p class="hand">還沒有遇見誰</p>
        <p class="muted">${TA()}會在你的生活裡出現：咖啡廳、捷運上、加班後的便利商店。</p>
        <a class="btn" href="#/meet" style="text-decoration:none;display:inline-block;margin-top:8px">去認識${TA()}</a></div></div>`;
      bindInstall();
      return;
    }
    const lover = active.find(r => r.pinned);
    const others = active.filter(r => r !== lover).sort((a, b) => (b.starred - a.starred) || ((b.last?.at || 0) - (a.last?.at || 0)));
    app.innerHTML = `<div class="page">
      ${S.me.mock ? '<div class="banner-test">測試模式：尚未設定 OpenAI 金鑰，回覆為範例</div>' : ''}
      <h1>聊天</h1>${installBanner()}<div id="sysAnn"></div><div id="annBanner"></div>
      ${lover ? `<a class="lover-card" href="#/chat/${lover.id}">${avatar(lover.frame, 72, { lover: true })}
        <span class="grow" style="min-width:0"><span class="name">${esc(displayName(lover.frame))}</span>
        ${lover.statusLine && Date.now() - lover.statusLineAt < 12 * 3600e3
          ? `<span class="status-line">${esc(lover.statusLine)}</span><time class="status-time">${ago(lover.statusLineAt)}・${ta(lover.frame)}告訴你的</time>`
          : `<span class="pres small">${presenceDot(lover.presence)}${esc(presenceText(lover.presence))}</span><span class="muted small last1">${esc(lover.last?.text || '')}</span>`}</span>
        ${lover.unread ? `<span class="badge">${lover.unread}</span>` : ''}</a>` : ''}
      ${others.length ? `<div class="list-label">${lover ? '朋友' : '最近'}</div>` : ''}
      ${others.map(r => `<a class="conv${r.mode === 'practice' && r.stage === 2 && r.unread ? ' glow' : ''}" href="#/chat/${r.id}"><span class="av-wrap">${avatar(r.frame, 50)}${r.presence?.code === 'online' ? '<span class="pdot online on-av" aria-label="上線中"></span>' : ''}</span>
        <span class="meta"><span class="top"><span class="nm">${esc(displayName(r.frame))}</span>${r.starred ? '<span class="star" aria-label="特別關注">★</span>' : ''}
        ${r.outing ? '<span class="tag">出遊中</span>' : ''}<span class="when">${r.last ? ago(r.last.at) : ''}</span></span>
        <span class="last">${r.last?.sender === 'user' ? '你：' : ''}${esc(r.last?.text || '')}</span></span>
        ${r.unread ? `<span class="badge">${r.unread}</span>` : ''}</a>`).join('')}
      <div style="text-align:center;margin-top:22px"><a class="btn ghost sm" href="#/meet" style="text-decoration:none">認識新的人</a></div>
    </div>
    <button class="mood-fab" id="moodFab" aria-label="心情按鈕">${moodFace()}</button>`;
    bindInstall();
    $('#moodFab').onclick = () => openMoodButton();
    // 伴旅的公告（後台發的）：看過、按掉就不再出現
    api('/api/announcements').then(list => {
      let gone = []; try { gone = JSON.parse(localStorage.getItem('annGone') || '[]'); } catch {}
      const a = list.find(x => !gone.includes(x.id));
      if (!a || !$('#sysAnn')) return;
      $('#sysAnn').innerHTML = `<div class="sys-ann" role="status"><span class="sys-ann-art">${moodFace('happy')}</span><span class="grow">${esc(a.text)}</span><button class="icon-btn" aria-label="知道了">${icon('x')}</button></div>`;
      $('#sysAnn button').onclick = () => { try { localStorage.setItem('annGone', JSON.stringify([...gone, a.id].slice(-30))); } catch {} $('#sysAnn').innerHTML = ''; };
    }).catch(() => {});
    api('/api/anniversaries').then(list => {
      const a = list.find(x => x.kind === 'his_birthday') || list[0];
      if (!a || !$('#annBanner')) return;
      $('#annBanner').innerHTML = `<a class="ann-banner" href="#/chat/${a.relId}">${a.kind === 'his_birthday' ? '🎂' : a.kind === 'your_birthday' ? '🎉' : '💗'} ${a.left === 0 ? '今天' : '明天'}是${a.kind === 'his_birthday' ? esc(a.name) + '的生日' : a.kind === 'your_birthday' ? '你的生日' : `你和${esc(a.name)}的「${esc(a.title)}」`}</a>`;
    }).catch(() => {});
  };
  await draw();
  S.timers.push(setInterval(() => { if (document.visibilityState === 'visible' && !$('#sheet-root').innerHTML) draw().catch(() => {}); }, 20000));
}

// ---------- 上線狀態 ----------
function presenceText(p) {
  if (!p) return '';
  if (p.code === 'away') return p.lastSeen ? `最後上線 ${ago(p.lastSeen)}` : '離線';
  return p.label;
}
const presenceDot = (p) => p ? `<span class="pdot ${p.code}" aria-hidden="true"></span>` : '';

// App 圖示與「聊天」分頁上的未讀數
let badgeAt = 0;
async function refreshBadge(rels) {
  try {
    if (!rels) { if (Date.now() - badgeAt < 8000) return; rels = await api('/api/rels'); }
    badgeAt = Date.now();
    const n = rels.filter(r => r.status === 'active').reduce((a, r) => a + (r.unread || 0), 0);
    const a = $('a[data-tab="chat"]', tabs);
    let b = a && $('.tab-badge', a);
    if (a && n && !b) { b = document.createElement('span'); b.className = 'tab-badge'; a.appendChild(b); }
    if (b) { if (n) b.textContent = n > 99 ? '99+' : n; else b.remove(); }
    if (navigator.setAppBadge) n ? navigator.setAppBadge(n).catch(() => {}) : navigator.clearAppBadge().catch(() => {});
  } catch {}
}

// 第一次聊完：問要不要開通知（iPhone 要先加入主畫面）
function maybeAskNotify(rel) {
  try {
    if (S.askedNotify) return;
    if ($('#sheet-root').innerHTML || !S.room || S.room.rel?.id !== rel.id) return; // 使用者正在看別的東西：下次再問，不要蓋掉
    if (isIOS() && !isStandalone()) {
      if (localStorage.getItem('a2hsShown')) return;
      S.askedNotify = true; localStorage.setItem('a2hsShown', '1');
      return openSheet(`<h3>把 App 加到主畫面</h3>
        <p class="muted">iPhone 要從主畫面打開，${ta(rel.frame)}找你的時候才收得到通知。</p>
        <ol class="steps"><li>點 Safari 下方的「分享」按鈕 <span class="kbd">⬆︎</span></li><li>往下滑，選「加入主畫面」</li><li>從主畫面的「伴旅」圖示打開，再到「我 → 通知」開啟</li></ol>
        <button class="btn block" id="a2ok">知道了</button>`, (sh, close) => { $('#a2ok', sh).onclick = close; });
    }
    if (!('Notification' in window) || Notification.permission !== 'default' || !S.me?.pushKey || S.me?.settings?.notifyAsked) return;
    S.askedNotify = true;
    api('/api/me', { method: 'PATCH', body: { settings: { notifyAsked: true } } }).then(() => { S.me.settings.notifyAsked = true; }).catch(() => {});
    openSheet(`<h3>要開啟通知嗎？</h3>
      <p class="muted">${esc(rel.frame.name)}想找你、或忙完回你的時候，才通知得到你。你的勿擾時段不會響。</p>
      <button class="btn block" id="nfOn">開啟通知</button><button class="btn ghost block" id="nfNo" style="margin-top:8px">先不要</button>`,
      (sh, close) => { $('#nfOn', sh).onclick = async () => { close(); await enablePush(); }; $('#nfNo', sh).onclick = close; });
  } catch {}
}

const sleep = (ms) => new Promise(r => setTimeout(r, Math.max(0, ms)));
const jitter = (ms) => ms * (0.75 + Math.random() * 0.5);
// 真人的節奏：先已讀，再打字；每秒大約 5 個字，一則最多 8 秒，兩則之間停一下
const readMs = (len) => jitter(Math.min(3500, Math.max(900, 600 + len * 35)));
const typeMs = (m) => m.kind === 'voice' ? jitter(2600) : jitter(Math.min(8000, Math.max(1300, (m.text || '').length * 190)));

// ---------- chat room ----------
function icon(name) {
  const p = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
    photo: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><circle cx="9" cy="10.5" r="1.6"/><path d="M20 15.5l-4.5-4.5L7 19"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    spark: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14q3.5 3.5 7 0"/><circle cx="9.3" cy="10" r=".6"/><circle cx="14.7" cy="10" r=".6"/>',
    menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
    more: '<circle cx="12" cy="5.5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="18.5" r="1.2"/>',
    phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  }[name];
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
}

function waveBars(seed, n = 22) {
  let s = 0; for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, (_, i) => { s = (s * 1103515245 + 12345) >>> 0; return `<i style="height:${30 + (s % 70)}%"></i>`; }).join('');
}

function messageHtml(m, rel, prev) {
  let out = '';
  if (!prev || dayLabel(prev.at) !== dayLabel(m.at)) out += `<div class="day">${dayLabel(m.at)}</div>`;
  const side = m.sender === 'user' ? 'me' : 'him';
  const glow = side === 'him' && rel.mode === 'practice' && rel.stage === 2 ? ' glow' : '';
  if (m.kind === 'scene') {
    const art = m.id === S.room?.firstSceneId ? `<div class="scene-art">${sceneSVG(rel.scenarioId || 'city', { label: '你們相遇的地方' })}</div>` : '';
    return out + `${art}<div class="scene" data-id="${m.id}">${esc(m.text)}</div>`;
  }
  if (m.kind === 'card') return out + cardHtml(m, rel);
  if (m.kind === 'sticker') {
    const readMark = side === 'me' && typeof m.id === 'number' && m.id <= (S.room?.charReadId || 0) ? '<span class="read">已讀</span>' : '';
    return out + `<div class="msg ${side} stk" data-id="${m.id}">${side === 'me' ? `<span class="time">${readMark}${hhmm(m.at)}</span>` : ''}<div class="stk-img">${stickerSVG(m.card?.id, 112)}</div>${side === 'him' ? `<span class="time">${hhmm(m.at)}</span>` : ''}</div>`;
  }
  if (m.kind === 'photo') {
    return out + `<div class="msg me" data-id="${m.id}"><span class="time">${hhmm(m.at)}</span><div class="photo-bubble"><img src="${esc(S.room?.previews?.[m.id] || m.media)}" alt="你分享的照片" loading="lazy">${m.text ? `<div class="cap">${esc(m.text)}</div>` : ''}</div></div>`;
  }
  if (m.kind === 'voice') {
    return out + `<div class="msg ${side}${glow}" data-id="${m.id}">${side === 'me' ? `<span class="time">${hhmm(m.at)}</span>` : ''}
      <div class="bubble"><div class="voice"><button class="play" data-audio="${m.media}" aria-label="播放語音"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
      <span class="wave">${waveBars(m.id)}</span></div>
      <button class="voice-toggle" data-tx>轉文字</button><div class="voice-tx" hidden>${esc(m.text)}</div></div>
      ${side === 'him' ? `<span class="time">${hhmm(m.at)}</span>` : ''}</div>`;
  }
  const readMark = side === 'me' && typeof m.id === 'number' && m.id <= (S.room?.charReadId || 0) ? '<span class="read">已讀</span>' : '';
  const quote = m.card?.storyReply ? `<div class="sq">回覆限時動態：${esc(m.card.storyReply)}</div>` : '';
  return out + `<div class="msg ${side}${glow}" data-id="${m.id}">${side === 'me' ? `<span class="time">${readMark}${hhmm(m.at)}</span>` : ''}<div class="bubble">${quote}${esc(m.text)}</div>${side === 'him' ? `<span class="time">${hhmm(m.at)}</span>` : ''}</div>`;
}

function cardHtml(m, rel) {
  const c = m.card || {};
  const id = m.id;
  switch (c.type) {
    case 'milestone': return `<div class="milestone" data-id="${id}"><span>今天，${esc(c.title)}</span></div>`;
    case 'hint': return `<div class="note" data-id="${id}">${esc(c.text)}</div>`;
    case 'outing': return `<div class="note" data-id="${id}">${esc(c.text)}・出遊模式</div>`;
    case 'walk': return `<div class="note" data-id="${id}">${esc(c.text)}</div>`;
    case 'nudge': return `<div class="note" data-id="${id}">${esc(c.text)}</div>`;
    case 'note': return `<div class="note" data-id="${id}">📝 記進記事本：${esc(c.text)}</div>`;
    case 'choice': return `<div class="msg him" data-id="${id}"><div class="card choice-card"><p class="hand" style="margin:0 0 8px;font-size:16px">${esc(c.prompt)}</p>
      ${c.chosen !== undefined ? `<p class="small muted" style="margin:0">你們選了「${esc(c.options[c.chosen])}」</p>` : `<div class="choice-opts">${c.options.map((o, i) => `<button class="btn ghost sm" data-choice="${id}" data-idx="${i}">${esc(o)}</button>`).join('')}</div>`}</div></div>`;
    case 'goal': return `<div class="msg him" data-id="${id}"><div class="card goal-card"><div class="small muted">一起完成的小目標</div><p class="hand" style="font-size:17px;margin:4px 0 6px">${esc(c.title)}</p><div class="small muted">${c.days} 天，不用連續，做不到也沒關係</div>
      ${c.answered ? `<p class="small muted" style="margin:8px 0 0">${c.answered === 'yes' ? '你們開始了・在記事本可以打勾' : '你說先不要'}</p>` : `<div class="actions"><button class="btn ghost sm" data-goal="${id}" data-acc="0">先不要</button><button class="btn sm" data-goal="${id}" data-acc="1">好啊</button></div>`}</div></div>`;
    case 'poke': return `<div class="msg me" data-id="${id}"><div class="poke-card"><span class="em">${esc(c.emoji)}</span><span>${esc(c.label)}${c.count > 1 ? `<b>×${c.count}</b>` : ''}</span></div></div>`;
    case 'activity': return `<div class="note" data-id="${id}">${c.state === 'start' ? '▶︎ ' : ''}${esc(c.text)}</div>`;
    case 'postcard': return `<div class="msg him" data-id="${id}">${postcardHtml({ ...c, name: rel.frame.name })}</div>`;
    case 'travelogue': return `<div class="note" data-id="${id}">${ta(rel.frame)}整理好了今天的遊記「${esc(c.title)}」，收在<a href="#/story">我們的故事</a></div>`;
    case 'ended': return `<div class="note" data-id="${id}">${esc(c.text)}</div>`;
    case 'call': return `<div class="note call-note" data-id="${id}">📞 通話 ${Math.floor(c.seconds / 60)}:${String(c.seconds % 60).padStart(2, '0')}</div>`;
    case 'info': return `<div class="note" data-id="${id}">${esc(c.text)}</div>`;
    case 'help': return `<div class="card help-card" data-id="${id}"><h4>${esc(c.title)}</h4>
      ${c.lines.map(l => `<a href="tel:${l.phone}"><span>${esc(l.name)}${l.note ? `<span class="muted small">・${esc(l.note)}</span>` : ''}</span><b>${l.phone}</b></a>`).join('')}
      <p class="small muted" style="margin:8px 0 0">${esc(c.footer)}</p></div>`;
    case 'pin_request': return `<div class="msg him" data-id="${id}"><div class="card" style="margin:0">
      <p class="hand" style="font-size:17px;margin:0 0 8px">${esc(c.text)}</p>
      ${c.answered ? `<p class="small muted" style="margin:0">${c.answered === 'yes' ? '你答應了' : '你說先不要'}</p>` :
      `<div class="actions"><button class="btn ghost sm" data-pin="no" data-msg="${id}">先不要</button><button class="btn rose sm" data-pin="yes" data-msg="${id}">好啊</button></div>`}</div></div>`;
    case 'meal': {
      const done = c.chosen !== undefined || c.declined;
      return `<div class="msg him" data-id="${id}"><div class="card" style="margin:0;max-width:100%;width:86%">
        <h4>${ta(rel.frame)}幫你挑的</h4>
        ${c.options.map(o => `<div class="meal-opt${c.chosen === o.idx ? ' chosen' : ''}"><span class="grow">
          <div class="store">${esc(o.store)}${o.is_trend ? '<span class="new-tag">新品</span>' : ''}</div>
          <div class="item">${esc(o.item)}</div><div class="line">${esc(o.line)}</div></span>
          ${done ? '' : `<button class="btn sm" data-meal="${id}" data-idx="${o.idx}">就這個</button>`}</div>`).join('')}
        ${done ? `<p class="small muted" style="margin:8px 0 0">${c.declined ? '今天先不用' : '已經幫你打開 Uber Eats 了'}</p>` :
        `<div class="actions" style="justify-content:space-between;align-items:center"><span class="small muted">${c.mode === 'api' ? '用 Face ID 確認後下單' : '會打開 Uber Eats，由你確認下單'}</span>
        <button class="linkbtn small" data-meal-no="${id}">今天不用</button></div>`}</div></div>`;
    }
    default: return '';
  }
}

// 照片來源標示（Pexels 規定要標示攝影師）
function creditHtml(p) {
  if (!p || !p.credit || p.source === 'upload' && !p.credit) return '';
  const label = { pexels: '・Pexels', pixabay: '・Pixabay', openverse: '' }[p.source] ?? '';
  const text = `📷 ${esc(p.credit)}${label}`;
  return p.creditUrl ? `<a class="credit" href="${esc(p.creditUrl)}" target="_blank" rel="noopener">${text}</a>` : `<span class="credit">${p.source === 'ai' ? '✨ AI 生成' : text}</span>`;
}
// 明信片：你拍的風景照，或他寄來的風景（寫實照片，沒有照片時用插畫）
function postcardHtml(c, { large = false } = {}) {
  const pic = c.media ? `<img src="${c.media}" alt="${esc(c.place || '明信片照片')}" loading="lazy">`
    : c.photo ? `<img src="${esc(c.photo.url)}" alt="${esc(c.place || '風景')}" loading="lazy">${creditHtml(c.photo)}` : sceneSVG(c.scene || 'city', { label: c.place || '風景' });
  return `<div class="postcard${large ? ' large' : ''}"><div class="pc-pic">${pic}<span class="pc-stamp">${c.from === 'walk' || c.from === 'you' ? '你拍的' : 'WithU'}</span></div>
    <div class="pc-body"><p class="pc-msg">${esc(c.message)}</p>
    <p class="pc-meta">${c.place ? `${esc(c.place)}・` : ''}${c.at ? dateStr(c.at) + '・' : ''}${esc(c.name || '')}</p></div></div>`;
}

async function renderRoom(relId) {
  tabs.hidden = true;
  let rel;
  try { rel = await api(`/api/rels/${relId}`); } catch (e) { toast(e.message); location.hash = '#/chat'; return; }
  if (location.hash !== `#/chat/${relId}`) return; // 等資料時已經換到別頁了
  S.room = { rel, messages: [], sending: false, recorder: null, charReadId: rel.charReadId || 0, presence: rel.presence };
  const sub = () => rel.status !== 'active' ? '這段關係已經結束了' : `${presenceDot(S.room.presence)}${esc(presenceText(S.room.presence))}`;
  const ACT = { watch: '🎬 一起看', focus: '⏳ 陪你專心', bedtime: '🌙 睡前聊聊' };
  app.innerHTML = `<div class="room" data-theme="${esc(rel.theme || 'default')}">
    <header class="room-head">
      <a class="icon-btn" href="#/chat" aria-label="返回聊天列表">${icon('back')}</a>
      <button class="who" id="who">${avatar(rel.frame, 38, { lover: rel.pinned })}<span style="min-width:0">
        <span class="nm">${esc(displayName(rel.frame))}${rel.outing ? '<span class="tag">出遊中</span>' : ''}</span><div class="sub" id="sub">${sub()}</div></span></button>
      <button class="icon-btn mood-head" id="moodBtn" aria-label="心情按鈕">${moodFace()}</button>
      ${rel.status === 'active' ? `<button class="icon-btn" id="callBtn" aria-label="打電話給${ta(rel.frame)}">${icon('phone')}</button>` : ''}
      <button class="icon-btn" id="more" aria-label="聊天室選單">${icon('menu')}</button>
    </header>
    ${rel.activity ? `<div class="walk-banner"><span>${ACT[rel.activity.type] || '一起'}${rel.activity.title ? `：${esc(rel.activity.title)}` : ''}・<span id="actMin"></span></span><button class="linkbtn small" id="actEnd">結束</button></div>` : ''}
    <div class="stream" id="stream"></div>
    ${rel.status === 'active' ? `<div class="composer" id="composer">
      <button class="icon-btn" id="topicBtn" aria-label="話題錦囊" title="不知道說什麼？">${icon('spark')}</button>
      <button class="icon-btn" id="photoBtn" aria-label="傳照片">${icon('photo')}</button>
      <input type="file" id="photoIn" accept="image/*" hidden>
      <textarea id="txt" rows="1" placeholder="跟${ta(rel.frame)}說…" aria-label="訊息"></textarea>
      <button class="icon-btn" id="stkBtn" aria-label="貼圖">${icon('smile')}</button>
      <button class="icon-btn" id="micBtn" aria-label="錄語音">${icon('mic')}</button>
      <button class="icon-btn send" id="sendBtn" aria-label="送出" hidden>${icon('send')}</button>
    </div>
    <div class="stk-panel" id="stkPanel" hidden>${STICKER_LIST.map(([sid, l]) => `<button data-stk="${sid}" aria-label="${l}">${stickerSVG(sid, 64)}</button>`).join('')}</div>
    <div class="composer" id="recComposer" hidden>
      <button class="icon-btn" id="recCancel" aria-label="取消錄音">${icon('x')}</button>
      <div class="rec-bar"><i></i><span id="recT">0:00</span><span class="small">錄音中</span></div>
      <button class="icon-btn send" id="recSend" aria-label="送出語音">${icon('send')}</button>
    </div>` : `<div class="composer"><p class="small muted" style="margin:6px auto">${ta(rel.frame)}留下的信收在「我們的故事」裡。</p></div>`}
  </div>`;
  $('#who').onclick = () => { location.hash = `#/profile/${rel.id}`; };
  $('#more').onclick = () => openRoomMenu(rel);
  $('#moodBtn') && ($('#moodBtn').onclick = () => rel.status === 'active' ? openMoodButton(rel.id) : toast('這段關係已經結束了'));
  $('#callBtn') && ($('#callBtn').onclick = () => openCall(rel));
  const stream = $('#stream');

  const msgs = await api(`/api/rels/${relId}/messages`);
  if (!document.body.contains(stream)) return; // 等資料時已經換到別頁了
  S.room.messages = msgs;
  S.room.firstSceneId = msgs.find(m => m.kind === 'scene')?.id;
  stream.innerHTML = msgs.map((m, i) => messageHtml(m, rel, msgs[i - 1])).join('');
  stream.scrollTop = stream.scrollHeight;
  markRead();
  bindStream(stream);

  if (rel.status !== 'active') return;
  const txt = $('#txt'), sendBtn = $('#sendBtn'), micBtn = $('#micBtn');
  const sync = () => { const has = !!txt.value.trim(); sendBtn.hidden = !has; micBtn.hidden = has; txt.style.height = 'auto'; txt.style.height = Math.min(120, txt.scrollHeight) + 'px'; };
  txt.oninput = () => { sync(); if (queue.length) armFlush(); };
  txt.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer:fine)').matches) { e.preventDefault(); send(); } };
  sendBtn.onclick = () => send();
  // 回覆建議：他最後一則訊息附的 2–3 個好接的回覆
  function drawSuggest() {
    $('#suggest')?.remove();
    if (S.me?.settings?.showSuggestions === false) return;
    const last = S.room.messages.filter(m => typeof m.id === 'number' && m.kind !== 'card' && m.kind !== 'sticker' || (m.card && ['meal', 'pin_request', 'postcard'].includes(m.card.type))).at(-1);
    if (!last || last.sender !== 'char' || !last.suggest?.length) return;
    const box = document.createElement('div');
    box.id = 'suggest'; box.className = 'suggest';
    const items = last.suggest.map(x => typeof x === 'string' ? { label: x, text: x } : x);
    // 先只放一顆小按鈕，按了才展開三個方向：不讓人覺得「預設就是要講這些」
    box.innerHTML = `<button class="chip sug-toggle" aria-expanded="false">💡 不知道怎麼回？</button>`;
    $('#composer').before(box);
    $('.sug-toggle', box).onclick = () => {
      box.innerHTML = items.map((x, i) => `<button class="chip" data-i="${i}" title="${esc(x.text)}">${esc(x.label)}</button>`).join('');
      bindChips();
      track('suggest_open', {});
    };
    function bindChips() {
    // 點方向 → 幫你寫好一句放進輸入框，可以改了再送
    $$('.chip', box).forEach(c => c.onclick = () => { txt.value = items[c.dataset.i].text; sync(); txt.focus(); txt.setSelectionRange(txt.value.length, txt.value.length); track('suggest_pick', { label: items[c.dataset.i].label }); });
    }
  }
  S.room.drawSuggest = drawSuggest;
  drawSuggest();
  $('#photoBtn').onclick = () => $('#photoIn').click();
  $('#photoIn').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const blob = await shrinkImage(f);
    const fd = new FormData(); fd.append('photo', blob, 'photo.jpg');
    if (txt.value.trim()) { fd.append('text', txt.value.trim()); txt.value = ''; sync(); }
    send(fd, URL.createObjectURL(blob));
  };
  micBtn.onclick = () => startRecording();
  $('#topicBtn').onclick = () => openTopicBag();
  $('#stkBtn').onclick = () => { const p = $('#stkPanel'); p.hidden = !p.hidden; if (!p.hidden) stream.scrollTop = stream.scrollHeight; };
  $$('[data-stk]').forEach(b => b.onclick = () => { $('#stkPanel').hidden = true; sendSticker(b.dataset.stk); });
  function sendSticker(sid) {
    queueSend({ sender: 'user', kind: 'sticker', card: { id: sid }, text: '' }, () => api(`/api/rels/${relId}/messages`, { method: 'POST', body: { sticker: sid, quiet: true } }), 4);
  }
  $('#actEnd') && ($('#actEnd').onclick = async () => {
    if (S.room.sending) return toast(`等${ta(rel.frame)}回完這一則`);
    S.room.sending = true;
    try { const r = await api(`/api/rels/${relId}/activity/end`, { method: 'POST' }); await revealSequential(r.messages || []); } catch (e) { toast(e.message); }
    S.room.sending = false;
    renderRoom(relId);
  });
  if (rel.activity) {
    const tickAct = () => { const n = $('#actMin'); if (!n) return; const a = rel.activity;
      n.textContent = a.type === 'focus' ? `還有 ${Math.max(1, Math.ceil((a.ends_at - Date.now()) / 60000))} 分鐘` : `${Math.max(1, Math.round((Date.now() - a.started_at) / 60000))} 分鐘`; };
    tickAct(); S.timers.push(setInterval(tickAct, 20000));
  }

  async function openTopicBag() {
    let t;
    try { t = await api(`/api/rels/${relId}/topics`); } catch (e) { return toast(e.message); }
    const P = ta(rel.frame);
    openSheet(`<h3>話題錦囊</h3>
      <button class="choice" id="tbLead"><b>💬 ${P}帶我聊</b><span>不知道要說什麼？讓${P}開個話題</span></button>
      <div class="list-label">問${P}一件事</div><div class="tb-chips">${t.ask.map((q, i) => `<button class="chip" data-ask="${i}">${esc(q)}</button>`).join('')}</div>
      <div class="list-label">玩個小遊戲</div><div class="tb-grid">${t.games.map(g => `<button class="tb-item" data-game="${g.id}"><b>${esc(g.label)}</b><span>${esc(g.desc)}</span></button>`).join('')}</div>
      <div class="list-label">一起做點什麼</div><div class="tb-grid">${t.activities.map(a => `<button class="tb-item" data-act="${a.id}" ${rel.activity && a.id !== 'meal' ? 'disabled' : ''}><b>${esc(a.label)}</b><span>${esc(a.desc)}</span></button>`).join('')}</div>
      <button class="choice" id="tbPhoto" style="margin-top:12px"><b>📷 分享一張照片</b><span>拍下你現在看到的，${P}會回應你</span></button>`, (sh, close) => {
      $('#tbLead', sh).onclick = () => { close(); nudge({ kind: 'lead' }); };
      $$('[data-ask]', sh).forEach(b => b.onclick = () => { close(); txt.value = t.ask[b.dataset.ask]; sync(); txt.focus(); });
      $$('[data-game]', sh).forEach(b => b.onclick = () => { close(); nudge({ kind: 'game', id: b.dataset.game }); });
      $$('[data-act]', sh).forEach(b => b.onclick = () => {
        const id = b.dataset.act;
        if (id === 'watch') {
          sh.innerHTML = `<div class="grab"></div><h3>一起看什麼？</h3><input class="input" id="wTitle" maxlength="30" placeholder="劇名或電影（可以不填，讓${P}推薦）">
            <button class="btn block" id="wGo" style="margin-top:12px">開始</button>`;
          $('#wGo', sh).onclick = () => { const title = $('#wTitle', sh).value.trim(); close(); nudge({ kind: 'activity', id, title }); };
          return;
        }
        close(); nudge({ kind: 'activity', id });
      });
      $('#tbPhoto', sh).onclick = () => { close(); $('#photoIn').click(); };
    });
  }

  async function nudge(body) {
    if (queue.length) { clearTimeout(flushT); await flush(); }
    if (S.room.sending) return toast(`等${ta(rel.frame)}回完這一則`);
    track('topic_bag', { kind: body.kind, id: body.id || null });
    await exchange(() => api(`/api/rels/${relId}/nudge`, { method: 'POST', body }), 8);
    if (body.kind === 'activity' && body.id !== 'meal') renderRoom(relId);
  }

  // 送出後的節奏：已讀 → 打字 → 一則一則出現；他在忙就先顯示「可能晚點回」
  // nodes：這一批要被正式訊息取代的本地泡泡（連傳時只換掉這一批）
  async function exchange(call, len, nodes = null) {
    const locals = () => nodes || $$('.local', stream);
    S.room.sending = true;
    $('#suggest')?.remove();
    const t0 = Date.now();
    const quick = S.me?.settings?.realisticDelay === false || S.room.presence?.code === 'online' || /偷空/.test(S.room.presence?.label || '');
    const rd = readMs(len);
    let typing = null, typingAt = 0;
    const readTimer = quick ? setTimeout(() => { markLocalRead(nodes); typing = showTyping(); typingAt = Date.now(); }, rd) : null;
    let ok = true;
    try {
      const r = await call();
      const res = Array.isArray(r) ? { messages: r } : r;
      if (res.capped && !(res.messages || []).some(m => m.sender === 'char')) toast(`${ta(rel.frame)}今天先休息了，明天再聊`);
      clearTimeout(readTimer);
      if (res.pending) {
        typing?.remove();
        locals().forEach(n => n.remove());
        await revealSequential(res.messages || [], {});
        S.room.presence = res.pending.presence;
        $('#sub').innerHTML = sub();
        showPendingNote(res.pending);
        return;
      }
      await sleep(t0 + rd - Date.now());
      if (!typing) { markLocalRead(nodes); typing = showTyping(); typingAt = Date.now(); }
      locals().forEach(n => n.remove());
      await revealSequential(res.messages || [], { typing, typingAt });
    } catch (e) {
      clearTimeout(readTimer); typing?.remove(); ok = e.status === 429 ? 'busy' : false; if (ok !== 'busy') toast(e.message);
    } finally { S.room.sending = false; }
    return ok;
  }
  function markLocalRead(nodes) {
    (nodes ? nodes.flatMap(n => $$('.msg.me .time', n)) : $$('.local .msg.me .time', stream)).forEach(t => { if (!$('.read', t)) t.insertAdjacentHTML('afterbegin', '<span class="read">已讀</span>'); });
  }
  function refreshReads() {
    $$('.msg.me[data-id]', stream).forEach(m => {
      const id = Number(m.dataset.id), t = $('.time', m);
      if (id && id <= S.room.charReadId && t && !$('.read', t)) t.insertAdjacentHTML('afterbegin', '<span class="read">已讀</span>');
    });
  }
  function showPendingNote(p) {
    $('#pendingNote')?.remove();
    const d = document.createElement('div');
    d.id = 'pendingNote'; d.className = 'note pending-note';
    const P = displayName(rel.frame);
    d.textContent = p.presence?.code === 'dnd' ? `${P}睡了，醒來會回你` : p.presence?.code === 'busy' ? `${P}在上班，可能晚點回` : `${P}現在不在線上，等等會回你`;
    stream.appendChild(d); stream.scrollTop = stream.scrollHeight;
  }
  if (rel.pendingReplyAt) showPendingNote({ presence: rel.presence });

  // 像 LINE：可以一直傳，每則先存起來；停下來約 3.5 秒（或打字中最久 20 秒）後，他一次讀完再回
  const queue = S.room.queue = [];
  let flushT = null, chain = Promise.resolve(), batchSince = null, lastSendAt = 0;
  const lastKnownId = () => S.room.messages.filter(m => typeof m.id === 'number').at(-1)?.id || 0;
  function armFlush(ms = 3500) { clearTimeout(flushT); flushT = setTimeout(flush, ms); }
  function queueSend(local, req, len) {
    const node = appendLocal(local);
    if (batchSince == null) batchSince = lastKnownId();
    const item = { node, len, id: null };
    queue.push(item);
    lastSendAt = Date.now();
    chain = chain.then(async () => {
      try {
        item.id = (await req()).id;
        // 照片：先沿用手機上的預覽，不用等伺服器的圖載完才看得到
        if (local.kind === 'photo' && local.media && item.id) (S.room.previews ||= {})[item.id] = local.media;
      }
      catch (e) { node.remove(); { const i = queue.indexOf(item); if (i >= 0) queue.splice(i, 1); } toast(e.message); }
    });
    armFlush();
  }
  async function flush() {
    if (!queue.length) return;
    if (S.room.rel?.id !== relId) { // 已經離開聊天室：在背景請他回，回覆會出現在聊天列表
      await chain; const ids = queue.splice(0).map(b => b.id).filter(Boolean);
      if (ids.length) api(`/api/rels/${relId}/reply`, { method: 'POST', body: { since: 0, upto: Math.max(...ids) } }).catch(() => {});
      return;
    }
    if (S.room.sending) return armFlush(1500);
    if (txt.value.trim() && Date.now() - lastSendAt < 20000) return armFlush(2000);
    await chain;
    const batch = queue.splice(0);
    const since = batchSince ?? lastKnownId(); batchSince = null;
    const ids = batch.map(b => b.id).filter(Boolean);
    if (!ids.length) return;
    const len = batch.reduce((a, b) => a + b.len, 0);
    const ok = await exchange(() => api(`/api/rels/${relId}/reply`, { method: 'POST', body: { since, upto: Math.max(...ids) } }), len, batch.map(b => b.node));
    if (ok === 'busy') { queue.unshift(...batch); batchSince = since; armFlush(4000); return; }
    if (queue.length) armFlush(1500);
  }
  function send(form, previewUrl) {
    if (!form) {
      const text = txt.value.trim(); if (!text) return;
      txt.value = ''; sync();
      queueSend({ sender: 'user', kind: 'text', text }, () => api(`/api/rels/${relId}/messages`, { method: 'POST', body: { text, quiet: true } }), text.length);
      return;
    }
    form.append('quiet', '1');
    queueSend(previewUrl ? { sender: 'user', kind: 'photo', media: previewUrl, text: form.get('text') } : { sender: 'user', kind: 'voice', media: null, text: '（語音訊息）' },
      () => api(`/api/rels/${relId}/messages`, { method: 'POST', form }), 10);
  }

  function appendLocal(m) {
    const div = document.createElement('div');
    div.className = 'local';
    div.innerHTML = messageHtml({ ...m, id: 'local', at: Date.now() }, rel, S.room.messages.at(-1));
    stream.appendChild(div);
    stream.scrollTop = stream.scrollHeight;
    return div;
  }
  function showTyping() {
    const d = document.createElement('div');
    d.className = 'msg him typing';
    d.innerHTML = '<div class="bubble"><i></i><i></i><i></i></div>';
    let gone = false;
    stream.appendChild(d); stream.scrollTop = stream.scrollHeight;
    return { remove: () => { gone = true; d.remove(); } };
  }
  // 同一時間只跑一個「訊息浮現」流程，而且每則訊息一出現就先登記：
  // 不然背景輪詢和你送出後的回覆同時在顯示，同一則會出現兩次
  const claimed = new Set(S.room.messages.map(m => m.id));
  let revealChain = Promise.resolve();
  function revealSequential(fresh, opts = {}) {
    const run = revealChain.then(() => revealNow(fresh, opts));
    revealChain = run.catch(() => {});
    return run;
  }
  async function revealNow(fresh, { typing = null, typingAt = 0 } = {}) {
    let first = true, gotChar = false;
    for (const m of fresh) {
      const prev = S.room.messages.at(-1);
      if (claimed.has(m.id) || S.room.messages.some(x => x.id === m.id)) continue;
      claimed.add(m.id);
      if (m.sender === 'char' && m.kind !== 'card') {
        gotChar = true;
        $('#pendingNote')?.remove();
        if (first && typing) { await sleep(typeMs(m) - (Date.now() - typingAt)); typing.remove(); typing = null; }
        else { if (!first) await sleep(jitter(900)); const t = showTyping(); await sleep(typeMs(m)); t.remove(); }
        first = false;
      }
      S.room.messages.push(m);
      if (m.sender === 'char') S.room.charReadId = Math.max(S.room.charReadId, ...S.room.messages.filter(x => x.sender === 'user' && typeof x.id === 'number').map(x => x.id), 0);
      const wrap = document.createElement('div');
      wrap.className = 'reveal';
      wrap.innerHTML = messageHtml(m, rel, prev);
      stream.appendChild(wrap);
      bindStream(wrap);
      stream.scrollTop = stream.scrollHeight;
      if (['ended', 'outing'].includes(m.card?.type) || (m.card?.type === 'activity')) { typing?.remove(); setTimeout(() => renderRoom(relId), 1500); return; }
    }
    typing?.remove();
    if (gotChar) { S.room.presence = { code: 'online', label: '上線中' }; $('#sub') && ($('#sub').innerHTML = sub()); refreshReads(); setTimeout(() => maybeAskNotify(rel), 1800); }
    markRead();
    S.room.drawSuggest?.();
  }
  S.room.reveal = revealSequential;

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) return toast('這個瀏覽器不能錄音');
    let stream0;
    try { stream0 = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('需要麥克風權限才能錄語音'); }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
    const rec = new MediaRecorder(stream0, type ? { mimeType: type } : undefined);
    const chunks = []; const started = Date.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const comp = $('#composer'), recC = $('#recComposer');
    comp.hidden = true; recC.hidden = false; $('#recT').textContent = '0:00';
    const timer = setInterval(() => { const s = Math.round((Date.now() - started) / 1000); $('#recT').textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`; if (s >= 60) $('#recSend').click(); }, 500);
    const stop = (sendIt) => {
      clearInterval(timer);
      rec.onstop = () => {
        stream0.getTracks().forEach(t => t.stop());
        comp.hidden = false; recC.hidden = true;
        if (!sendIt) return;
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 1500) return toast('太短了，再錄一次');
        const fd = new FormData();
        fd.append('voice', blob, (rec.mimeType || '').includes('mp4') ? 'voice.m4a' : 'voice.webm');
        fd.append('duration', String(Math.round((Date.now() - started) / 1000)));
        send(fd);
      };
      rec.stop();
    };
    $('#recCancel').onclick = () => stop(false);
    $('#recSend').onclick = () => stop(true);
    rec.start();
  }

  // poll for proactive messages while the room is open
  S.timers.push(setInterval(async () => {
    if (document.visibilityState !== 'visible' || S.room.sending || queue.length) return;
    const lastId = S.room.messages.filter(m => typeof m.id === 'number').at(-1)?.id || 0;
    try { const fresh = await api(`/api/rels/${relId}/messages?after=${lastId}`); if (fresh.length) await revealSequential(fresh); } catch {}
  }, 8000));
  S.timers.push(setInterval(async () => {
    if (document.visibilityState !== 'visible' || S.room.sending) return;
    try { const r = await api(`/api/rels/${relId}`); S.room.presence = r.presence; $('#sub').innerHTML = sub(); } catch {}
  }, 60000));

  function markRead() {
    const lastId = S.room.messages.filter(m => typeof m.id === 'number').at(-1)?.id;
    if (lastId) api(`/api/rels/${relId}/read`, { method: 'POST', body: { lastId } }).then(() => { badgeAt = 0; }).catch(() => {});
  }
}

// ---------- 角色個人頁（像 LINE 的主頁）----------
async function renderProfile(relId) {
  tabs.hidden = true;
  let p;
  try { p = await api(`/api/rels/${relId}/profile`); } catch (e) { toast(e.message); location.hash = '#/chat'; return; }
  const f = p.frame, P = ta(f);
  const days = (f.schedule?.days || []).map(d => '日一二三四五六'[d]).join('、');
  app.innerHTML = `<div class="profile">
    <div class="cover">${sceneSVG(p.cover, { label: `${f.name}工作的地方` })}
      <a class="icon-btn cover-back" href="#/chat/${p.id}" aria-label="回到聊天">${icon('back')}</a></div>
    <div class="pf-head">${(() => { const m = p.photos?.find(x => x.kind === 'main' && x.level === 'c'); return m ? `<span class="pf-face"><img src="${esc(m.url)}" alt="${esc(f.name)}（AI 生成）"></span>` : avatar(f, 96, { lover: p.pinned, season: true }); })()}
      <h1 class="pf-name">${esc(displayName(f))}</h1>
      ${p.signature ? `<p class="signature">${esc(p.signature)}</p>` : `<p class="signature muted">${P}還沒有寫個性簽名</p>`}
      <p class="pf-pres small">${presenceDot(p.presence)}${esc(presenceText(p.presence))}</p>
      ${p.statusLine && Date.now() - p.statusLineAt < 24 * 3600e3 ? `<p class="pf-mood">「${esc(p.statusLine)}」<span class="muted small">・${ago(p.statusLineAt)}</span></p>` : ''}
      <div class="pf-chips"><span>${esc(f.age)} 歲</span><span>${esc(f.nationality)}</span><span>${esc(f.jobLabel)}</span>${p.mode === 'practice' ? `<span>${esc(p.stageLabel)}</span>` : ''}</div>
      <div class="pf-actions"><a class="btn" href="#/chat/${p.id}" style="text-decoration:none">聊天</a><button class="btn ghost" id="pfSet">設定</button></div>
    </div>
    <div class="page pf-body">
      <div class="section">
        <div class="row"><span class="muted small" style="width:64px">關於</span><span class="grow">${esc(f.intro || '')}</span></div>
        ${f.catchphrases?.length ? `<div class="row"><span class="muted small" style="width:64px">常說</span><span class="grow hand" style="font-size:16px">${f.catchphrases.map(x => `「${esc(x)}」`).join(' ')}</span></div>` : ''}
        <div class="row"><span class="muted small" style="width:64px">上班</span><span class="grow">星期${esc(days)}・${esc(f.schedule?.start)}–${esc(f.schedule?.end)}</span></div>
        ${p.weekend ? `<div class="row"><span class="muted small" style="width:64px">休假</span><span class="grow">${esc(p.weekend)}</span></div>` : ''}
      </div>
      ${p.photos?.length ? `<h2>${P}的照片 <span class="small muted">AI 生成的虛構人物</span></h2>
      <div class="pf-photos">${p.photos.map(ph => {
        const lockText = ph.paid ? '付費解鎖・即將推出' : ph.kind === 'main' && ph.level !== 'c' ? '成為朋友後看清楚' : ph.locked ? `${['', '朋友', '曖昧', '交往'][ph.minStage] || ''}後解鎖` : '';
        return `<button class="pf-ph${ph.level !== 'c' ? ' locked' : ''}" data-ph="${ph.id}" data-lv="${ph.level}" data-paid="${ph.paid ? 1 : 0}"><img src="${esc(ph.url)}" alt="${esc(ph.caption || '照片')}" loading="lazy">${lockText ? `<span class="pf-lock">${ph.paid ? '✦' : '🔒'} ${esc(lockText)}</span>` : ''}</button>`;
      }).join('')}</div>` : ''}
      <h2>${P}的動態</h2>
      ${p.posts.length ? `<div class="posts">${p.posts.map(x => `<article class="post">${avatar(f, 36, { season: false })}<div class="grow"><div class="post-text hand">${esc(x.text)}</div>${x.photo ? `<div class="fp-photo sm"><img src="${esc(x.photo.url)}" alt="" loading="lazy">${creditHtml(x.photo)}</div>` : ''}<time>${ago(x.at)}</time></div></article>`).join('')}</div>`
        : `<p class="muted small">${P}分享生活的時候，會留在這裡。</p>`}
    </div></div>`;
  $('#pfSet').onclick = async () => openCharSheet(await api(`/api/rels/${relId}`));
  $$('[data-ph]').forEach(b => b.onclick = () => {
    const ph = p.photos.find(x => String(x.id) === b.dataset.ph);
    if (ph.paid) {
      track('coming_soon_click', { item: 'portrait_unlock' });
      return openSheet(`<h3>提早解鎖${P}的照片</h3><p>之後可以付費提早看到${P}的限定照片。如果要付費，你覺得多少錢合理？</p>
        <div class="chips">${[0, 30, 60, 90, 150].map(x => `<button class="chip" data-price="${x}">${x === 0 ? '不會買' : `NT$${x}`}</button>`).join('')}</div>
        <p class="small muted" style="margin-top:14px">只是問問，測試期間不會收費。不付費也會隨著你們的關係慢慢解鎖大部分的照片。</p>`, (sheet, close) => {
        $$('[data-price]', sheet).forEach(c => c.onclick = () => { track('coming_soon_price', { item: 'portrait_unlock', price: Number(c.dataset.price) }); close(); toast('謝謝你告訴我們'); });
      });
    }
    if (ph.level !== 'c') return toast(ph.kind === 'main' ? `你們成為朋友後，就能看清楚${P}` : `你們的關係再近一點，就能看到這張`);
    openSheet(`<div class="pf-big"><img src="${esc(ph.url)}" alt="${esc(ph.caption || '')}"><i class="ai-tag">AI 生成</i></div>${ph.caption ? `<p class="muted small" style="text-align:center;margin-top:8px">${esc(ph.caption)}</p>` : ''}`);
  });
}

let currentAudio = null;
function bindStream(root) {
  $$('[data-choice]', root).forEach(b => b.onclick = async () => {
    const relId = S.room?.rel?.id; if (!relId || S.room.sending) return;
    S.room.sending = true; $$('[data-choice]', root).forEach(x => x.disabled = true);
    try { const r = await api(`/api/rels/${relId}/choice`, { method: 'POST', body: { msgId: Number(b.dataset.choice), idx: Number(b.dataset.idx) } }); S.room.sending = false; renderRoom(relId); } catch (e) { toast(e.message); S.room.sending = false; }
  });
  $$('[data-goal]', root).forEach(b => b.onclick = async () => {
    const relId = S.room?.rel?.id; if (!relId || S.room.sending) return;
    S.room.sending = true; $$('[data-goal]', root).forEach(x => x.disabled = true);
    try { await api(`/api/rels/${relId}/goal`, { method: 'POST', body: { msgId: Number(b.dataset.goal), accept: b.dataset.acc === '1' } }); S.room.sending = false; renderRoom(relId); } catch (e) { toast(e.message); S.room.sending = false; }
  });
  $$('[data-audio]', root).forEach(b => b.onclick = () => {
    if (!b.dataset.audio || b.dataset.audio === 'null') return;
    if (currentAudio) { currentAudio.pause(); }
    const a = new Audio(b.dataset.audio);
    currentAudio = a;
    const bars = $$('.wave i', b.parentElement);
    a.ontimeupdate = () => { const p = a.currentTime / (a.duration || 1); bars.forEach((x, i) => x.classList.toggle('on', i / bars.length <= p)); };
    a.onended = () => bars.forEach(x => x.classList.remove('on'));
    a.play().catch(() => toast('播放失敗'));
  });
  $$('[data-tx]', root).forEach(b => b.onclick = () => { const t = b.nextElementSibling; t.hidden = !t.hidden; b.textContent = t.hidden ? '轉文字' : '收起'; });
  $$('[data-meal]', root).forEach(b => b.onclick = async () => {
    // open the window first (synchronously) so iOS doesn't block it as a popup
    const w = window.open('about:blank', '_blank');
    try {
      const r = await api(`/api/meal/${b.dataset.meal}/choose`, { method: 'POST', body: { idx: Number(b.dataset.idx) } });
      if (w) w.location = r.url; else location.href = r.url;
      const card = b.closest('[data-id]');
      card.querySelectorAll('[data-meal]').forEach(x => x.remove());
      b.closest('.meal-opt')?.classList.add('chosen');
      card.querySelector('.actions')?.replaceWith(Object.assign(document.createElement('p'), { className: 'small muted', textContent: '已經幫你打開 Uber Eats 了' }));
    } catch (e) { w?.close(); toast(e.message); }
  });
  $$('[data-meal-no]', root).forEach(b => b.onclick = async () => {
    await api(`/api/meal/${b.dataset.mealNo}/decline`, { method: 'POST' }).catch(() => {});
    const card = b.closest('[data-id]');
    card.querySelectorAll('[data-meal]').forEach(x => x.remove());
    b.closest('.actions').replaceWith(Object.assign(document.createElement('p'), { className: 'small muted', textContent: '今天先不用' }));
  });
  $$('[data-pin]', root).forEach(b => b.onclick = async () => {
    const relId = S.room.rel.id;
    b.closest('.actions').innerHTML = '<span class="small muted">……</span>';
    try {
      await api(`/api/rels/${relId}/pin`, { method: 'POST', body: { accept: b.dataset.pin === 'yes', msgId: Number(b.dataset.msg) } });
      renderRoom(relId);
    } catch (e) { toast(e.message); }
  });
}

async function shrinkImage(file, max = 1280) {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.85));
}

// ---------- character sheet ----------
// 系統主題與吉祥物
function applyAppTheme(t) {
  const theme = APP_THEMES.some(([k]) => k === t) ? t : 'milk';
  document.documentElement.dataset.app = theme;
  try { localStorage.setItem('appTheme', theme); } catch {}
  const bar = { milk: ['#F7EEF0', '#1F1820'], night: ['#16142C', '#16142C'], forest: ['#FFFFFF', '#0F1813'] }[theme];
  document.querySelectorAll('meta[name="theme-color"]').forEach((m, i) => { m.content = bar[i] || bar[0]; });
}
const moodFace = (face = 'idle') => mascotSVG(document.documentElement.dataset.app || 'milk', face);
// ---------- 心情按鈕：不想打字時按一按，連按越多下代表越強烈 ----------
async function openMoodButton(relId = null) {
  const ok = sheetGuard();
  const rels = (S.rels.length ? S.rels : await api('/api/rels')).filter(r => r.status === 'active');
  if (!ok()) return;
  if (!rels.length) return toast('先去認識一個人吧');
  let target = relId || (rels.find(r => r.pinned) || rels.slice().sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0))[0]).id;
  const stageOf = (id) => rels.find(r => r.id === id)?.stage ?? 0;
  const emosFor = (id) => (S.meta.emotions || []).filter(e => (e.minStage || 0) <= stageOf(id));
  const nameOf = (id) => esc(displayName(rels.find(r => r.id === id)?.frame || {}));
  const EMOJIS = ['💭', '🫠', '😵‍💫', '🥲', '😑', '🤯', '😮‍💨', '🙃', '🥹', '😳', '🤔', '🌧️', '☀️', '🔥', '💤', '🍀'];
  let emos = emosFor(target);
  openSheet(`<div class="mood-head-art">${moodFace('happy')}</div><h3>現在的心情是？</h3><p class="small muted" id="mdSub">按一下就會傳給${relId ? nameOf(relId) : 'TA'}；連按越多下，代表越強烈。</p>
    ${relId ? '' : `<div class="mood-to">${rels.map(r => `<button data-to="${r.id}" aria-pressed="${r.id === target}">${avatar(r.frame, 40, { season: false })}<span>${esc(displayName(r.frame))}</span></button>`).join('')}</div>`}
    <div id="mdMain">
      <div class="mood-special"><button class="mood-unsure" id="mdUnsure"><span class="em">🌀</span><span><b>說不出來</b><small>不知道是什麼感覺？一步一步陪你找</small></span></button>
        <button class="mood-custom" id="mdCustom"><span class="em">✏️</span><span><b>自己寫</b><small>用你的話說現在的心情</small></span></button></div>
      <div id="mdGroups"></div>
    </div>
    <div id="mdFlow" hidden></div>
    <div class="mood-press" id="mp" hidden><button class="mood-big" id="mpBtn" aria-label="再按一下"><span id="mpEmo"></span></button><div class="mood-count"><b id="mpN">1</b> 下・<span id="mpHint">繼續按，或等一下就會送出</span></div></div>`, (sh, close) => {
    let emo = null, count = 0, timer = null, body = null;
    const mine = () => (S.me?.settings?.customMoods || []);
    const drawEmos = () => {
      const groups = S.meta.emotionGroups || [...new Set(emos.map(e => e.group))];
      $('#mdGroups', sh).innerHTML = (mine().length ? `<div class="mood-group"><div class="mg-title">我的心情</div><div class="mood-grid2">${mine().map((m, i) => `<button class="mood-btn" data-mine="${i}"><span class="em">${esc(m.emoji)}</span><span>${esc(m.label)}</span></button>`).join('')}</div></div>` : '')
        + groups.map(g => { const list = emos.filter(e => e.group === g); return list.length ? `<div class="mood-group"><div class="mg-title">${esc(g)}</div><div class="mood-grid2">${list.map(e => `<button class="mood-btn" data-emo="${e.id}"><span class="em">${e.emoji}</span><span>${esc(e.label)}</span></button>`).join('')}</div></div>` : ''; }).join('');
      $$('[data-emo]', sh).forEach(b => b.onclick = (ev) => { emo = emos.find(x => x.id === b.dataset.emo); body = { emotion: emo.id }; startPress(ev); });
      $$('[data-mine]', sh).forEach(b => b.onclick = (ev) => { const m = mine()[b.dataset.mine]; emo = { emoji: m.emoji, label: m.label }; body = { custom: m }; startPress(ev); });
    };
    const startPress = (ev) => {
      $('#mdMain', sh).hidden = true; $('#mdFlow', sh).hidden = true; $('.mood-to', sh) && ($('.mood-to', sh).hidden = true);
      $('#mp', sh).hidden = false; $('#mpEmo', sh).textContent = emo.emoji;
      press(ev);
    };
    $$('[data-to]', sh).forEach(b => b.onclick = () => { target = b.dataset.to; emos = emosFor(target); drawEmos(); $$('[data-to]', sh).forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    const burst = (x, y) => {
      for (let i = 0; i < 6; i++) {
        const p = document.createElement('span');
        p.className = 'mood-particle'; p.textContent = emo.emoji;
        p.style.left = x + 'px'; p.style.top = y + 'px';
        p.style.setProperty('--dx', `${(Math.random() - .5) * 180}px`); p.style.setProperty('--dy', `${-60 - Math.random() * 140}px`); p.style.setProperty('--r', `${(Math.random() - .5) * 90}deg`);
        document.body.appendChild(p); setTimeout(() => p.remove(), 900);
      }
    };
    const send = async (extra = {}) => {
      close();
      const r = rels.find(x => x.id === target);
      try {
        const res = await api(`/api/rels/${target}/poke`, { method: 'POST', body: { ...body, ...extra, count } });
        if (body.custom && S.me?.settings) S.me.settings.customMoods = [body.custom, ...mine().filter(x => x.label !== body.custom.label)].slice(0, 6);
        track('poke', { emotion: body.emotion || (body.custom ? 'custom' : 'unsure'), count });
        if (location.hash === `#/chat/${target}` && S.room?.reveal) { await S.room.reveal(res.messages || []); if (res.pending) toast(`${displayName(r.frame)}現在不在線上，看到會回你`); }
        else toast(res.pending ? `${displayName(r.frame)}現在${res.pending.presence?.code === 'dnd' ? '睡了' : '在忙'}，看到會回你` : `已經讓${displayName(r.frame)}知道了`);
      } catch (e) { toast(e.message); }
    };
    const press = (ev) => {
      count++;
      $('#mpN', sh).textContent = count;
      const big = $('#mpBtn', sh); big.classList.remove('pop'); void big.offsetWidth; big.classList.add('pop');
      const rect = big.getBoundingClientRect();
      burst(ev?.clientX || rect.left + rect.width / 2, ev?.clientY || rect.top + rect.height / 2);
      try { navigator.vibrate?.(12); } catch {}
      $('#mpHint', sh).textContent = count >= 15 ? '爆表了！' : count >= 6 ? '很強烈喔' : '繼續按，或等一下就會送出';
      clearTimeout(timer); timer = setTimeout(() => send(), 1600);
    };
    const flow = (html) => { $('#mdMain', sh).hidden = true; $('.mood-to', sh) && ($('.mood-to', sh).hidden = true); const f = $('#mdFlow', sh); f.hidden = false; f.innerHTML = html; return f; };
    const backBtn = '<button class="linkbtn small" id="mdBack">← 回到心情</button>';
    const bindBack = (f) => { $('#mdBack', f).onclick = () => { $('#mdFlow', sh).hidden = true; $('#mdMain', sh).hidden = false; $('.mood-to', sh) && ($('.mood-to', sh).hidden = false); $('#mdSub', sh).textContent = '按一下就會傳出去；連按越多下，代表越強烈。'; }; };

    // 自己寫心情
    $('#mdCustom', sh).onclick = () => {
      let pick = EMOJIS[0];
      const f = flow(`${backBtn}<p class="mg-title" style="margin-top:10px">選一個表情</p><div class="emoji-row">${EMOJIS.map((e, i) => `<button data-em="${i}" aria-pressed="${i === 0}">${e}</button>`).join('')}</div>
        <input class="input" id="mdText" maxlength="12" placeholder="例如：被會議淹沒、想吃甜的" style="margin-top:12px"><button class="btn block" id="mdGo" style="margin-top:12px">傳給${nameOf(target)}</button>`);
      bindBack(f);
      $$('[data-em]', f).forEach(b => b.onclick = () => { pick = EMOJIS[b.dataset.em]; $$('[data-em]', f).forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
      $('#mdText', f).focus();
      $('#mdGo', f).onclick = () => { const label = $('#mdText', f).value.trim(); if (!label) return toast('寫一下現在的心情'); body = { custom: { emoji: pick, label } }; emo = { emoji: pick, label }; count = 1; send(); };
    };

    // 說不出來：身體 → 強度與方向 → 候選詞
    $('#mdUnsure', sh).onclick = () => {
      const st = { body: [], level: 3, dir: null };
      $('#mdSub', sh).textContent = '說不出來很正常。我們先從身體開始，一步一步來。';
      const step1 = () => {
        const f = flow(`${backBtn}<p class="mg-title" style="margin-top:10px">1／3　身體哪裡最有感覺？（可以選幾個）</p>
          <div class="chips wrap">${(S.meta.bodyFeelings || []).map(x => `<button class="chip" data-body="${esc(x)}" aria-pressed="${st.body.includes(x)}">${esc(x)}</button>`).join('')}</div>
          <button class="btn block" id="s1" style="margin-top:14px">下一步</button>`);
        bindBack(f);
        $$('[data-body]', f).forEach(b => b.onclick = () => { const x = b.dataset.body; st.body = st.body.includes(x) ? st.body.filter(y => y !== x) : [...st.body, x].slice(0, 4); b.setAttribute('aria-pressed', String(st.body.includes(x))); });
        $('#s1', f).onclick = () => st.body.length ? step2() : toast('選一個最接近的就好');
      };
      const step2 = () => {
        const f = flow(`<button class="linkbtn small" id="b2">← 上一步</button><p class="mg-title" style="margin-top:10px">2／3　有多強烈？</p>
          <div class="level-row">${[1, 2, 3, 4, 5].map(n => `<button data-lv="${n}" aria-pressed="${n === st.level}">${n}</button>`).join('')}</div><div class="small muted level-cap"><span>一點點</span><span>快受不了</span></div>
          <p class="mg-title" style="margin-top:16px">現在比較想……</p>
          <div class="dir-list">${(S.meta.directions || []).map(d => `<button class="choice" data-dir="${d.id}"><b>${esc(d.label)}</b></button>`).join('')}</div>`);
        $('#b2', f).onclick = step1;
        $$('[data-lv]', f).forEach(b => b.onclick = () => { st.level = Number(b.dataset.lv); $$('[data-lv]', f).forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
        $$('[data-dir]', f).forEach(b => b.onclick = () => { st.dir = b.dataset.dir; step3(); });
      };
      const step3 = async () => {
        let words = [];
        try { words = await api(`/api/mood/words?body=${encodeURIComponent(st.body.join(','))}&dir=${st.dir}`); } catch {}
        const f = flow(`<button class="linkbtn small" id="b3">← 上一步</button><p class="mg-title" style="margin-top:10px">3／3　哪一個比較像現在的你？</p>
          <p class="small muted">不用很準，選最接近的。都不像也沒關係。</p>
          <div class="chips wrap">${words.map(w => `<button class="chip" data-word="${esc(w)}">${esc(w)}</button>`).join('')}<button class="chip ghost" data-word="">都不太像</button></div>`);
        $('#b3', f).onclick = step2;
        $$('[data-word]', f).forEach(b => b.onclick = () => {
          emo = { emoji: '🌀', label: '說不出來' }; count = 1;
          body = { unsure: { body: st.body, level: st.level, dir: st.dir, word: b.dataset.word || null } };
          send();
        });
      };
      step1();
    };
    drawEmos();
    $('#mpBtn', sh).onclick = press;
  });
}

// ---------- 語音通話：你說完 → 他想一下 → 用他的聲音回你 ----------
async function openCall(rel) {
  const P = ta(rel.frame), name = displayName(rel.frame);
  let st;
  try { st = await api(`/api/rels/${rel.id}/call/start`, { method: 'POST' }); }
  catch (e) { return toast(e.message); }
  const el = document.createElement('div');
  el.className = 'call-screen';
  el.innerHTML = `<div class="call-top"><div class="call-av">${avatar(rel.frame, 112, { season: false })}</div><h2>${esc(name)}</h2>
      <p class="call-time"><span id="ctT">0:00</span>・今天還能講 <span id="ctLeft">${Math.ceil(st.leftSec / 60)}</span> 分鐘</p></div>
    <p class="call-sub" id="ctSub">接通了。點下面的按鈕開始說話，說完再點一次。</p>
    <div class="call-bottom"><button class="call-mic" id="ctMic" aria-label="開始說話">${icon('mic')}</button>
      <button class="call-end" id="ctEnd" aria-label="掛斷">${icon('phone')}</button></div>`;
  document.body.appendChild(el);
  const t0 = Date.now();
  const tick = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000); $('#ctT', el).textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }, 1000);
  let rec = null, stream = null, chunks = [], recAt = 0, busy = false, audio = null, ended = false;
  const setSub = (t) => { $('#ctSub', el).textContent = t; };
  const mic = $('#ctMic', el);
  const hang = async (reason) => {
    if (ended) return; ended = true;
    clearInterval(tick); try { rec?.stop(); } catch {} stream?.getTracks().forEach(t => t.stop()); audio?.pause();
    try { await api(`/api/rels/${rel.id}/call/end`, { method: 'POST' }); } catch {}
    el.remove(); if (reason) toast(reason);
    if (location.hash === `#/chat/${rel.id}`) renderRoom(rel.id);
  };
  $('#ctEnd', el).onclick = () => hang();
  mic.onclick = async () => {
    if (busy) return;
    if (!rec) {
      if (!navigator.mediaDevices?.getUserMedia) return toast('這個瀏覽器不能錄音');
      try { stream = stream || await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('需要麥克風權限才能講電話'); }
      audio?.pause();
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks = []; recAt = Date.now();
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => send(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), rec.mimeType);
      rec.start(); mic.classList.add('on'); setSub('在聽你說……說完點一下');
    } else { rec.stop(); }
  };
  const send = async (blob, mime) => {
    const dur = Math.round((Date.now() - recAt) / 1000);
    rec = null; mic.classList.remove('on');
    if (blob.size < 1500) return setSub('太短了，再說一次');
    busy = true; mic.disabled = true; setSub(`${P}在聽……`);
    const fd = new FormData();
    fd.append('voice', blob, (mime || '').includes('mp4') ? 'voice.m4a' : 'voice.webm');
    fd.append('duration', String(dur));
    try {
      const r = await api(`/api/rels/${rel.id}/call/turn`, { method: 'POST', form: fd });
      if (r.ended) return hang(r.reason || '通話結束了');
      if (typeof r.leftSec === 'number') $('#ctLeft', el).textContent = Math.max(0, Math.ceil(r.leftSec / 60));
      const said = (r.texts || []).join(' ');
      if (!said) { setSub('沒聽清楚，再說一次'); return; }
      setSub(`「${said}」`);
      if (r.audio) { audio = new Audio(r.audio); mic.classList.add('speaking'); await audio.play().catch(() => {}); await new Promise(res => { audio.onended = res; audio.onerror = res; }); mic.classList.remove('speaking'); }
      setSub('換你說。點一下開始');
    } catch (e) { setSub(e.message); }
    finally { busy = false; mic.disabled = false; }
  };
}

// ---------- 聊天室選單（像 LINE）----------
const THEMES = [['default', '預設'], ['night', '夜晚'], ['cafe', '咖啡廳'], ['sea', '海邊'], ['sakura', '櫻花'], ['forest', '森林']];
function openRoomMenu(rel) {
  const items = [['album', '📷', '相簿'], ['notes', '📝', '記事本'], ['story', '📖', '回憶錄'], ['search', '🔍', '搜尋'], ['theme', '🎨', '主題'], ['profile', '👤', '個人頁'], ['settings', '⚙️', '設定'], ['report', '💬', '回報問題']];
  openSheet(`<div class="rm-head">${avatar(rel.frame, 44)}<b>${esc(displayName(rel.frame))}</b></div>
    <div class="rm-grid">${items.map(([k, i, l]) => `<button data-rm="${k}"><span>${i}</span>${l}</button>`).join('')}</div>`, (sh, close) => {
    $$('[data-rm]', sh).forEach(b => b.onclick = () => {
      close();
      ({ album: () => openAlbum(rel), notes: () => openNotes(rel), story: () => { S.storyRel = rel.id; location.hash = '#/story'; },
        search: () => openSearch(rel), theme: () => openThemes(rel), profile: () => { location.hash = `#/profile/${rel.id}`; },
        settings: () => openCharSheet(rel), report: () => openReportSheet(rel) })[b.dataset.rm]();
    });
  });
}

async function openAlbum(rel) {
  const ok = sheetGuard();
  const items = await api(`/api/rels/${rel.id}/album`);
  if (!ok()) return;
  openSheet(`<h3>相簿</h3>${items.length ? `<div class="album">${items.map(p => {
    const src = p.media[0] || p.photo?.url;
    return src ? `<button data-a="${p.id}"><img src="${esc(src)}" alt="${esc(p.place || '')}" loading="lazy"></button>` : '';
  }).join('')}</div>` : `<p class="muted">你們分享的照片和明信片會收在這裡。</p>`}`, (sh) => {
    $$('[data-a]', sh).forEach(b => b.onclick = () => {
      const p = items.find(x => x.id === Number(b.dataset.a));
      openSheet(postcardHtml({ media: p.media[0], photo: p.photo, scene: p.scene, message: p.body || '', place: p.place, at: p.at, name: p.type === 'postcard' && !p.media[0] ? rel.frame.name : '', from: p.media[0] ? 'you' : 'him' }, { large: true }));
    });
  });
}

async function openNotes(rel) {
  const draw = async (sh) => {
    const notes = await api(`/api/rels/${rel.id}/notes`);
    $('#nlist', sh).innerHTML = notes.length ? notes.map(n => `<div class="nrow${n.done ? ' done' : ''}"><input type="checkbox" data-nd="${n.id}" ${n.done ? 'checked' : ''} aria-label="完成">
      <span class="grow">${esc(n.text)}<span class="small muted">・${n.author === 'user' ? '你' : esc(displayName(rel.frame))}寫的</span></span><button class="linkbtn small" data-nx="${n.id}">刪除</button></div>`).join('')
      : `<p class="muted small">約好要一起做的事、想一起去的地方，${ta(rel.frame)}也會記在這裡。</p>`;
    $$('[data-nd]', sh).forEach(c => c.onchange = async () => { await api(`/api/rels/${rel.id}/notes/${c.dataset.nd}`, { method: 'PATCH', body: { done: c.checked } }); draw(sh); });
    $$('[data-nx]', sh).forEach(b => b.onclick = async () => { await api(`/api/rels/${rel.id}/notes/${b.dataset.nx}`, { method: 'PATCH', body: { delete: true } }); draw(sh); });
  };
  const goals = await api(`/api/rels/${rel.id}/goals`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const goalHtml = goals.filter(g => g.status === 'active' || g.status === 'done').map(g => `<div class="goal-row"><div class="grow"><b>${esc(g.title)}</b><div class="dots">${Array.from({ length: g.days }, (_, k) => `<i class="${k < g.done.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="small muted">${g.status === 'done' ? '完成了！' : `做到 ${g.done.length}/${g.days} 天・不用連續`}</div></div>
    ${g.status === 'active' ? `<button class="btn sm ${g.done.includes(today) ? 'ghost' : ''}" data-gd="${g.id}" ${g.done.includes(today) ? 'disabled' : ''}>${g.done.includes(today) ? '今天做到了' : '今天做到了？'}</button>` : ''}</div>`).join('');
  openSheet(`<h3>記事本</h3>${goalHtml ? `<p class="small muted">一起完成的小目標</p>${goalHtml}` : ''}<p class="small muted" style="margin-top:12px">你們的約定與清單</p><div id="nlist"></div>
    <div class="row-form"><input class="input" id="nnew" maxlength="40" placeholder="例如：下次一起去吃豆花"><button class="btn sm" id="nadd">新增</button></div>`, (sh) => {
    draw(sh);
    $$('[data-gd]', sh).forEach(b => b.onclick = async () => { const r = await api(`/api/rels/${rel.id}/goals/${b.dataset.gd}/done`, { method: 'POST' }); toast(r.finished ? '你們一起完成了！' : `${r.done}/${r.days}，很棒`); openNotes(rel); });
    $('#nadd', sh).onclick = async () => { const t = $('#nnew', sh).value.trim(); if (!t) return; await api(`/api/rels/${rel.id}/notes`, { method: 'POST', body: { text: t } }); $('#nnew', sh).value = ''; draw(sh); };
  });
}

function openSearch(rel) {
  const P = displayName(rel.frame);
  openSheet(`<h3>搜尋聊天紀錄</h3><input class="input" id="sq" placeholder="輸入關鍵字" autocomplete="off">
    <div class="small muted" style="margin:14px 0 6px">或依主題找你們聊過的事</div><div class="cat-row" id="stags"></div><div id="sres" style="margin-top:4px"></div>`, async (sh) => {
    let t, eps = [];
    const epText = (x) => esc(x.replaceAll('對方', '你'));
    const showEps = (tag) => {
      $$('[data-tag]', sh).forEach(b => b.classList.toggle('on', b.dataset.tag === tag));
      const list = eps.filter(e => e.tags.includes(tag));
      $('#sres', sh).innerHTML = list.map(e => `<button class="sres ep" data-ep="${e.id}"><div class="small muted">${dateStr(e.created_at)}・${e.tags.map(esc).join('、')}</div><div>${epText(e.summary)}</div></button>`).join('') || '<p class="muted small">這個主題還沒有</p>';
      $$('[data-ep]', sh).forEach(b => b.onclick = async () => {
        const rows = await api(`/api/rels/${rel.id}/episodes/${b.dataset.ep}`);
        b.insertAdjacentHTML('afterend', `<div class="ep-msgs">${rows.map(r => `<div class="small"><b>${r.sender === 'user' ? '你' : esc(P)}</b>：${esc(r.text || '')}</div>`).join('')}</div>`);
        b.onclick = null;
      });
    };
    try { eps = await api(`/api/rels/${rel.id}/episodes`); } catch {}
    const tags = [...new Set(eps.flatMap(e => e.tags))];
    $('#stags', sh).innerHTML = tags.length ? tags.map(x => `<button class="cat" data-tag="${esc(x)}">${esc(x)}</button>`).join('') : '<span class="small muted">多聊幾句之後，系統會把你們聊過的事依主題整理在這裡。</span>';
    $$('[data-tag]', sh).forEach(b => b.onclick = () => { $('#sq', sh).value = ''; showEps(b.dataset.tag); });
    $('#sq', sh).oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const q = $('#sq', sh).value.trim();
      $$('[data-tag]', sh).forEach(b => b.classList.remove('on'));
      const rows = q ? await api(`/api/rels/${rel.id}/search?q=${encodeURIComponent(q)}`) : [];
      const hl = (x) => esc(x).replaceAll(esc(q), `<mark>${esc(q)}</mark>`);
      $('#sres', sh).innerHTML = q ? (rows.length ? rows.map(r => `<div class="sres"><div class="small muted">${dateStr(r.at)} ${hhmm(r.at)}・${r.sender === 'user' ? '你' : esc(P)}</div><div>${hl(r.text || '')}</div></div>`).join('') : '<p class="muted small">找不到</p>') : '';
    }, 250); };
  });
}

function openThemes(rel) {
  openSheet(`<h3>聊天室主題</h3><div class="theme-grid">${THEMES.map(([k, l]) => `<button data-th="${k}" aria-pressed="${(rel.theme || 'default') === k}"><span class="th-sw" data-theme="${k}"><i></i><i></i></span>${l}</button>`).join('')}</div>`, (sh, close) => {
    $$('[data-th]', sh).forEach(b => b.onclick = async () => {
      await api(`/api/rels/${rel.id}/theme`, { method: 'POST', body: { theme: b.dataset.th } });
      rel.theme = b.dataset.th; $('.room')?.setAttribute('data-theme', rel.theme); close();
    });
  });
}

function openCharSheet(rel) {
  const f = rel.frame, P = ta(f);
  const days = (f.schedule?.days || []).map(d => '日一二三四五六'[d]).join('、');
  openSheet(`
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:12px">${avatar(f, 64, { lover: rel.pinned })}
      <div><h3 style="margin:0">${esc(displayName(f))}</h3><div class="small muted">${esc(f.age)} 歲・${esc(f.nationality)}・${esc(f.jobLabel)}</div>
      <div class="small muted">${esc(f.archetypeLabel || '')}・上班日 星期${esc(days)} ${esc(f.schedule?.start)}–${esc(f.schedule?.end)}</div></div></div>
    ${f.intro ? `<p class="hand" style="font-size:16px">${esc(f.intro)}</p>` : ''}
    ${rel.status === 'active' ? `
    <div class="section">
      <div class="row"><label for="star">特別關注</label><input type="checkbox" id="star" ${rel.starred ? 'checked' : ''}></div>
      <div class="row"><div class="grow">關係模式<div class="small muted" id="modeHelp"></div></div>
        <div class="seg" role="group"><button data-mode="practice" aria-pressed="${rel.mode === 'practice'}">練習</button><button data-mode="real" aria-pressed="${rel.mode === 'real'}" ${rel.stage < 1 ? 'disabled' : ''}>真實</button></div></div>
      ${rel.stage >= 3 ? `<div class="row"><label for="pin">置頂在聊天首頁</label><input type="checkbox" id="pin" ${rel.pinned ? 'checked' : ''}></div>` : ''}
    </div>
    ${rel.startType === 'friend' ? `<h2 style="margin-top:18px">你們共同的過去</h2><p class="small muted">這些是相遇時設定的回憶，和你們真正聊出來的記憶分開保存。</p>
      <textarea class="input" id="setmem" rows="4">${esc((rel.settingMemories || []).map(m => m.content).join('\n'))}</textarea>
      <button class="btn ghost sm" id="saveMem" style="margin-top:8px">儲存</button>` : ''}
    ${rel.canShare ? `<h2>分享${P}</h2><p class="small muted">只會分享${P}的個性與說話方式；你們的聊天和回憶永遠不會分享。</p><button class="btn ghost sm" id="share">讓其他人也能認識他</button>` : ''}
    <h2>其他</h2>
    <button class="btn danger sm" id="end">結束這段關係</button>` : `
    <div class="section">
      <div class="row"><label for="block">不想再遇到${P}</label><input type="checkbox" id="block" ${rel.blocked ? 'checked' : ''}></div>
    </div>
    <button class="btn danger sm" id="del">永久刪除這段故事</button>`}
    <p style="margin-top:18px"><button class="linkbtn small" id="reportIssue">聊天怪怪的？回報問題</button></p>
    <p class="small muted">${esc(f.name)}是 AI 角色。</p>`,
  (sheet, close) => {
    const modeHelp = () => {
      const m = $('[data-mode][aria-pressed="true"]', sheet)?.dataset.mode;
      $('#modeHelp', sheet) && ($('#modeHelp', sheet).textContent = rel.stage < 1 ? '成為朋友之後可以開啟真實模式' :
        m === 'real' ? `關係完全隱形，只能從${P}的言行感覺；${P}可能冷戰或提分手` : `會看到里程碑和輕提示，${P}不會跟你分手`);
    };
    modeHelp();
    $('#star', sheet) && ($('#star', sheet).onchange = (e) => api(`/api/rels/${rel.id}`, { method: 'PATCH', body: { starred: e.target.checked } }).then(() => { rel.starred = e.target.checked; }));
    $('#pin', sheet) && ($('#pin', sheet).onchange = (e) => api(`/api/rels/${rel.id}`, { method: 'PATCH', body: { pinned: e.target.checked } }));
    $$('[data-mode]', sheet).forEach(b => b.onclick = async () => {
      if (b.disabled) return;
      if (b.dataset.mode === 'real' && rel.mode !== 'real' && !confirm(`真實模式下，關係進度完全看不見，${P}也可能冷戰或提分手。要開啟嗎？`)) return;
      try {
        await api(`/api/rels/${rel.id}`, { method: 'PATCH', body: { mode: b.dataset.mode } });
        rel.mode = b.dataset.mode;
        $$('[data-mode]', sheet).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        modeHelp();
      } catch (e) { toast(e.message); }
    });
    $('#saveMem', sheet) && ($('#saveMem', sheet).onclick = async () => {
      await api(`/api/rels/${rel.id}/setting-memories`, { method: 'PUT', body: { items: $('#setmem', sheet).value.split('\n') } });
      toast('已儲存');
    });
    $('#share', sheet) && ($('#share', sheet).onclick = () => { close(); openShareSheet(rel); });
    $('#reportIssue', sheet).onclick = () => { close(); openReportSheet(rel); };
    $('#end', sheet) && ($('#end', sheet).onclick = async () => {
      if (!confirm(`要結束和${f.name}的關係嗎？${P}會留下一封信，你們的故事會保留在「我們的故事」。`)) return;
      await api(`/api/rels/${rel.id}/end`, { method: 'POST' });
      close(); renderRoom(rel.id);
    });
    $('#block', sheet) && ($('#block', sheet).onchange = (e) => api(`/api/rels/${rel.id}/block`, { method: 'POST', body: { blocked: e.target.checked } }));
    $('#del', sheet) && ($('#del', sheet).onclick = async () => {
      if (!confirm('永久刪除後，聊天、回憶、照片都會消失，不能復原。確定嗎？')) return;
      await api(`/api/rels/${rel.id}`, { method: 'DELETE' });
      close(); location.hash = '#/story';
    });
  });
}

function openReportSheet(rel) {
  openSheet(`<h3>回報問題</h3>
    <p class="small muted">例如：${ta(rel.frame)}太常問問題、語氣不像、記錯你的事、重複同樣的話、按鈕沒反應。說話方式和記錯的事會<b>馬上修正</b>，其他問題會交給開發的人。</p>
    <textarea class="input" id="rpText" rows="4" placeholder="發生了什麼事？"></textarea>
    <label class="check"><input type="checkbox" id="rpChat" checked><span>附上最近的 16 則對話，幫助我們找原因（只有負責測試的人看得到）</span></label>
    <button class="btn block" id="rpSend">送出</button>`, (sheet, close) => {
    $('#rpSend', sheet).onclick = async () => {
      const text = $('#rpText', sheet).value.trim();
      if (!text) return toast('寫一下發生了什麼');
      $('#rpSend', sheet).disabled = true;
      try { const r = await api(`/api/rels/${rel.id}/report-issue`, { method: 'POST', body: { text, includeChat: $('#rpChat', sheet).checked } }); close(); toast(r.applied || '收到了，謝謝你'); }
      catch (e) { $('#rpSend', sheet).disabled = false; toast(e.message); }
    };
  });
}

async function openShareSheet(rel) {
  const close = openSheet(`<p class="hand">正在整理${ta(rel.frame)}的樣子……</p>`);
  let d;
  const ok = sheetGuard();
  try { d = await api(`/api/rels/${rel.id}/share-preview`, { method: 'POST' }); } catch (e) { close(); return toast(e.message); }
  if (!ok()) return;
  close();
  openSheet(`<h3>分享前，確認一下${ta(rel.frame)}的人設</h3>
    <p class="small muted">其他人拿到的是一份複本，會從朋友期重新認識${ta(rel.frame)}。</p>
    <label class="field"><span>一句介紹</span><input class="input" id="s_intro" value="${esc(d.intro)}"></label>
    <label class="field"><span>核心性格</span><input class="input" id="s_traits" value="${esc(d.traits)}"></label>
    <label class="field"><span>說話方式</span><input class="input" id="s_speech" value="${esc(d.speech)}"></label>
    <label class="field"><span>口頭禪（用「、」分開）</span><input class="input" id="s_cp" value="${esc((d.catchphrases || []).join('、'))}"></label>
    <label class="field"><span>價值觀</span><input class="input" id="s_values" value="${esc(d.values)}"></label>
    <label class="field"><span>週末</span><input class="input" id="s_weekend" value="${esc(d.weekend)}"></label>
    <button class="btn block" id="pub">發布到角色廣場</button>`, (sheet, c2) => {
    $('#pub', sheet).onclick = async () => {
      const v = (k) => $(`#s_${k}`, sheet).value;
      try {
        await api(`/api/rels/${rel.id}/share`, { method: 'POST', body: { intro: v('intro'), traits: v('traits'), speech: v('speech'), catchphrases: v('cp').split(/[、,，]/).map(s => s.trim()).filter(Boolean), values: v('values'), weekend: v('weekend') } });
        c2(); toast('已發布到角色廣場');
      } catch (e) { toast(e.message); }
    };
  });
}

// ======================================================================
// 探索：角色廣場
// ======================================================================
// ======================================================================
// 動態牆：他們自己發的生活動態
// ======================================================================
function feedCard(p) {
  const f = p.frame;
  return `<article class="fpost" data-post="${p.id}">
    <header><a href="#/profile/${p.relId}" class="fp-who">${avatar(f, 40, { season: false })}<span><b>${esc(displayName(f))}</b><time>${ago(p.at)}</time></span></a></header>
    <p class="fp-text">${esc(p.text)}</p>
    ${p.photo ? `<div class="fp-photo"><img src="${esc(p.photo.url)}" alt="" loading="lazy">${creditHtml(p.photo)}</div>` : ''}
    <div class="fp-actions"><button class="fp-like${p.liked ? ' on' : ''}" data-like="${p.id}" aria-pressed="${p.liked}" aria-label="按讚">${p.liked ? '♥' : '♡'}</button>
      <button class="fp-cbtn" data-cmt="${p.id}">留言${p.comments.length ? `・${p.comments.length}` : ''}</button></div>
    ${p.comments.length ? `<div class="fp-comments">${p.comments.map(c => `<div class="fp-c"><b>${c.sender === 'user' ? '你' : esc(displayName(f))}</b> ${esc(c.text)}</div>`).join('')}</div>` : ''}
  </article>`;
}

function myFeedCard(p) {
  return `<article class="fpost mine"><header><span class="fp-who">${meAvatar(40)}<span><b>你</b><time>${ago(p.at)}・${AUD[p.audience]}</time></span></span></header>
    ${p.text ? `<p class="fp-text">${esc(p.text)}</p>` : ''}${p.media ? `<div class="fp-photo"><img src="${esc(p.media)}" alt="" loading="lazy"></div>` : ''}
    <div class="fp-actions"><span class="small muted">${p.likes.length ? `♥ ${p.likes.map(esc).join('、')}` : '還沒有人按讚'}</span><button class="fp-cbtn" data-mp="${p.id}">查看</button></div>
    ${p.comments.length ? `<div class="fp-comments">${p.comments.map(c => `<div class="fp-c"><b>${esc(c.name)}</b> ${esc(c.text)}</div>`).join('')}</div>` : ''}</article>`;
}

async function renderFeed() {
  const draw = async () => {
    const [posts, stories, mine] = await Promise.all([api('/api/feed'), api('/api/stories'), api('/api/me/posts')]);
    if (S.me.counts === undefined) S.me = await api('/api/me');
    try { localStorage.setItem('feedSeen', String(posts[0]?.id || 0)); } catch {}
    $('a[data-tab="feed"] .tab-dot', tabs)?.remove();
    const groups = [...(stories.mine.length ? [{ mine: true, items: stories.mine }] : []), ...stories.chars];
    const all = [...posts.map(p => ({ ...p, _t: p.at })), ...mine.map(p => ({ ...p, _mine: true, _t: p.at }))].sort((a, b) => b._t - a._t);
    app.innerHTML = `<div class="page"><div class="me-top"><h1>動態</h1><button class="btn sm" id="fNew">＋ 發動態</button></div>
      <div class="st-row">
        <button class="st-circle mine" id="myStory"><span class="ring${stories.mine.length ? ' seen' : ' add'}">${meAvatar(58)}</span><span>${stories.mine.length ? '你的限動' : '新增限動'}</span></button>
        ${stories.chars.map((g, k) => `<button class="st-circle" data-sg="${k}"><span class="ring${g.items.every(i => i.seen) ? ' seen' : ''}">${avatar(g.frame, 58, { season: false })}</span><span>${esc(displayName(g.frame))}</span></button>`).join('')}
      </div>
      ${all.length ? all.map(p => p._mine ? myFeedCard(p) : feedCard(p)).join('') : `<div class="empty"><div class="empty-art">${sceneSVG('city', { label: '城市' })}</div><p class="muted">你認識的人發的生活動態會出現在這裡。${TA()}們會在午休、下班後、休假時分享自己的日常。</p></div>`}</div>`;
    $('#fNew').onclick = () => openPostComposer({ onDone: draw });
    $('#myStory').onclick = () => stories.mine.length ? openStoryViewer(groups, 0, draw) : openPostComposer({ story: true, onDone: draw });
    $$('[data-sg]').forEach(b => b.onclick = () => openStoryViewer(groups, Number(b.dataset.sg) + (stories.mine.length ? 1 : 0), draw));
    $$('[data-mp]').forEach(b => b.onclick = () => openMyPost(mine.find(x => x.id === Number(b.dataset.mp)), draw));
    $$('[data-like]').forEach(b => b.onclick = async () => {
      const r = await api(`/api/feed/${b.dataset.like}/like`, { method: 'POST' });
      b.classList.toggle('on', r.liked); b.textContent = r.liked ? '♥' : '♡'; b.setAttribute('aria-pressed', r.liked);
    });
    $$('[data-cmt]').forEach(b => b.onclick = () => {
      const p = posts.find(x => x.id === Number(b.dataset.cmt));
      openSheet(`<h3>留言給${esc(displayName(p.frame))}</h3><p class="small muted">${esc(p.text)}</p>
        <textarea class="input" id="cmt" rows="2" maxlength="200" placeholder="說點什麼…"></textarea>
        <button class="btn block" id="cmtGo" style="margin-top:10px">送出</button>`, (sh, close) => {
        $('#cmt', sh).focus();
        $('#cmtGo', sh).onclick = async () => {
          const text = $('#cmt', sh).value.trim(); if (!text) return;
          $('#cmtGo', sh).disabled = true;
          try { await api(`/api/feed/${p.id}/comment`, { method: 'POST', body: { text } }); close(); toast(`${ta(p.frame)}看到會回你`); draw(); } catch (e) { toast(e.message); $('#cmtGo', sh).disabled = false; }
        };
      });
    });
  };
  await draw();
  S.timers.push(setInterval(() => { if (document.visibilityState === 'visible' && !$('#sheet-root').innerHTML) draw().catch(() => {}); }, 30000));
}

// 動態分頁上的小紅點：有沒看過的新動態
async function refreshFeedDot() {
  try {
    const posts = await api('/api/feed');
    const seen = Number(localStorage.getItem('feedSeen') || 0);
    const a = $('a[data-tab="feed"]', tabs);
    if (a && posts[0] && posts[0].id > seen && !$('.tab-dot', a)) a.insertAdjacentHTML('beforeend', '<span class="tab-dot" aria-label="有新動態"></span>');
  } catch {}
}

async function renderExplore() {
  const list = await api('/api/templates');
  let cat = S.exploreCat || '';
  const draw = () => {
  const official = list.filter(t => t.kind === 'official' && inCat(t, cat));
  const shared = list.filter(t => t.kind === 'shared' && inCat(t, cat));
  const tile = (t) => `<button class="tile${t.portrait ? ' has-photo' : ''}" data-id="${esc(t.id)}">${t.portrait ? portraitThumb(t.portrait, t.frame.name) : avatar(t.frame, 52, { season: false })}
    <span class="nm">${esc(t.frame.name)}</span><span class="info">${esc(t.frame.jobLabel)}・${esc(t.frame.archetypeLabel || '')}</span>
    <span class="intro">${esc(t.frame.intro || '')}</span><span class="by">${t.kind === 'official' ? '官方角色' : `${esc(t.creator)} 塑造`}</span></button>`;
  const catInfo = (S.meta.categories || []).find(c => c.id === cat);
  app.innerHTML = `<div class="page"><h1>探索</h1>
    <button class="choice create-card" id="exCustom"><b>✏️ 自己捏一個</b><span>點選${TA()}的外型、職業和個性，聊天中會慢慢長成你喜歡的樣子</span></button>
    ${catChips(list, cat)}
    <h2 style="margin-top:0">${catInfo ? esc(catInfo.desc) : '住在這座城市裡的人'}</h2>
    ${official.length ? `<div class="grid">${official.map(tile).join('')}</div>` : `<div class="empty" style="padding:8px 0 16px"><div class="empty-art">${sceneSVG('city', { label: '城市' })}</div><p class="muted">這座城市裡的人，你都認識了。</p></div>`}
    <h2>大家塑造的人</h2>
    ${shared.length ? `<div class="grid">${shared.map(tile).join('')}</div>` : `<p class="muted">${cat ? '這個分類還沒有人分享。' : `還沒有人分享。你和${TA()}聊得夠熟之後，可以讓其他人也認識${TA()}。`}</p>`}
  </div>`;
  $$('[data-cat]').forEach(b => b.onclick = () => { cat = S.exploreCat = b.dataset.cat; draw(); });
  $('#exCustom').onclick = () => { Object.assign(M, { templateId: null, custom: null, frame: null, scenarioId: null, scenarioText: '', reunionRelId: null, mood: null }); location.hash = '#/meet/custom'; };
  $$('.tile').forEach(b => b.onclick = () => {
    const t = list.find(x => x.id === b.dataset.id);
    const f = t.frame;
    openSheet(`<div style="display:flex;gap:14px;align-items:center">${avatar(f, 64, { season: false })}<div><h3 style="margin:0">${esc(f.name)}</h3>
      <div class="small muted">${esc(f.age)} 歲・${esc(f.nationality)}・${esc(f.jobLabel)}・${esc(f.archetypeLabel || '')}</div></div></div>
      ${f.signature ? `<p class="signature" style="margin-top:12px">${esc(f.signature)}</p>` : ''}
      <p class="hand" style="font-size:17px;margin-top:14px">${esc(f.intro || '')}</p>
      <p class="small">${esc(f.traits || '')}</p>
      ${f.catchphrases?.length ? `<p class="small muted">常說：${f.catchphrases.map(x => `「${esc(x)}」`).join(' ')}</p>` : ''}
      ${t.kind === 'shared' ? `<p class="small muted">由 ${esc(t.creator)} 塑造。你拿到的是複本，${ta(f)}會從頭認識你。</p>` : ''}
      <button class="btn block" id="meetHim">認識${ta(f)}</button>
      ${t.kind === 'shared' ? '<p style="text-align:center;margin-top:12px"><button class="linkbtn small" id="report">檢舉這個角色</button></p>' : ''}`,
    (sheet, close) => {
      $('#meetHim', sheet).onclick = () => { close(); Object.assign(M, { templateId: t.id, frame: f, custom: null, reunionRelId: null }); location.hash = '#/meet/where'; };
      $('#report', sheet) && ($('#report', sheet).onclick = async () => {
        const reason = prompt('哪裡不適合？（例如：模仿真人、未成年設定）'); if (reason === null) return;
        await api(`/api/templates/${t.id}/report`, { method: 'POST', body: { reason } }); close(); toast('謝謝，我們會處理');
      });
    });
  });
  };
  draw();
}

// ======================================================================
// 我們的故事
// ======================================================================
async function renderStory() {
  const data = await api('/api/story');
  if (!data.length) {
    app.innerHTML = `<div class="page"><h1>我們的故事</h1><div class="empty"><div class="empty-art">${sceneSVG('album', { label: '相片' })}</div><p class="hand">故事還沒開始</p><p class="muted">分享照片、一起出門、${TA()}第一次叫你的小名，都會收在這裡。</p></div></div>`;
    return;
  }
  if (S.storyRel) { S.storySel = S.storyRel; S.storyRel = null; }
  const sel = S.storySel && data.find(d => d.rel.id === S.storySel) ? S.storySel : (data.find(d => d.rel.pinned) || data.find(d => d.rel.status === 'active') || data[0]).rel.id;
  S.storySel = sel;
  const cur = data.find(d => d.rel.id === sel);
  const items = cur.items;
  const milestones = items.filter(i => i.type === 'milestone');
  const photos = items.filter(i => i.type === 'photo');
  const places = {};
  photos.filter(p => p.place).forEach(p => { places[p.place] = places[p.place] || []; places[p.place].push(p); });
  const trips = items.filter(i => i.type === 'travelogue');
  const postcards = items.filter(i => i.type === 'postcard');
  const letter = items.find(i => i.type === 'letter');
  app.innerHTML = `<div class="page"><h1>我們的故事</h1>
    <div class="story-tabs">${data.map(d => `<button data-rel="${d.rel.id}" aria-pressed="${d.rel.id === sel}">${avatar(d.rel.frame, 48, { season: false, lover: d.rel.pinned })}<span>${esc(displayName(d.rel.frame))}${d.rel.status === 'ended' ? '・已結束' : ''}</span></button>`).join('')}</div>
    <p class="small muted">${dateStr(cur.rel.createdAt)} 相遇${cur.rel.status === 'ended' ? `・${dateStr(cur.rel.endedAt)} 分開` : ''}</p>
    ${letter ? `<h2>${ta(cur.rel.frame)}留給你的信</h2><div class="letter">${esc(letter.body)}</div>` : ''}
    ${cur.anniversaries?.length ? `<h2>紀念日</h2><div class="ann-list">${cur.anniversaries.map(a => `<div class="ann ${a.left === 0 ? 'today' : ''}"><span class="ann-ic">${{ his_birthday: '🎂', your_birthday: '🎉', together: '💗', met: '🌱' }[a.kind] || '📅'}</span>
      <span class="grow"><b>${esc(a.title)}</b><span class="small muted">${a.date.replace(/-/g, '.')}</span></span><span class="ann-left">${a.left === 0 ? '今天' : a.left === 1 ? '明天' : `還有 ${a.left} 天`}</span></div>`).join('')}</div>` : ''}
    <h2>回憶錄</h2>
    ${cur.memoir.map(ch => ch.more ? `<p class="mm-more">還有更多回憶，等你們一起寫下去。</p>` : `<div class="mm-ch"><div class="mm-head"><b>${esc(ch.title)}</b><span class="small muted">${ch.unlocked}／${ch.total}</span></div>
      <div class="mm-grid">${ch.cards.map(c => c.unlocked
        ? `<div class="mm-card"><div class="mm-t">${esc(c.title)}</div><time>${dateStr(c.at)}</time></div>`
        : `<div class="mm-card locked" aria-label="還沒解鎖的回憶"><div class="mm-q">？？</div></div>`).join('')}</div></div>`).join('')}
    <h2>回憶地圖</h2>
    ${Object.keys(places).length ? `<div class="places">${Object.entries(places).map(([name, ps]) => `<div class="place"><span class="pin"><b>${ps.length}</b></span><span class="grow"><div class="nm">${esc(name)}</div><div class="small muted">${dateStr(ps.at(-1).at)} 第一次一起看</div></span></div>`).join('')}</div>` : `<p class="muted small">傳景色給${ta(cur.rel.frame)}，告訴${ta(cur.rel.frame)}是哪裡，就會記在這裡。</p>`}
    <h2>明信片</h2>
    ${postcards.length ? `<div class="pc-grid">${postcards.map(p => `<button class="pc-thumb" data-pc="${p.id}">${postcardHtml({ media: p.media[0], photo: p.photo, scene: p.scene, message: p.body, place: p.place, at: p.at, name: p.scene ? cur.rel.frame.name : '', from: p.scene ? 'him' : 'you' })}</button>`).join('')}</div>`
      : `<p class="muted small">你傳很美的風景照時，${ta(cur.rel.frame)}偶爾會做成明信片；${ta(cur.rel.frame)}休假時也會寄明信片給你。</p>`}
    <h2>相簿</h2>
    ${photos.length ? `<div class="album">${photos.map(p => `<button data-photo="${p.id}"><img src="${p.media[0]}" alt="${esc(p.place || '你分享的照片')}" loading="lazy"></button>`).join('')}</div>` : `<p class="muted small">你分享給${ta(cur.rel.frame)}的照片會在這裡。</p>`}
    <h2>遊記</h2>
    ${trips.length ? trips.map(t => `<div class="trip">${t.media[0] ? `<img src="${t.media[0]}" alt="">` : ''}<div class="body"><div class="t">${esc(t.title)}</div>
      <div class="small muted">${dateStr(t.at)}${t.place ? `・${esc(t.place)}` : ''}</div><p>${esc(t.body)}</p>
      <button class="btn ghost sm" data-card="${t.id}">做成分享圖卡</button></div></div>`).join('') : `<p class="muted small">跟${ta(cur.rel.frame)}說要出門，${ta(cur.rel.frame)}會問你要不要帶${ta(cur.rel.frame)}一起去。</p>`}
    ${milestones.length ? `<p style="margin-top:20px"><button class="btn ghost sm" id="msCard">把最新的里程碑做成圖卡</button></p>` : ''}
  </div>`;
  $$('[data-rel]').forEach(b => b.onclick = () => { S.storySel = b.dataset.rel; renderStory(); });
  $$('[data-pc]').forEach(b => b.onclick = () => {
    const p = postcards.find(x => String(x.id) === b.dataset.pc);
    const c = { media: p.media[0], photo: p.photo, scene: p.scene, message: p.body, place: p.place, at: p.at, name: p.scene ? cur.rel.frame.name : '', from: p.scene ? 'him' : 'you' };
    openSheet(`${postcardHtml(c, { large: true })}<button class="btn ghost block" id="pcShare" style="margin-top:14px">做成分享圖卡</button>`, (sheet) => {
      $('#pcShare', sheet).onclick = () => makeShareCard({ hue: cur.rel.frame.hue, kicker: p.scene ? `${cur.rel.frame.name}寄來的明信片` : `寄給${cur.rel.frame.name}的風景`, title: p.place || '明信片', body: p.body, date: dateStr(p.at), photo: p.media[0] || p.photo?.url });
    });
  });
  $$('[data-photo]').forEach(b => b.onclick = () => {
    const p = photos.find(x => String(x.id) === b.dataset.photo);
    openSheet(`<img src="${p.media[0]}" alt="" style="width:100%;border-radius:14px"><p class="hand" style="font-size:17px">${esc(p.place || '')}</p><p class="small muted">${dateStr(p.at)}</p>`);
  });
  $$('[data-card]').forEach(b => b.onclick = () => {
    const t = trips.find(x => String(x.id) === b.dataset.card);
    makeShareCard({ hue: cur.rel.frame.hue, kicker: `和${cur.rel.frame.name}的遊記`, title: t.title, body: t.body, date: dateStr(t.at), photo: t.media[0] });
  });
  $('#msCard') && ($('#msCard').onclick = () => {
    const m = milestones[0];
    makeShareCard({ hue: cur.rel.frame.hue, kicker: `我和${cur.rel.frame.name}`, title: `今天，${m.title}`, body: '', date: dateStr(m.at) });
  });
}

// 9:16 限動圖卡
async function makeShareCard({ hue, kicker, title, body, date, photo }) {
  const W = 1080, H = 1920;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  await document.fonts.load('700 80px "LXGW WenKai TC"').catch(() => {});
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, `hsl(${hue} 45% 88%)`); grad.addColorStop(1, `hsl(${(hue + 40) % 360} 40% 72%)`);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  let y = 260;
  if (photo) {
    const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = photo; });
    if (img) {
      const bw = 880, bh = 880, k = Math.max(bw / img.width, bh / img.height);
      g.save(); roundRect(g, 100, 200, bw, bh, 48); g.clip();
      g.drawImage(img, 100 + (bw - img.width * k) / 2, 200 + (bh - img.height * k) / 2, img.width * k, img.height * k);
      g.restore(); y = 1180;
    }
  }
  g.fillStyle = '#26223A';
  g.font = '40px "LXGW WenKai TC", serif'; g.globalAlpha = .7; g.fillText(kicker, 100, y); g.globalAlpha = 1;
  g.font = '700 84px "LXGW WenKai TC", serif'; y = wrapText(g, title, 100, y + 110, 880, 110);
  if (body) { g.font = '44px "LXGW WenKai TC", serif'; y = wrapText(g, body, 100, y + 40, 880, 72, photo ? 5 : 12); }
  g.font = '34px "Noto Sans TC", sans-serif'; g.globalAlpha = .6; g.fillText(`${date}・伴旅 WithU`, 100, H - 140); g.globalAlpha = 1;
  c.toBlob(async (blob) => {
    const file = new File([blob], 'story-card.png', { type: 'image/png' });
    track('share_card', {});
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch {} }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'story-card.png'; a.click();
  }, 'image/png');
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function wrapText(g, text, x, y, maxW, lh, maxLines = 99) {
  let line = '', lines = 0;
  for (const ch of text.replace(/\n/g, '')) {
    if (g.measureText(line + ch).width > maxW) { g.fillText(line, x, y); y += lh; line = ch; if (++lines >= maxLines) return y; }
    else line += ch;
  }
  if (line) { g.fillText(line, x, y); y += lh; }
  return y;
}

// ======================================================================
// 我
// ======================================================================
const COMING = [
  { key: 'voice_pack', name: '聲線包', desc: '換一種聲線說話' },
  { key: 'anniversary', name: '紀念日劇情', desc: '生日、交往紀念日的限定劇情與語音' },
  { key: 'outfit', name: '季節穿搭', desc: '頭像換上當季造型' },
  { key: 'theme', name: '聊天室主題', desc: '換一個屬於你們的聊天背景' },
];

// ======================================================================
// 我的主頁（像 IG）
// ======================================================================
const STATUS_PRESETS = [['😴', '好累'], ['💼', '忙碌中'], ['🍜', '想吃宵夜'], ['🎉', '心情很好'], ['🌧', '有點低落'], ['📚', '專心中'], ['🏃', '出門中'], ['🤒', '不太舒服']];
function meAvatar(size = 86) {
  return S.me.avatar ? `<span class="avatar me-av" style="--s:${size}px"><img src="${esc(S.me.avatar)}" alt=""></span>`
    : `<span class="avatar me-av initial" style="--s:${size}px"><b>${esc((S.me.nickname || '我').slice(0, 1))}</b></span>`;
}
const AUD = { all: '所有人', lover: '只給戀人', some: '指定的人' };

async function renderMe() {
  S.me = await api('/api/me');
  const posts = await api('/api/me/posts');
  const st = S.me.status;
  app.innerHTML = `<div class="page">
    <div class="me-top"><h1>${esc(S.me.nickname)}</h1><a class="icon-btn" href="#/settings" aria-label="設定"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.4l2 1.2M17.8 15.4l2 1.2M4.2 16.6l2-1.2M17.8 8.6l2-1.2"/></svg></a></div>
    <div class="me-head"><button class="me-avbtn" id="avBtn" aria-label="換大頭貼">${meAvatar()}</button><input type="file" id="avIn" accept="image/*" hidden>
      <div class="me-stats"><div><b>${S.me.counts.posts}</b><span>動態</span></div><div><b>${S.me.counts.rels}</b><span>認識的人</span></div></div></div>
    <div class="me-bio"><b>${esc(S.me.callName)}</b>${S.me.bio ? `<p>${esc(S.me.bio)}</p>` : ''}</div>
    <button class="me-status" id="stBtn">${st ? `<span>${esc(st.emoji)} ${esc(st.text)}</span><time>${ago(st.at)}</time>` : '<span class="muted">＋ 設定你現在的狀態</span>'}</button>
    <p class="small muted" style="margin:6px 2px 0">狀態 24 小時後自動消失；你認識的人看得到，會依你的狀態關心你。</p>
    <div class="me-actions"><button class="btn ghost sm" id="editBtn">編輯個人檔案</button><button class="btn sm" id="newPost">＋ 發動態</button></div>
    <div class="me-grid">${posts.length ? posts.map(p => `<button class="me-tile" data-p="${p.id}">${p.media ? `<img src="${esc(p.media)}" alt="" loading="lazy">` : `<span>${esc((p.text || '').slice(0, 40))}</span>`}${p.likes.length ? `<i>♥ ${p.likes.length}</i>` : ''}</button>`).join('') : '<p class="muted small" style="grid-column:1/-1;text-align:center;padding:20px 0">還沒有動態。發一則，讓他們知道你最近過得怎樣。</p>'}</div>
  </div>`;
  $('#avBtn').onclick = () => $('#avIn').click();
  $('#avIn').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('photo', await shrinkImage(f, 512), 'av.jpg'); await api('/api/me/avatar', { method: 'POST', form: fd }); renderMe(); };
  $('#stBtn').onclick = () => openStatusSheet();
  $('#editBtn').onclick = () => openSheet(`<h3>編輯個人檔案</h3>
    <label class="field"><span>暱稱</span><input class="input" id="eNick" maxlength="16" value="${esc(S.me.nickname)}"></label>
    <label class="field"><span>希望怎麼被稱呼</span><input class="input" id="eCall" maxlength="16" value="${esc(S.me.callName)}"></label>
    <label class="field"><span>簡介</span><textarea class="input" id="eBio" rows="2" maxlength="80" placeholder="例如：愛喝拿鐵的社畜，週末想去海邊">${esc(S.me.bio)}</textarea></label>
    <button class="btn block" id="eSave">儲存</button>`, (sh, close) => {
    $('#eSave', sh).onclick = async () => { await api('/api/me', { method: 'PATCH', body: { nickname: $('#eNick', sh).value, callName: $('#eCall', sh).value, bio: $('#eBio', sh).value } }); close(); renderMe(); };
  });
  $('#newPost').onclick = () => openPostComposer({ onDone: renderMe });
  $$('[data-p]').forEach(b => b.onclick = () => openMyPost(posts.find(x => x.id === Number(b.dataset.p)), renderMe));
}

function openStatusSheet(onDone) {
  openSheet(`<h3>你現在的狀態</h3><div class="st-grid">${STATUS_PRESETS.map(([e, t]) => `<button data-st="${t}" data-em="${e}">${e} ${t}</button>`).join('')}</div>
    <div class="row-form" style="margin-top:12px"><input class="input" id="stTxt" maxlength="30" placeholder="或自己寫，例如：在趕報告"><button class="btn sm" id="stGo">設定</button></div>
    ${S.me.status ? '<button class="linkbtn small" id="stClear" style="margin-top:12px">清除狀態</button>' : ''}`, (sh, close) => {
    const set = async (emoji, text) => { await api('/api/me/status', { method: 'POST', body: { emoji, text } }); close(); toast(text ? '狀態更新了' : '已清除'); (onDone || renderMe)(); };
    $$('[data-st]', sh).forEach(b => b.onclick = () => set(b.dataset.em, b.dataset.st));
    $('#stGo', sh).onclick = () => { const t = $('#stTxt', sh).value.trim(); if (t) set('💬', t); };
    $('#stClear', sh) && ($('#stClear', sh).onclick = () => set('', ''));
  });
}

async function openPostComposer({ story = false, onDone } = {}) {
  const ok = sheetGuard();
  const rels = (S.rels.length ? S.rels : await api('/api/rels')).filter(r => r.status === 'active');
  if (!ok()) return;
  let file = null;
  openSheet(`<h3>發${story ? '限時動態' : '動態'}</h3>
    <div class="seg" style="margin-bottom:12px"><button data-kind="0" aria-pressed="${!story}">動態</button><button data-kind="1" aria-pressed="${story}">限時動態（24 小時）</button></div>
    <textarea class="input" id="pTxt" rows="3" maxlength="300" placeholder="最近在幹嘛？"></textarea>
    <div class="row-form" style="margin-top:8px"><button class="btn ghost sm" id="pPhoto">📷 加照片</button><span class="small muted" id="pPhotoName"></span><input type="file" id="pIn" accept="image/*" hidden></div>
    <label class="field" style="margin-top:12px"><span>誰看得到</span><select class="input" id="pAud"><option value="all">你認識的所有人</option><option value="lover">只給戀人</option><option value="some">指定的人…</option></select></label>
    <div id="pSome" hidden>${rels.map(r => `<label class="row"><span class="grow">${esc(displayName(r.frame))}</span><input type="checkbox" value="${r.id}"></label>`).join('')}</div>
    <button class="btn block" id="pGo" style="margin-top:12px">發布</button>`, (sh, close) => {
    $$('[data-kind]', sh).forEach(b => b.onclick = () => { story = b.dataset.kind === '1'; $$('[data-kind]', sh).forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    $('#pPhoto', sh).onclick = () => $('#pIn', sh).click();
    $('#pIn', sh).onchange = (e) => { file = e.target.files[0] || null; $('#pPhotoName', sh).textContent = file ? '已選一張照片' : ''; };
    $('#pAud', sh).onchange = (e) => { $('#pSome', sh).hidden = e.target.value !== 'some'; };
    $('#pGo', sh).onclick = async () => {
      const text = $('#pTxt', sh).value.trim();
      if (!text && !file) return toast('寫點什麼，或放一張照片');
      const fd = new FormData();
      fd.append('text', text); fd.append('story', story ? '1' : '0');
      const aud = $('#pAud', sh).value;
      fd.append('audience', aud === 'some' ? JSON.stringify($$('#pSome input:checked', sh).map(i => i.value)) : aud);
      if (file) fd.append('photo', await shrinkImage(file), 'post.jpg');
      $('#pGo', sh).disabled = true;
      try { await api('/api/me/posts', { method: 'POST', form: fd }); close(); toast('發布了'); track('user_post', { story }); onDone?.(); } catch (e) { toast(e.message); $('#pGo', sh).disabled = false; }
    };
  });
}

function openMyPost(p, onDone) {
  openSheet(`${p.media ? `<img src="${esc(p.media)}" alt="" style="width:100%;border-radius:14px">` : ''}
    ${p.text ? `<p class="fp-text">${esc(p.text)}</p>` : ''}<p class="small muted">${dateStr(p.at)} ${hhmm(p.at)}・${AUD[p.audience]}</p>
    ${p.likes.length ? `<p class="small">♥ ${p.likes.map(esc).join('、')}</p>` : ''}
    ${p.comments.map(c => `<div class="fp-c"><b>${esc(c.name)}</b> ${esc(c.text)}</div>`).join('')}
    <button class="linkbtn small" id="pDel" style="margin-top:14px">刪除這則</button>`, (sh, close) => {
    $('#pDel', sh).onclick = async () => { if (!confirm('刪除這則動態？')) return; await api(`/api/me/posts/${p.id}`, { method: 'DELETE' }); close(); onDone?.(); };
  });
}

// 限時動態檢視：點右邊下一則、左邊上一則；他的限動可以直接回覆（會傳到聊天室）
function openStoryViewer(groups, start = 0, onClose) {
  let gi = start, ii = 0, timer = null;
  const root = document.createElement('div');
  root.className = 'story-view';
  document.body.appendChild(root);
  const close = () => { clearTimeout(timer); root.remove(); onClose?.(); };
  const show = () => {
    const g = groups[gi]; if (!g) return close();
    const it = g.items[ii]; if (!it) { gi++; ii = 0; return show(); }
    clearTimeout(timer);
    if (g.relId && it.id) api(`/api/stories/${it.id}/seen`, { method: 'POST' }).catch(() => {});
    const bg = it.photo?.url || it.media;
    root.innerHTML = `<div class="sv-bars">${g.items.map((_, k) => `<i class="${k < ii ? 'done' : k === ii ? 'now' : ''}"></i>`).join('')}</div>
      <header class="sv-head">${g.mine ? meAvatar(32) : avatar(g.frame, 32, { season: false })}<b>${esc(g.mine ? '你的限時動態' : displayName(g.frame))}</b><time>${ago(it.at)}</time><button class="sv-x" aria-label="關閉">✕</button></header>
      <div class="sv-body${bg ? '' : ' text-only'}">${bg ? `<img src="${esc(bg)}" alt="">${it.photo ? creditHtml(it.photo) : ''}` : ''}${it.text ? `<p class="sv-text">${esc(it.text)}</p>` : ''}</div>
      <button class="sv-nav prev" aria-label="上一則"></button><button class="sv-nav next" aria-label="下一則"></button>
      ${g.mine ? `<footer class="sv-foot small">${it.viewers?.length ? `${it.viewers.length} 人看過` : '還沒有人看過'}</footer>`
        : `<form class="sv-reply"><input placeholder="回覆${esc(displayName(g.frame))}…" maxlength="200"><button>送出</button></form>`}`;
    $('.sv-x', root).onclick = close;
    $('.sv-nav.next', root).onclick = () => { ii++; show(); };
    $('.sv-nav.prev', root).onclick = () => { if (ii > 0) ii--; else if (gi > 0) { gi--; ii = 0; } show(); };
    const form = $('.sv-reply', root);
    if (form) {
      $('input', form).onfocus = () => clearTimeout(timer);
      form.onsubmit = async (e) => {
        e.preventDefault(); const text = $('input', form).value.trim(); if (!text) return;
        try { await api(`/api/rels/${g.relId}/messages`, { method: 'POST', body: { text, storyRef: it.id } }); toast(`已傳給${ta(g.frame)}`); track('story_reply', {}); onClose = null; close(); location.hash = `#/chat/${g.relId}`; } catch (err) { toast(err.message); }
      };
    }
    timer = setTimeout(() => { ii++; show(); }, 6000);
  };
  show();
}

async function renderSettings() {
  S.me = await api('/api/me');
  const st = S.me.settings || {};
  const pushOn = 'Notification' in window && Notification.permission === 'granted';
  app.innerHTML = `<div class="page"><a class="icon-btn back" href="#/me" aria-label="回到我的主頁">${icon('back')}</a><h1>設定</h1>
    <div class="section">
      <div class="row"><span class="grow">暱稱</span><input class="input" id="nick" style="max-width:55%" value="${esc(S.me.nickname)}"></div>
      <div class="row"><span class="grow">對方怎麼稱呼你</span><input class="input" id="call" style="max-width:55%" value="${esc(S.me.callName)}"></div>
      <div class="row"><span class="grow">你是</span><div class="seg">${[['female', '女生'], ['male', '男生'], ['other', '不想說']].map(([v, l]) => `<button data-gd="${v}" aria-pressed="${S.me.gender === v}">${l}</button>`).join('')}</div></div>
      <div class="row"><span class="grow">想遇見<div class="small muted">影響探索和相遇推薦</div></span><div class="seg">${[['male', '男生'], ['female', '女生'], ['any', '都可以']].map(([v, l]) => `<button data-sk="${v}" aria-pressed="${S.me.seeks === v}">${l}</button>`).join('')}</div></div>
    </div>

    <h2>系統主題</h2>
    <div class="theme-pick">${APP_THEMES.map(([k, l, d]) => `<button data-at="${k}" aria-pressed="${(st.appTheme || 'milk') === k}"><span class="tp-art tp-${k}">${mascotSVG(k, 'happy')}</span><b>${l}</b><span class="small muted">${d}</span></button>`).join('')}</div>

    <h2>通知</h2>
    <div class="section">
      <div class="row"><div class="grow">有新訊息時通知我<div class="small muted">${isIOS() && !isStandalone() ? 'iPhone 需要先「加入主畫面」' : S.me.pushKey ? '' : '伺服器尚未設定推播'}</div></div>
        <button class="btn sm ${pushOn ? 'ghost' : ''}" id="push" ${!S.me.pushKey ? 'disabled' : ''}>${pushOn ? '已開啟' : '開啟'}</button></div>
      <div class="row"><label for="sugg" class="grow">顯示回覆方向<div class="small muted">不知道怎麼回的時候，點一下幫你寫好一句</div></label><input type="checkbox" id="sugg" ${st.showSuggestions !== false ? 'checked' : ''}></div>
      <div class="row"><label for="owl" class="grow">我是夜貓／輪班<div class="small muted">打開後角色會比較晚睡、半夜比較常醒著陪你；勿擾時段會改到白天（可以再自己調）</div></label><input type="checkbox" id="owl" ${st.nightOwl ? 'checked' : ''}></div>
      <div class="row"><label for="rdelay" class="grow">忙的時候晚點回<div class="small muted">上班、睡覺時會晚一點才回你，比較像真人</div></label><input type="checkbox" id="rdelay" ${st.realisticDelay !== false ? 'checked' : ''}></div>
      <div class="row"><span class="grow">頭像畫風</span><div class="seg">${[['auto', '依角色'], ['real', '寫實'], ['anime', '二次元'], ['photo', '生活照']].map(([v, l]) => `<button data-ps="${v}" aria-pressed="${(st.portraitStyle || 'auto') === v}">${l}</button>`).join('')}</div></div>
      <div class="row"><span class="grow">通知預覽</span><div class="seg"><button data-np="full" aria-pressed="${st.notifyPreview !== 'discreet'}">顯示內容</button><button data-np="discreet" aria-pressed="${st.notifyPreview === 'discreet'}">只顯示有新訊息</button></div></div>
      <div class="row"><label for="discreet" class="grow">低調模式<div class="small muted">名字和頭像改成被看到也不尷尬的樣子</div></label><input type="checkbox" id="discreet" ${st.discreetNames ? 'checked' : ''}></div>
    </div>

    <h2>${TA()}主動找你</h2>
    <div class="section">
      <div class="row"><span class="grow">頻率</span><div class="seg">${[['low', '少一點'], ['normal', '剛好'], ['high', '多一點']].map(([v, l]) => `<button data-lv="${v}" aria-pressed="${(st.proactiveLevel || 'normal') === v}">${l}</button>`).join('')}</div></div>
      <div class="row"><span class="grow">每天最多</span><select class="input" id="cap" style="max-width:110px">${[2, 4, 6, 8, 12].map(n => `<option ${Number(st.dailyCap || 6) === n ? 'selected' : ''}>${n}</option>`).join('')}</select><span>則</span></div>
      <div class="row"><span class="grow">勿擾時段</span><input type="time" class="input" id="dndS" style="max-width:110px" value="${esc(st.dndStart || '23:30')}"><span>–</span><input type="time" class="input" id="dndE" style="max-width:110px" value="${esc(st.dndEnd || '07:30')}"></div>
      <div class="row"><span class="grow">平常吃午餐</span><input type="time" class="input" id="lunch" style="max-width:110px" value="${esc(st.lunchAt || '12:15')}"></div>
      <div class="row"><span class="grow">平常吃晚餐</span><input type="time" class="input" id="dinner" style="max-width:110px" value="${esc(st.dinnerAt || '19:00')}"></div>
    </div>
    <p class="small muted">你在聊天中說「白天別吵我」，${TA()}也會遵守。</p>

    <h2>即將推出</h2>
    <p class="small muted">測試期間所有功能都開放。下面這些還在做，點一下告訴我們你有沒有興趣。</p>
    <div class="section">${COMING.map(c => `<div class="row"><span class="grow">${c.name}<div class="small muted">${c.desc}</div></span><button class="btn ghost sm" data-coming="${c.key}">想要</button></div>`).join('')}</div>

    <h2>隱私與資料</h2>
    <div class="section">
      <div class="row"><span class="grow">登入碼<div class="small muted">換裝置時用它回來</div></span><code>${esc(S.me.recoveryCode)}</code></div>
      <div class="row"><span class="grow">下載我的資料</span><a class="btn ghost sm" href="/api/me/export" download>下載</a></div>
      <div class="row"><span class="grow">刪除帳號與所有資料</span><button class="btn danger sm" id="delAll">刪除</button></div>
      <div class="row"><span class="grow">系統整理的相處偏好<div class="small muted">${S.me.prefs?.likes?.length || S.me.prefs?.dislikes?.length ? [...(S.me.prefs.likes || []).map(x => '喜歡' + x.replace(/^喜歡/, '')), ...(S.me.prefs.dislikes || []).map(x => x.startsWith('不喜歡') ? x : '不喜歡' + x)].map(esc).join('・') : '還沒有。聊久一點，系統會整理你喜歡的聊天方式，讓新認識的人也懂你。'}<br>只記說話方式，不記你的私事。</div></span>${S.me.prefs ? '<button class="btn ghost sm" id="clrPrefs">清除</button>' : ''}</div>
      <div class="row"><span class="grow">隱私權政策與使用條款</span><a class="btn ghost sm" href="/privacy" target="_blank">查看</a></div>
    </div>
    <p class="small muted">${TA()}看得到的記憶不會顯示成清單；${TA()}記錯時直接告訴${TA()}就好，請${TA()}「忘掉」某件事，${TA()}也會真的刪除。對話會傳送到 OpenAI（美國）處理以產生回覆。</p>

    <h2>關於</h2>
    <div class="section">
      <div class="row"><span class="grow">這裡的角色都是 AI，不是真人。</span></div>
      <div class="row"><span class="grow">需要有人說說話</span><a class="btn ghost sm" href="tel:1925">安心專線 1925</a></div>
      <div class="row"><span class="grow">意見回饋</span><button class="btn ghost sm" id="fb">寫給我們</button></div>
      <div class="row"><span class="grow">登出這個裝置</span><button class="btn ghost sm" id="logout">登出</button></div>
    </div>
    <p class="small muted" style="text-align:center">伴旅 WithU・測試版</p>
  </div>`;

  const save = async (patch) => {
    try {
      await api('/api/me', { method: 'PATCH', body: patch });
      S.me = await api('/api/me');
      toast('已儲存');
    } catch (e) { toast(e.message); }
  };
  const saveSettings = (s) => save({ settings: s });
  $('#nick').onchange = (e) => save({ nickname: e.target.value });
  $('#call').onchange = (e) => save({ callName: e.target.value });
  $$('[data-gd]').forEach(b => b.onclick = () => { $$('[data-gd]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); save({ gender: b.dataset.gd }); });
  $$('[data-sk]').forEach(b => b.onclick = () => { $$('[data-sk]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); save({ seeks: b.dataset.sk }).then(() => renderSettings()); });
  $$('[data-np]').forEach(b => b.onclick = () => { $$('[data-np]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); saveSettings({ notifyPreview: b.dataset.np }); });
  $('#sugg').onchange = (e) => saveSettings({ showSuggestions: e.target.checked });
  $('#rdelay').onchange = (e) => saveSettings({ realisticDelay: e.target.checked });
  $('#owl').onchange = (e) => {
    const on = e.target.checked;
    const dnd = on ? { dndStart: '09:00', dndEnd: '16:00' } : { dndStart: '23:30', dndEnd: '07:30' };
    $('#dndS').value = dnd.dndStart; $('#dndE').value = dnd.dndEnd;
    saveSettings({ nightOwl: on, ...dnd });
    toast(on ? '好，大家會晚一點睡。到「探索 → 夜貓」可以認識晚上工作的人' : '已改回一般作息');
  };
  $('#clrPrefs') && ($('#clrPrefs').onclick = async () => { await api('/api/me/prefs', { method: 'DELETE' }); toast('已清除'); renderSettings(); });
  $$('[data-at]').forEach(b => b.onclick = () => { $$('[data-at]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); applyAppTheme(b.dataset.at); saveSettings({ appTheme: b.dataset.at }); });
  $$('[data-ps]').forEach(b => b.onclick = () => { $$('[data-ps]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); setPortraitStyle(b.dataset.ps); saveSettings({ portraitStyle: b.dataset.ps }); });
  $$('[data-lv]').forEach(b => b.onclick = () => { $$('[data-lv]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); saveSettings({ proactiveLevel: b.dataset.lv }); });
  $('#discreet').onchange = (e) => { saveSettings({ discreetNames: e.target.checked }); setManifest(e.target.checked); };
  $('#cap').onchange = (e) => saveSettings({ dailyCap: Number(e.target.value) });
  $('#dndS').onchange = $('#dndE').onchange = () => saveSettings({ dndStart: $('#dndS').value, dndEnd: $('#dndE').value });
  $('#lunch').onchange = (e) => saveSettings({ lunchAt: e.target.value });
  $('#dinner').onchange = (e) => saveSettings({ dinnerAt: e.target.value });
  $('#push').onclick = () => enablePush().then(ok => { if (ok) renderSettings(); });
  $$('[data-coming]').forEach(b => b.onclick = () => {
    const item = COMING.find(c => c.key === b.dataset.coming);
    track('coming_soon_click', { item: item.key });
    openSheet(`<h3>${item.name}</h3><p>如果要付費，你覺得多少錢合理？</p>
      <div class="chips">${[0, 30, 60, 90, 150, 300].map(p => `<button class="chip" data-price="${p}">${p === 0 ? '不會買' : `NT$${p}`}</button>`).join('')}</div>
      <p class="small muted" style="margin-top:14px">只是問問，測試期間不會收費。</p>`, (sheet, close) => {
      $$('[data-price]', sheet).forEach(c => c.onclick = () => { track('coming_soon_price', { item: item.key, price: Number(c.dataset.price) }); close(); toast('謝謝你告訴我們'); });
    });
  });
  $('#delAll').onclick = async () => {
    if (!confirm('會刪除你的帳號、所有角色、聊天、回憶與照片，不能復原。確定嗎？')) return;
    if (prompt('輸入「刪除」確認') !== '刪除') return;
    await api('/api/me', { method: 'DELETE' });
    S.me = null; location.hash = '#/welcome';
  };
  $('#fb').onclick = () => openSheet(`<h3>寫給我們</h3><textarea class="input" id="fbt" rows="5" placeholder="喜歡什麼、哪裡怪怪的、希望角色會做什麼"></textarea><button class="btn block" id="fbs" style="margin-top:10px">送出</button>`,
    (sheet, close) => { $('#fbs', sheet).onclick = () => { track('feedback', { text: $('#fbt', sheet).value.slice(0, 2000) }); close(); toast('收到了，謝謝'); }; });
  $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); S.me = null; location.hash = '#/welcome'; };
}

// ======================================================================
// PWA: service worker, install, push
// ======================================================================
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

function installBanner() {
  if (isStandalone() || localStorage.getItem('installDismissed')) return '';
  if (isIOS()) return `<div class="install"><span class="grow">把這個 App 加到主畫面，才收得到訊息：點分享按鈕 → 「加入主畫面」。</span><button class="icon-btn" id="instX" aria-label="關閉">${icon('x')}</button></div>`;
  if (deferredInstall) return `<div class="install"><span class="grow">把這個 App 加到主畫面，用起來更順手。</span><button class="btn sm" id="instGo">加入</button><button class="icon-btn" id="instX" aria-label="關閉">${icon('x')}</button></div>`;
  return '';
}
function bindInstall() {
  $('#instX') && ($('#instX').onclick = () => { try { localStorage.setItem('installDismissed', '1'); } catch {} $('.install')?.remove(); });
  $('#instGo') && ($('#instGo').onclick = async () => { track('install_prompt', {}); deferredInstall.prompt(); deferredInstall = null; $('.install')?.remove(); });
}
function setManifest(discreet) {
  $('#manifest').href = discreet ? '/manifest-discreet.webmanifest' : '/manifest.webmanifest';
}

function urlB64ToUint8(base64) {
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast(isIOS() ? '請先把 App 加入主畫面，再從主畫面打開' : '這個瀏覽器不支援通知'); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('沒有開啟通知權限'); return false; }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(S.me.pushKey) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  toast('有新訊息時會通知你');
  return true;
}

// 手機端錯誤回報到後台「系統紀錄」（同一則錯誤只送一次）
const sentErrors = new Set();
function reportClientError(message, stack) {
  const key = String(message).slice(0, 120);
  if (sentErrors.has(key) || sentErrors.size > 20 || /unauth|Failed to fetch|Load failed|NetworkError/.test(key)) return;
  sentErrors.add(key);
  fetch('/api/client-log', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ message: key, stack: String(stack || '').slice(0, 2000), url: location.hash, v: appVer || '' }) }).catch(() => {});
}
window.addEventListener('error', (e) => reportClientError(e.message, e.error?.stack));
window.addEventListener('unhandledrejection', (e) => reportClientError(e.reason?.message || String(e.reason), e.reason?.stack));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---------- 檢查新版本：打開 App、回到 App、登入後、每 5 分鐘 ----------
let appVer = null, hiddenAt = 0, verBanner = false;
async function checkVersion({ quiet = false } = {}) {
  try {
    const { v } = await fetch('/api/version', { cache: 'no-store' }).then(r => r.json());
    if (!appVer) { appVer = v; return; }
    if (v === appVer || verBanner) return;
    const busy = !!$('#sheet-root').innerHTML || (document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName) && document.activeElement.value);
    if (quiet && !busy) return applyUpdate();
    verBanner = true;
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.innerHTML = '<span>伴旅有新版本了</span><button>更新</button>';
    bar.querySelector('button').onclick = applyUpdate;
    document.body.appendChild(bar);
  } catch { /* offline */ }
}
async function applyUpdate() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
  location.reload();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  // 離開超過 10 分鐘再回來：有新版就直接更新（沒有在打字的話）
  checkVersion({ quiet: hiddenAt && Date.now() - hiddenAt > 10 * 60000 });
});
setInterval(() => document.visibilityState === 'visible' && checkVersion(), 5 * 60000);
checkVersion();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.me) track('app_open', {}); });

(async () => {
  try { S.me = await api('/api/me'); } catch { S.me = null; }
  if (S.me) { setManifest(!!S.me.settings?.discreetNames); setPortraitStyle(S.me.settings?.portraitStyle); applyAppTheme(S.me.settings?.appTheme); track('app_open', {}); }
  if (!S.me && !/^#\/(welcome|join|recover)$/.test(location.hash)) { location.hash = '#/welcome'; return; }
  if (S.me && (!location.hash || location.hash === '#/welcome')) {
    const rels = await api('/api/rels').catch(() => []);
    S.rels = rels;
    location.hash = rels.length ? '#/chat' : '#/meet';
    if (location.hash === (rels.length ? '#/chat' : '#/meet')) route();
    return;
  }
  route();
})();
