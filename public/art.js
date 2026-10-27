// 插圖：參數化角色頭像 + 相遇場景 + 空畫面。
// 全部是向量（SVG 字串），之後若有插畫家的正式圖，替換這個檔案的輸出即可。

let uid = 0;
const nid = (p) => `${p}${++uid}`;

// ---------------------------------------------------------------- portraits
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
};

const HAIR_BACK = {
  long: (c) => `<path d="M29 38C28 22 37 16 48 16s20 6 19 22l3 40c-7 5-37 5-44 0z" fill="${c}"/>`,
  wavy: (c) => `<path d="M29 38C28 22 37 16 48 16s20 6 19 22c2 8 6 12 3 18 4 6 1 14 2 20-8 6-38 6-46 0 1-6-2-14 2-20-3-6 1-10 3-18z" fill="${c}"/>`,
  bob: (c) => `<path d="M30 38C29 23 38 17 48 17s19 6 18 21l2 20c-6 4-34 4-40 0z" fill="${c}"/>`,
  ponytail: (c) => `<path d="M60 26c10 2 14 12 12 24-1 8-5 14-9 16 2-8 2-18-3-24z" fill="${c}"/>`,
  bun: (c) => `<circle cx="48" cy="15" r="8" fill="${c}"/>`,
};
const HAIR_FRONT = {
  short: (c) => `<path d="M32 40c-2-15 6-23 16-23s19 8 16 23c-2-6-6-10-10-11-6 3-14 3-20 0-1 4-2 8-2 11z" fill="${c}"/>`,
  side: (c) => `<path d="M32 41c-2-16 6-24 17-24 10 0 18 8 15 22-4-7-10-11-19-10-5 1-9 5-13 12z" fill="${c}"/><path d="M45 19c4 4 11 6 17 7" stroke="${shade(c, 1.35)}" stroke-width="1.2" fill="none" opacity=".6"/>`,
  part: (c) => `<path d="M32 40c-2-15 6-23 16-23 11 0 18 8 16 23-3-8-9-12-16-12-1-3-1-6 0-9-1 3-2 6-1 9-7 0-12 5-15 12z" fill="${c}"/>`,
  curly: (c) => `<path d="M32 40c-3-15 6-23 16-23s19 8 16 23c-3-7-9-11-16-11s-13 4-16 11z" fill="${c}"/>${[[35, 25], [41, 20], [48, 18], [55, 20], [61, 25], [33, 32], [63, 32]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="${c}"/>`).join('')}`,
  messy: (c) => `<path d="M32 41c-3-13 3-21 10-23l2-5 4 4 5-5 2 6c7 2 11 10 9 23-3-6-7-10-12-10l-3-4-3 5c-6-1-11 3-14 9z" fill="${c}"/>`,
  long: (c) => `<path d="M32 42c-3-16 5-25 16-25s19 9 16 25c-2-9-7-14-12-15-3 4-10 7-17 6-1 3-2 6-3 9z" fill="${c}"/>`,
  wavy: (c) => `<path d="M32 42c-3-16 5-25 16-25s19 9 16 25c-3-8-8-12-13-13-5 4-12 5-17 4-1 3-2 6-2 9z" fill="${c}"/>`,
  bob: (c) => `<path d="M31 42c-2-16 6-25 17-25s19 9 17 25c-3-6-8-10-17-10s-14 4-17 10z" fill="${c}"/>`,
  ponytail: (c) => `<path d="M32 40c-2-15 6-23 16-23s19 8 16 23c-3-7-9-11-16-11s-13 4-16 11z" fill="${c}"/>`,
  bun: (c) => `<path d="M32 40c-2-15 6-23 16-23s19 8 16 23c-3-7-9-11-16-11s-13 4-16 11z" fill="${c}"/>`,
};

function outfit(look) {
  const top = look.top || '#E9EEF5', acc = look.accent || '#9AA7B8', skin = look.skin || '#F1C9A6';
  const body = `<path d="M12 98c2-22 17-32 36-32s34 10 36 32z" fill="${top}"/>`;
  const neck = `<path d="M42 54h12v12c-3 3-9 3-12 0z" fill="${shade(skin, .9)}"/>`;
  const parts = {
    apron: `<path d="M34 72h28v26H34z" fill="${acc}"/><path d="M36 72l-6-6M60 72l6-6" stroke="${acc}" stroke-width="3"/><path d="M42 66l6 6 6-6" fill="none" stroke="${shade(top, .85)}" stroke-width="2"/>`,
    coat: `<path d="M12 98c2-22 17-32 36-32s34 10 36 32z" fill="#FFFFFF"/><path d="M48 66l-9 32M48 66l9 32" stroke="#D9DDE6" stroke-width="2"/><path d="M40 66l8 10 8-10" fill="${acc}"/><path d="M38 70c-2 8 2 14 6 16" fill="none" stroke="#4E5668" stroke-width="2"/><circle cx="45" cy="87" r="2.6" fill="#4E5668"/>`,
    collar: `<path d="M40 64l8 10 8-10 4 6-12 6-12-6z" fill="#FFFFFF"/><path d="M48 74v24" stroke="${shade(top, .85)}" stroke-width="1.5"/>`,
    scarf: `<path d="M40 64l8 8 8-8 2 5-10 12-10-12z" fill="${acc}"/>`,
    scrubs: `<path d="M40 66l8 10 8-10" fill="${shade(skin, .9)}" stroke="${shade(top, .8)}" stroke-width="2"/><rect x="58" y="80" width="8" height="6" rx="1" fill="${shade(top, .85)}"/><path d="M61 78v4" stroke="#FFFFFF" stroke-width="1.5"/>`,
    turtleneck: `<rect x="40" y="58" width="16" height="12" rx="5" fill="${shade(top, 1.15)}"/><circle cx="48" cy="82" r="2" fill="${acc}"/>`,
    headband: `<path d="M40 64l8 9 8-9" fill="none" stroke="${acc}" stroke-width="3"/>`,
    suit: `<path d="M41 65l7 14 7-14" fill="#FFFFFF"/><path d="M46.5 69h3l1 13-2.5 4-2.5-4z" fill="${acc}"/><path d="M41 65l-7 33M55 65l7 33" stroke="${shade(top, 1.4)}" stroke-width="1.5" opacity=".6"/>`,
    hoodie: `<path d="M34 70c4 6 24 6 28 0" fill="none" stroke="${shade(top, .8)}" stroke-width="4"/><path d="M44 74v10M52 74v10" stroke="${acc}" stroke-width="1.6"/>`,
    tee: `<path d="M41 65q7 6 14 0" fill="none" stroke="${shade(top, 1.5)}" stroke-width="1.5"/>`,
    ribbon: `<path d="M48 70l-9-5v10zM48 70l9-5v10z" fill="${acc}"/><circle cx="48" cy="70" r="2.4" fill="${shade(acc, .8)}"/><path d="M40 64q8 5 16 0" fill="none" stroke="${shade(top, .85)}" stroke-width="1.5"/>`,
  };
  return { body, neck, extra: parts[look.accessory] || parts.collar };
}

// 使用者在「我」裡面選的頭像畫風：'auto'（依角色）| 'real' | 'anime'
let STYLE_PREF = 'auto';
export function setPortraitStyle(s) { STYLE_PREF = ['real', 'anime'].includes(s) ? s : 'auto'; }

export function portraitSVG(frame = {}, size = 48) {
  const look = frame.look && STYLE_PREF !== 'auto' ? { ...frame.look, style: STYLE_PREF === 'anime' ? 'anime' : undefined } : frame.look;
  const hue = frame.hue ?? 265;
  const id = nid('p');
  const bg = `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 50% 88%)"/><stop offset="1" stop-color="hsl(${(hue + 25) % 360} 42% 74%)"/></linearGradient>
    <clipPath id="${id}c"><circle cx="48" cy="48" r="48"/></clipPath></defs><circle cx="48" cy="48" r="48" fill="url(#${id}g)"/>`;
  if (!look) {
    const ch = String(frame.name || '?').slice(0, 1).replace(/[<&>"]/g, '');
    return `<svg viewBox="0 0 96 96" width="${size}" height="${size}" aria-hidden="true">${bg}<text x="48" y="63" text-anchor="middle" font-family="LXGW WenKai TC, serif" font-size="42" font-weight="700" fill="#fff">${ch}</text></svg>`;
  }
  const skin = look.skin || '#F1C9A6';
  const hc = look.hairColor || '#2A2421';
  const hair = look.hair || (frame.gender === 'female' ? 'long' : 'short');
  const o = outfit(look);
  const anime = look.style === 'anime';
  const eyes = anime
    ? `<ellipse cx="41.5" cy="42.5" rx="3.6" ry="4.6" fill="#2A2430"/><ellipse cx="54.5" cy="42.5" rx="3.6" ry="4.6" fill="#2A2430"/>
       <ellipse cx="41.5" cy="43.5" rx="2.6" ry="3.2" fill="${shade(look.accent || '#7A6BA8', 1)}" opacity=".7"/><ellipse cx="54.5" cy="43.5" rx="2.6" ry="3.2" fill="${shade(look.accent || '#7A6BA8', 1)}" opacity=".7"/>
       <circle cx="40.2" cy="40.8" r="1.4" fill="#fff"/><circle cx="53.2" cy="40.8" r="1.4" fill="#fff"/><circle cx="42.6" cy="45" r=".7" fill="#fff"/><circle cx="55.6" cy="45" r=".7" fill="#fff"/>
       <path d="M37.5 38.5q4-2.6 8 0M50.5 38.5q4-2.6 8 0" stroke="#2A2430" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
    : `<ellipse cx="42" cy="42.5" rx="1.7" ry="2.2" fill="#2A2430"/><ellipse cx="54" cy="42.5" rx="1.7" ry="2.2" fill="#2A2430"/>`;
  const face = `
    <ellipse cx="32.5" cy="42" rx="3" ry="4" fill="${shade(skin, .93)}"/><ellipse cx="63.5" cy="42" rx="3" ry="4" fill="${shade(skin, .93)}"/>
    <ellipse cx="48" cy="40" rx="15.5" ry="17.5" fill="${skin}"/>
    ${anime ? `<path d="M38 35q3.5-1.6 7 0M51 35q3.5-1.6 7 0" stroke="${shade(hc, 1.1)}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` : `<path d="M39 37.5q3-2 6 0M51 37.5q3-2 6 0" stroke="${shade(hc, 1.1)}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`}
    ${eyes}
    ${anime ? '<path d="M36 48.5l3-1.5M37.5 49.5l3-1.5M56 48l3 1.5M55.5 49.5l3 1.5" stroke="#E8889A" stroke-width="1" opacity=".8"/>' : '<circle cx="38.5" cy="48" r="3" fill="#E8889A" opacity=".28"/><circle cx="57.5" cy="48" r="3" fill="#E8889A" opacity=".28"/>'}
    ${anime ? '<path d="M46 51q2 1.6 4 0" stroke="#A4525E" stroke-width="1.4" fill="none" stroke-linecap="round"/>' : '<path d="M44.5 50.5q3.5 2.6 7 0" stroke="#A4525E" stroke-width="1.6" fill="none" stroke-linecap="round"/>'}`;
  const glasses = look.glasses ? `<g fill="none" stroke="#3A3640" stroke-width="1.4"><rect x="36.5" y="38.5" width="10" height="8" rx="3"/><rect x="49.5" y="38.5" width="10" height="8" rx="3"/><path d="M46.5 42h3"/></g>` : '';
  const earrings = look.earrings ? `<circle cx="32.5" cy="48" r="1.6" fill="${look.accent || '#C9A86A'}"/><circle cx="63.5" cy="48" r="1.6" fill="${look.accent || '#C9A86A'}"/>` : '';
  const flower = look.flower ? `<g transform="translate(60 25)">${[0, 72, 144, 216, 288].map(r => `<ellipse rx="2.4" ry="4" cy="-3.5" transform="rotate(${r})" fill="#F3A7B9"/>`).join('')}<circle r="2" fill="#F6D28B"/></g>` : '';
  const band = look.accessory === 'headband' ? `<path d="M33 31q15-9 30 0" stroke="${look.top || '#E8736B'}" stroke-width="3.5" fill="none" stroke-linecap="round"/>` : '';
  return `<svg viewBox="0 0 96 96" width="${size}" height="${size}" aria-hidden="true">${bg}<g clip-path="url(#${id}c)">
    ${HAIR_BACK[hair] ? HAIR_BACK[hair](shade(hc, .92)) : ''}
    ${o.body}${o.neck}${o.extra}${face}${glasses}${earrings}
    ${(HAIR_FRONT[hair] || HAIR_FRONT.short)(hc)}${band}${flower}</g></svg>`;
}

// Options offered in the custom-character builder.
export const LOOK_OPTIONS = {
  hair: {
    male: [['short', '清爽短髮'], ['side', '旁分'], ['part', '中分'], ['curly', '微捲'], ['messy', '亂亂的']],
    female: [['long', '長直髮'], ['wavy', '長捲髮'], ['bob', '短髮'], ['ponytail', '馬尾'], ['bun', '丸子頭']],
  },
  hairColor: [['#1F1D24', '黑'], ['#3A2A22', '深棕'], ['#7A4B33', '栗色'], ['#B07A4A', '亞麻'], ['#8C8A93', '灰']],
  top: [['#E9EEF5', '白襯衫'], ['#3B3A44', '深色'], ['#7E9C7E', '草綠'], ['#E8736B', '珊瑚'], ['#9AB3D6', '淺藍']],
  style: [['real', '寫實'], ['anime', '二次元']],
};

// ---------------------------------------------------------------- scenes
// viewBox 0 0 360 180. Each returns markup inside an <svg>.
const P = { ink: '#3B3561', plum: '#6E4C7E', rose: '#C2477F', amber: '#E09A2E', light: '#F6D28B', cream: '#F6EFE6', sage: '#7E9C7E', sky1: '#F4C9B8', sky2: '#B9A5D6', night: '#2E2A4A' };
const figure = (x, y, c1, c2, s = 1, flip = false) => `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
  <circle cx="0" cy="-34" r="7" fill="#F1C9A6"/><path d="M-7 -36c0-8 14-8 14 0-3-3-11-3-14 0z" fill="${c2}"/>
  <path d="M-9 -24c0-4 18-4 18 0v22h-18z" fill="${c1}"/><path d="M-7 -2h5v16h-5zM2 -2h5v16h-5z" fill="${P.ink}"/></g>`;

const SCENES = {
  cafe: () => `
    <rect width="360" height="180" fill="${P.cream}"/>
    <rect x="22" y="18" width="130" height="92" rx="6" fill="#CFE3EA"/><path d="M87 18v92M22 64h130" stroke="${P.cream}" stroke-width="5"/>
    <circle cx="125" cy="40" r="10" fill="${P.light}" opacity=".8"/>
    ${[0, 1, 2].map(i => `<g transform="translate(${200 + i * 48} 0)"><path d="M0 0v34" stroke="${P.ink}" stroke-width="1.5"/><path d="M-12 34h24l-4 10h-16z" fill="${P.amber}"/><ellipse cx="0" cy="46" rx="10" ry="3" fill="${P.light}" opacity=".7"/></g>`).join('')}
    <rect x="0" y="122" width="360" height="58" fill="#B9845A"/><rect x="0" y="118" width="360" height="8" fill="#8E5E3B"/>
    <rect x="236" y="88" width="24" height="30" rx="3" fill="#6B4A32"/><rect x="232" y="84" width="32" height="6" rx="2" fill="#4E3626"/>
    <path d="M278 104h16v14h-16z" fill="#fff"/><path d="M294 107a5 5 0 0 1 0 8" stroke="#fff" stroke-width="2.5" fill="none"/>
    <path d="M284 98c-2-4 2-6 0-10M289 98c-2-4 2-6 0-10" stroke="${P.plum}" stroke-width="1.5" fill="none" opacity=".5"/>
    ${figure(178, 118, P.sage, '#6B4A32', 1.05)}
    <path d="M168 92h20v8h-20z" fill="#2F5D50"/>`,
  mrt: () => `
    <rect width="360" height="180" fill="#E7E5EE"/>
    <rect x="0" y="16" width="360" height="70" fill="#CBD4E6"/>
    ${[0, 1, 2].map(i => `<rect x="${20 + i * 116}" y="26" width="96" height="48" rx="12" fill="${P.night}"/><path d="M${30 + i * 116} 64l40-30" stroke="#5C5A86" stroke-width="6" opacity=".6"/>`).join('')}
    <rect x="0" y="86" width="360" height="8" fill="#F28C28"/>
    <path d="M70 0v150M290 0v150" stroke="#B8BCC8" stroke-width="5"/>
    <path d="M70 22h220" stroke="#B8BCC8" stroke-width="4"/>
    ${[110, 150, 210, 250].map(x => `<path d="M${x} 22v12" stroke="#B8BCC8" stroke-width="2"/><circle cx="${x}" cy="40" r="6" fill="none" stroke="#B8BCC8" stroke-width="2.5"/>`).join('')}
    <rect x="0" y="150" width="360" height="30" fill="#9EA3B3"/>
    ${figure(150, 150, P.ink, '#1F1D24', 1.15)}${figure(176, 150, P.rose, '#3A2A22', 1.1, true)}
    <path d="M160 108l8 4" stroke="${P.amber}" stroke-width="2"/><path d="M158 102l4 2M163 98l3 3" stroke="${P.amber}" stroke-width="1.6"/>`,
  colleague: () => `
    <rect width="360" height="180" fill="#EEF1F6"/>
    <rect x="18" y="20" width="324" height="70" rx="4" fill="#DCE6F2"/>
    ${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${30 + i * 52}" y="30" width="40" height="50" fill="#BBD0E8"/>`).join('')}
    <rect x="0" y="120" width="360" height="60" fill="#D6D2CA"/>
    <rect x="40" y="104" width="120" height="8" fill="#8E7A66"/><rect x="200" y="104" width="120" height="8" fill="#8E7A66"/>
    <rect x="70" y="80" width="40" height="26" rx="3" fill="${P.ink}"/><rect x="74" y="84" width="32" height="18" fill="#7FA6C9"/>
    <rect x="240" y="80" width="40" height="26" rx="3" fill="${P.ink}"/><rect x="244" y="84" width="32" height="18" fill="#F4C9B8"/>
    <rect x="296" y="90" width="12" height="14" rx="2" fill="${P.sage}"/><path d="M302 90c-4-8 2-12 0-18 4 4 6 10 0 18z" fill="#5E8C6A"/>
    ${figure(180, 150, '#9AB3D6', '#3A2A22', 1.15)}
    <rect x="186" y="118" width="16" height="12" rx="2" fill="#fff"/><path d="M190 122h8M190 126h6" stroke="${P.ink}" stroke-width="1"/>`,
  store: () => `
    <rect width="360" height="180" fill="${P.night}"/>
    ${[[30, 20], [80, 40], [300, 26], [340, 50], [250, 14]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#fff" opacity=".7"/>`).join('')}
    <circle cx="320" cy="34" r="12" fill="${P.light}" opacity=".9"/><circle cx="326" cy="30" r="10" fill="${P.night}"/>
    <rect x="70" y="48" width="220" height="112" fill="#E9EEF2"/>
    <rect x="70" y="48" width="220" height="16" fill="#2E8B57"/><rect x="70" y="64" width="220" height="6" fill="${P.amber}"/>
    <rect x="86" y="80" width="188" height="80" fill="#FFF8DF"/>
    ${[0, 1, 2].map(r => [0, 1, 2, 3, 4, 5].map(c => `<rect x="${96 + c * 30}" y="${88 + r * 18}" width="20" height="10" rx="2" fill="${['#E8736B', '#7FA6C9', '#F6D28B', '#7E9C7E'][(r + c) % 4]}"/>`).join('')).join('')}
    <path d="M180 80v80" stroke="#E9EEF2" stroke-width="4"/>
    <rect x="0" y="160" width="360" height="20" fill="#24213B"/>
    <path d="M70 160l-30 20h300l-50-20z" fill="#FFF3C4" opacity=".18"/>
    ${figure(150, 160, P.plum, '#1F1D24', 1.05)}${figure(206, 160, '#6FA8A1', '#2B2125', 1.05, true)}`,
  rain: () => `
    <rect width="360" height="180" fill="#A9B4C8"/>
    <rect x="0" y="40" width="70" height="140" fill="#8E97AE"/><rect x="290" y="30" width="70" height="150" fill="#8E97AE"/>
    ${[0, 1, 2, 3].map(r => [0, 1].map(c => `<rect x="${12 + c * 28}" y="${54 + r * 28}" width="16" height="16" fill="${(r + c) % 2 ? P.light : '#BFC6D6'}" opacity=".85"/>`).join('')).join('')}
    <rect x="110" y="60" width="140" height="10" fill="${P.rose}"/><path d="M110 70h140l-8 10H118z" fill="#A83B6C"/>
    <rect x="110" y="80" width="140" height="80" fill="#5E5A7A"/><rect x="124" y="90" width="112" height="70" fill="#F6D28B" opacity=".55"/>
    ${figure(160, 160, '#E9EEF5', '#3A2A22', 1.05)}${figure(196, 160, P.sage, '#7A4B33', 1.05, true)}
    <rect x="0" y="160" width="360" height="20" fill="#6E7891"/>
    ${Array.from({ length: 36 }, (_, i) => { const x = (i * 53) % 360, y = (i * 37) % 150; return `<path d="M${x} ${y}l-4 12" stroke="#E7ECF5" stroke-width="1.4" opacity=".7"/>`; }).join('')}`,
  friends: () => `
    <rect width="360" height="180" fill="#3F3558"/>
    <path d="M0 26q90 30 180 0t180 0" stroke="#5E5480" stroke-width="1.5" fill="none"/>
    ${Array.from({ length: 14 }, (_, i) => { const x = 12 + i * 26, y = 26 + Math.sin(i / 1.4) * 12 + 8; return `<circle cx="${x}" cy="${y}" r="4" fill="${P.light}"/><circle cx="${x}" cy="${y}" r="9" fill="${P.light}" opacity=".18"/>`; }).join('')}
    <rect x="60" y="112" width="240" height="12" rx="3" fill="#8E5E3B"/><rect x="0" y="150" width="360" height="30" fill="#2E2744"/>
    ${[110, 150, 210, 250].map((x, i) => `<path d="M${x} 112v-14h8v14" fill="none" stroke="#fff" stroke-width="1.5" opacity=".8"/><rect x="${x + 1}" y="${104}" width="6" height="8" fill="${['#E8736B', P.light, '#9AB3D6', P.rose][i]}" opacity=".9"/>`).join('')}
    ${figure(90, 150, P.rose, '#1F1D24', 1.05)}${figure(130, 150, '#9AB3D6', '#7A4B33', 1)}${figure(232, 150, P.sage, '#3A2A22', 1.05, true)}${figure(272, 150, P.amber, '#2B2125', 1, true)}`,
  gym: () => `
    <rect width="360" height="180" fill="#ECEFF3"/>
    <rect x="20" y="16" width="200" height="80" rx="4" fill="#CFE3EA"/><path d="M120 16v80" stroke="#ECEFF3" stroke-width="5"/>
    <rect x="0" y="130" width="360" height="50" fill="#4A4F5E"/><rect x="0" y="126" width="360" height="6" fill="#E8736B"/>
    <rect x="250" y="40" width="80" height="86" fill="#D6DAE2"/>${[0, 1, 2].map(i => `<rect x="258" y="${48 + i * 26}" width="64" height="5" fill="#8E95A6"/><circle cx="${266 + i * 18}" cy="${58 + i * 26}" r="7" fill="${P.ink}"/>`).join('')}
    <g transform="translate(90 112)"><rect x="-26" y="-2" width="52" height="4" fill="#5A5F6E"/><rect x="-32" y="-10" width="8" height="20" rx="2" fill="${P.ink}"/><rect x="24" y="-10" width="8" height="20" rx="2" fill="${P.ink}"/></g>
    ${figure(170, 130, '#E8736B', '#231F22', 1.15)}${figure(204, 130, '#9AB3D6', '#1F1D24', 1.15, true)}
    <rect x="300" y="132" width="10" height="16" rx="3" fill="#7FA6C9"/>`,
  bookstore: () => `
    <rect width="360" height="180" fill="${P.cream}"/>
    ${[0, 1].map(s => `<g transform="translate(${s ? 230 : 20} 14)"><rect width="110" height="146" fill="#9C6B45"/>${[0, 1, 2, 3].map(r => `<rect x="6" y="${8 + r * 34}" width="98" height="28" fill="#6E4A30"/>${Array.from({ length: 9 }, (_, b) => `<rect x="${9 + b * 10.5}" y="${12 + r * 34 + (b % 3)}" width="8" height="${22 - (b % 3)}" fill="${['#E8736B', '#7FA6C9', '#F6D28B', '#7E9C7E', P.plum, '#E9EEF5'][(b + r + s) % 6]}"/>`).join('')}`).join('')}</g>`).join('')}
    <rect x="0" y="160" width="360" height="20" fill="#D8C8B4"/>
    <circle cx="180" cy="30" r="14" fill="${P.light}" opacity=".7"/><path d="M180 0v16" stroke="${P.ink}" stroke-width="1.5"/>
    ${figure(165, 160, P.sage, '#1F1D24', 1.1)}${figure(196, 160, '#3B3A44', '#17151B', 1.1, true)}
    <rect x="172" y="122" width="14" height="10" fill="${P.rose}" transform="rotate(-12 179 127)"/>`,
  exhibition: () => `
    <rect width="360" height="180" fill="#F3F1F6"/>
    <rect x="0" y="146" width="360" height="34" fill="#D9D4E2"/>
    <rect x="30" y="34" width="80" height="64" fill="#fff" stroke="#3B3A44" stroke-width="3"/><circle cx="60" cy="62" r="14" fill="${P.rose}"/><rect x="72" y="58" width="26" height="30" fill="#7FA6C9"/>
    <rect x="140" y="24" width="80" height="90" fill="#fff" stroke="#3B3A44" stroke-width="3"/><path d="M150 100l20-34 16 22 10-12 14 24z" fill="${P.sage}"/><circle cx="198" cy="44" r="8" fill="${P.amber}"/>
    <rect x="250" y="40" width="80" height="58" fill="#fff" stroke="#3B3A44" stroke-width="3"/><path d="M258 90q30-40 64 0" stroke="${P.plum}" stroke-width="6" fill="none"/>
    ${[70, 180, 290].map(x => `<path d="M${x} 0l-14 24h28z" fill="${P.light}" opacity=".35"/>`).join('')}
    ${figure(150, 146, '#3B3A44', '#17151B', 1.05)}${figure(196, 146, P.rose, '#7A4B33', 1.05, true)}`,
  city: () => `
    <defs><linearGradient id="skyc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.sky2}"/><stop offset="1" stop-color="${P.sky1}"/></linearGradient></defs>
    <rect width="360" height="180" fill="url(#skyc)"/>
    <circle cx="282" cy="62" r="20" fill="#FBE3C2"/>
    ${[[0, 90, 40], [36, 70, 34], [66, 100, 30], [92, 60, 42], [130, 84, 36], [162, 50, 30], [188, 76, 44], [228, 96, 34], [258, 66, 40], [294, 88, 30], [320, 58, 40]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${180 - y}" fill="${P.plum}" opacity=".85"/>`).join('')}
    ${Array.from({ length: 40 }, (_, i) => { const x = 8 + (i * 47) % 344, y = 70 + (i * 29) % 96; return `<rect x="${x}" y="${y}" width="5" height="6" fill="${P.light}" opacity="${i % 3 ? .9 : .35}"/>`; }).join('')}
    <rect x="0" y="160" width="360" height="20" fill="${P.ink}"/>`,
  river: () => `
    <defs><linearGradient id="skyr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3B58A"/><stop offset="1" stop-color="#F7D9B5"/></linearGradient></defs>
    <rect width="360" height="180" fill="url(#skyr)"/>
    <circle cx="250" cy="92" r="22" fill="#FBE7C6"/>
    <path d="M0 96h360v84H0z" fill="#E7A27F"/><path d="M0 100h360v80H0z" fill="#C98A7A" opacity=".55"/>
    ${[0, 1, 2, 3, 4].map(i => `<path d="M${210 + i * 8} ${112 + i * 10}h${60 - i * 8}" stroke="#FBE7C6" stroke-width="2" opacity=".7"/>`).join('')}
    <path d="M30 96q90-46 180 0" fill="none" stroke="${P.plum}" stroke-width="5"/>
    ${[50, 80, 110, 140, 170, 195].map(x => `<path d="M${x} ${96 - Math.sin((x - 30) / 180 * Math.PI) * 44}V96" stroke="${P.plum}" stroke-width="2"/>`).join('')}
    <path d="M0 150q90-14 180-4t180-2v36H0z" fill="#7E9C7E"/>
    <path d="M0 160h360" stroke="#E9DCC8" stroke-width="6"/>
    <g transform="translate(286 150)"><circle cx="-12" cy="0" r="8" fill="none" stroke="${P.ink}" stroke-width="2.5"/><circle cx="12" cy="0" r="8" fill="none" stroke="${P.ink}" stroke-width="2.5"/><path d="M-12 0l8-12h12l4 12M-4 -12l-2-6" stroke="${P.ink}" stroke-width="2.5" fill="none"/><circle cx="2" cy="-26" r="5" fill="#F1C9A6"/><path d="M0 -20l-4 8" stroke="${P.rose}" stroke-width="5"/></g>`,
  mountain: () => `
    <rect width="360" height="180" fill="#CFE3EA"/>
    <path d="M0 120l60-50 50 34 60-60 70 56 50-30 70 50v60H0z" fill="#9DB8A2"/>
    <path d="M0 140l80-30 70 20 80-36 70 28 60-14v72H0z" fill="#7E9C7E"/>
    ${Array.from({ length: 14 }, (_, i) => `<rect x="${40 + i * 22}" y="${150 - (i % 4) * 6}" width="8" height="${12 + (i % 4) * 6}" fill="${P.plum}" opacity=".35"/>`).join('')}
    <path d="M150 180c10-30 30-40 40-70" stroke="#C9A98A" stroke-width="16" fill="none" stroke-linecap="round"/>
    ${[0, 1, 2, 3, 4, 5].map(i => `<path d="M${152 + i * 6} ${172 - i * 12}h14" stroke="#9C7B5E" stroke-width="2.5"/>`).join('')}
    ${[[40, 110], [70, 118], [300, 112], [330, 120]].map(([x, y]) => `<path d="M${x} ${y}l10-26 10 26z" fill="#5E8C6A"/>`).join('')}
    <circle cx="300" cy="36" r="14" fill="#FBE7C6"/>`,
  beach: () => `
    <rect width="360" height="180" fill="#BFE0EC"/>
    <circle cx="80" cy="44" r="16" fill="#FBE7C6"/>
    <rect y="80" width="360" height="54" fill="#6FA8C9"/>
    ${[0, 1, 2].map(i => `<path d="M0 ${96 + i * 14}q30-6 60 0t60 0 60 0 60 0 60 0 60 0" fill="none" stroke="#E9F4F8" stroke-width="2" opacity=".7"/>`).join('')}
    <path d="M0 134q90-12 180 0t180 0v46H0z" fill="#F2DDB6"/>
    <path d="M0 134q90-12 180 0t180 0" fill="none" stroke="#fff" stroke-width="3" opacity=".8"/>
    <g transform="translate(270 150)"><path d="M0 0v-40" stroke="${P.ink}" stroke-width="2"/><path d="M-26 -36q26-20 52 0z" fill="${P.rose}"/></g>
    ${[[120, 160], [200, 168], [60, 170]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="2.5" fill="#D9B98E"/>`).join('')}
    <path d="M180 60q6-6 12 0M196 52q5-5 10 0" stroke="${P.ink}" stroke-width="1.6" fill="none"/>`,
  nightmarket: () => `
    <rect width="360" height="180" fill="${P.night}"/>
    ${Array.from({ length: 9 }, (_, i) => `<g transform="translate(${20 + i * 40} 30)"><path d="M0 0v10" stroke="#fff" stroke-width="1" opacity=".5"/><ellipse cx="0" cy="18" rx="8" ry="10" fill="${['#E8736B', P.amber, P.rose][i % 3]}"/><ellipse cx="0" cy="18" rx="14" ry="16" fill="${P.light}" opacity=".15"/></g>`).join('')}
    ${[0, 1, 2].map(i => `<g transform="translate(${18 + i * 118} 70)"><rect width="100" height="12" fill="${['#E8736B', '#2E8B57', P.amber][i]}"/><rect y="12" width="100" height="58" fill="#4A4265"/><rect x="8" y="24" width="84" height="30" fill="${P.light}" opacity=".85"/>${[0, 1, 2, 3].map(k => `<circle cx="${20 + k * 20}" cy="40" r="6" fill="${['#C25A3C', '#E8B04A', '#9C5B3A', '#F2D38B'][k]}"/>`).join('')}</g>`).join('')}
    <rect y="140" width="360" height="40" fill="#2A2540"/>
    ${figure(90, 165, P.rose, '#1F1D24', .9)}${figure(150, 165, '#9AB3D6', '#3A2A22', .9)}${figure(250, 165, P.sage, '#2B2125', .9, true)}${figure(300, 165, P.amber, '#7A4B33', .9, true)}`,
  park: () => `
    <rect width="360" height="180" fill="#D9ECE0"/>
    <circle cx="300" cy="40" r="14" fill="#FBE7C6"/>
    <path d="M0 120q180-30 360 0v60H0z" fill="#9CC79F"/>
    ${[[50, 120, 34], [120, 112, 28], [250, 114, 30], [320, 122, 26]].map(([x, y, r]) => `<rect x="${x - 3}" y="${y - 4}" width="6" height="28" fill="#8E5E3B"/><circle cx="${x}" cy="${y - 20}" r="${r}" fill="#5E8C6A"/><circle cx="${x + r / 2}" cy="${y - 28}" r="${r * .6}" fill="#7E9C7E"/>`).join('')}
    <path d="M150 180q20-40 80-60" stroke="#EADBC2" stroke-width="18" fill="none"/>
    <g transform="translate(180 132)"><rect x="-26" y="0" width="52" height="5" fill="#8E5E3B"/><rect x="-26" y="-12" width="52" height="4" fill="#8E5E3B"/><path d="M-22 5v12M22 5v12" stroke="#5E4030" stroke-width="3"/></g>
    <g transform="translate(110 160)"><ellipse cx="0" cy="0" rx="12" ry="7" fill="#C9935A"/><circle cx="12" cy="-6" r="6" fill="#C9935A"/><path d="M-10 4v8M8 4v8" stroke="#8E5E3B" stroke-width="3"/><path d="M-12 -2q-8-6-6-12" stroke="#C9935A" stroke-width="3" fill="none"/></g>`,
  album: () => `
    <rect width="360" height="180" fill="${P.cream}"/>
    <g transform="rotate(-8 120 90)"><rect x="70" y="40" width="96" height="110" fill="#fff"/><rect x="78" y="48" width="80" height="74" fill="#CFE3EA"/><path d="M78 122l26-30 18 18 12-10 24 22z" fill="${P.sage}"/><circle cx="140" cy="66" r="8" fill="${P.amber}"/></g>
    <g transform="rotate(7 240 90)"><rect x="190" y="34" width="96" height="110" fill="#fff"/><rect x="198" y="42" width="80" height="74" fill="#F4C9B8"/><circle cx="238" cy="80" r="18" fill="${P.rose}" opacity=".8"/></g>
    <path d="M176 140c-8-10-18-4-12 6l12 12 12-12c6-10-4-16-12-6z" fill="${P.rose}"/>`,
};

export function sceneSVG(id, { label = '' } = {}) {
  const draw = SCENES[id] || SCENES.city;
  return `<svg viewBox="0 0 360 180" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label.replace(/"/g, '')}">${draw()}</svg>`;
}
export const hasScene = (id) => !!SCENES[id];

// ---------------------------------------------------------------- stickers
// 原創貼圖「小糰」：一顆軟軟的麻糬，16 種表情。
export const STICKER_LIST = [
  ['hi', '嗨'], ['ok', '好喔'], ['love', '喜歡你'], ['thanks', '謝謝'], ['sorry', '對不起'], ['night', '晚安'], ['hungry', '好餓'], ['cry', '哭哭'],
  ['laugh', '笑死'], ['hmph', '哼'], ['shy', '害羞'], ['cheer', '加油'], ['hug', '抱抱'], ['what', '？？'], ['busy', '忙碌中'], ['miss', '想你'],
];
export function stickerSVG(id, size = 120) {
  const label = (STICKER_LIST.find(s => s[0] === id) || [id, id])[1];
  const ink = '#3B3561', body = '#FFF6EC', blush = '#F4A6B4';
  const eyes = {
    hi: 'M44 56 a4 4 0 1 0 0.1 0 M76 56 a4 4 0 1 0 0.1 0', ok: 'M40 57 q4 -5 8 0 M72 57 q4 -5 8 0', love: '', thanks: 'M40 57 q4 -5 8 0 M72 57 q4 -5 8 0',
    sorry: 'M39 54 l9 4 M81 54 l-9 4', night: 'M39 58 q5 4 10 0 M71 58 q5 4 10 0', hungry: 'M44 56 a4 4 0 1 0 0.1 0 M76 56 a4 4 0 1 0 0.1 0',
    cry: 'M39 55 l9 3 M81 55 l-9 3', laugh: 'M39 58 l5 -5 l5 5 M71 58 l5 -5 l5 5', hmph: 'M38 54 l11 3 M82 54 l-11 3', shy: 'M40 57 q4 -5 8 0 M72 57 q4 -5 8 0',
    cheer: 'M44 56 a4 4 0 1 0 0.1 0 M76 56 a4 4 0 1 0 0.1 0', hug: 'M40 57 q4 -5 8 0 M72 57 q4 -5 8 0', what: 'M44 56 a4 4 0 1 0 0.1 0 M76 56 a5 5 0 1 0 0.1 0',
    busy: 'M38 56 h10 M72 56 h10', miss: 'M40 58 q4 4 8 0 M72 58 q4 4 8 0',
  }[id] || '';
  const mouth = {
    hi: 'M56 68 q4 5 8 0', ok: 'M55 67 q5 6 10 0', love: 'M56 68 q4 5 8 0', thanks: 'M55 67 q5 6 10 0', sorry: 'M55 71 q5 -4 10 0', night: 'M58 68 h4',
    hungry: 'M55 66 q5 10 10 0 z', cry: 'M55 71 q5 -5 10 0', laugh: 'M53 65 q7 12 14 0 z', hmph: 'M56 70 h8', shy: 'M57 68 q3 3 6 0', cheer: 'M54 65 q6 10 12 0 z',
    hug: 'M56 68 q4 5 8 0', what: 'M58 69 a2 2 0 1 0 0.1 0', busy: 'M55 69 q5 -3 10 0', miss: 'M57 68 q3 3 6 0',
  }[id] || '';
  const extra = {
    love: `<path d="M38 56 c0-5 8-5 8 0 c0-5 8-5 8 0 c0 5-8 9-8 9 s-8-4-8-9z M66 56 c0-5 8-5 8 0 c0-5 8-5 8 0 c0 5-8 9-8 9 s-8-4-8-9z" fill="#E0525F"/>`,
    hi: `<path d="M96 40 q10 -6 12 4" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="100" cy="52" rx="7" ry="9" fill="${body}" stroke="${ink}" stroke-width="3"/>`,
    night: `<path d="M92 22 a10 10 0 1 0 10 14 a8 8 0 1 1 -10 -14z" fill="#F6D28B"/><text x="20" y="34" font-size="14" fill="${ink}">z z</text>`,
    hungry: `<path d="M84 74 q3 8 0 12" stroke="#7FB8E6" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    cry: `<path d="M42 62 q-3 10 0 16 M78 62 q3 10 0 16" stroke="#7FB8E6" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    laugh: `<path d="M30 46 l-8 -6 M90 46 l8 -6" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`,
    hmph: `<path d="M88 30 l6 6 m0 -6 l-6 6" stroke="#E0525F" stroke-width="3" stroke-linecap="round"/>`,
    shy: `<ellipse cx="40" cy="66" rx="9" ry="5" fill="${blush}"/><ellipse cx="80" cy="66" rx="9" ry="5" fill="${blush}"/>`,
    cheer: `<path d="M98 34 l4 -14 l4 14 z" fill="#F6D28B" stroke="${ink}" stroke-width="2"/><path d="M18 50 l8 -4" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`,
    hug: `<path d="M24 72 q-6 -14 8 -16 M96 72 q6 -14 -8 -16" stroke="${ink}" stroke-width="3" fill="${body}" stroke-linecap="round"/>`,
    what: `<text x="88" y="38" font-size="22" font-weight="700" fill="${ink}">?</text>`,
    busy: `<rect x="84" y="62" width="22" height="16" rx="3" fill="#9AB3D6" stroke="${ink}" stroke-width="2"/><path d="M26 36 l6 4 M24 46 l7 1" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`,
    miss: `<path d="M92 26 c0-4 6-4 6 0 c0-4 6-4 6 0 c0 4-6 7-6 7 s-6-3-6-7z" fill="#E0525F"/>`,
    thanks: `<path d="M50 86 q10 6 20 0" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    sorry: `<path d="M30 30 q6 4 4 10" stroke="#7FB8E6" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    ok: `<circle cx="98" cy="70" r="7" fill="none" stroke="${ink}" stroke-width="3"/>`,
  }[id] || '';
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="貼圖：${label}">
    <ellipse cx="60" cy="98" rx="34" ry="5" fill="rgba(59,53,97,.12)"/>
    <path d="M36 30 q-4 -12 8 -10 M84 30 q4 -12 -8 -10" stroke="${ink}" stroke-width="3" fill="${body}" stroke-linecap="round"/>
    <path d="M20 66 q0 -40 40 -40 q40 0 40 40 q0 30 -40 30 q-40 0 -40 -30z" fill="${body}" stroke="${ink}" stroke-width="3.5"/>
    ${id !== 'shy' ? `<ellipse cx="38" cy="66" rx="6" ry="3.5" fill="${blush}" opacity=".7"/><ellipse cx="82" cy="66" rx="6" ry="3.5" fill="${blush}" opacity=".7"/>` : ''}
    ${eyes ? `<path d="${eyes}" stroke="${ink}" stroke-width="3.2" fill="${/a4|a5/.test(eyes) ? ink : 'none'}" stroke-linecap="round"/>` : ''}
    ${mouth ? `<path d="${mouth}" stroke="${ink}" stroke-width="3" fill="${/z$/.test(mouth) ? '#E07A86' : 'none'}" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${extra}
    <text x="60" y="116" text-anchor="middle" font-size="15" font-weight="700" fill="${ink}" font-family="'jf-openhuninn','Noto Sans TC',sans-serif">${label}</text>
  </svg>`;
}

// ---------------------------------------------------------------- mascots
// 系統吉祥物（原創）：三種系統主題各一隻。face: idle | happy | wow
export const APP_THEMES = [
  ['milk', '溫暖手帳', '方格紙和紙膠帶，像在寫交換日記。陪你的是小糰'],
  ['night', '夜晚電台', '深夜的星空和柔光，適合晚睡的人。陪你的是小月'],
  ['forest', '清新日光', '大標題、多留白，乾淨明亮。陪你的是小芽'],
];
export function mascotSVG(theme = 'milk', face = 'idle') {
  const ink = theme === 'night' ? '#2A2550' : theme === 'forest' ? '#2F3B2A' : '#3B3561';
  const eyes = face === 'happy' ? `<path d="M22 34 q3-4 6 0 M36 34 q3-4 6 0" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : face === 'wow' ? `<circle cx="25" cy="33" r="2.6" fill="${ink}"/><circle cx="39" cy="33" r="2.6" fill="${ink}"/>`
    : theme === 'night' ? `<path d="M22 34 q3 3 6 0 M36 34 q3 3 6 0" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : `<circle cx="25" cy="33" r="2.4" fill="${ink}"/><circle cx="39" cy="33" r="2.4" fill="${ink}"/>`;
  const mouth = face === 'wow' ? `<ellipse cx="32" cy="43" rx="3" ry="3.6" fill="#E07A86"/>` : `<path d="M28 41 q4 4 8 0" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  if (theme === 'night') return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M8 38 q0-24 24-24 q24 0 24 24 q0 16-24 16 q-24 0-24-16z" fill="#C9C2F2" stroke="${ink}" stroke-width="3"/>
    <path d="M40 4 a12 12 0 1 0 14 16 a9 9 0 1 1 -14 -16z" fill="#F6D28B" stroke="${ink}" stroke-width="2.4"/>
    <path d="M12 12 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6z" fill="#F6D28B"/>
    ${eyes}${mouth}<ellipse cx="18" cy="41" rx="4" ry="2.4" fill="#F4A6C8" opacity=".8"/><ellipse cx="46" cy="41" rx="4" ry="2.4" fill="#F4A6C8" opacity=".8"/></svg>`;
  if (theme === 'forest') return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 16 q-2-8 -10-10 q2 9 10 10z M32 16 q3-9 12-9 q-3 9 -12 9z" fill="#8CC08A" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M32 16 v4" stroke="${ink}" stroke-width="2.4"/>
    <path d="M10 40 q0-20 22-20 q22 0 22 20 q0 16-22 16 q-22 0-22-16z" fill="#E9D3A8" stroke="${ink}" stroke-width="3"/>
    <circle cx="20" cy="46" r="1.2" fill="#B98A52"/><circle cx="44" cy="47" r="1.2" fill="#B98A52"/><circle cx="47" cy="44" r="1" fill="#B98A52"/>
    ${eyes}${mouth}<ellipse cx="19" cy="40" rx="4" ry="2.4" fill="#F0A58E" opacity=".8"/><ellipse cx="45" cy="40" rx="4" ry="2.4" fill="#F0A58E" opacity=".8"/></svg>`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M20 18 q-3-8 4-8 M44 18 q3-8 -4-8" stroke="${ink}" stroke-width="3" fill="#FFF6EC" stroke-linecap="round"/>
    <path d="M8 38 q0-24 24-24 q24 0 24 24 q0 16-24 16 q-24 0-24-16z" fill="#FFF6EC" stroke="${ink}" stroke-width="3"/>
    <path d="M27 9 c0-4 5-4 5 0 c0-4 5-4 5 0 c0 4-5 7-5 7 s-5-3-5-7z" fill="#E0525F"/>
    ${eyes}${mouth}<ellipse cx="18" cy="40" rx="4" ry="2.5" fill="#F4A6B4"/><ellipse cx="46" cy="40" rx="4" ry="2.5" fill="#F4A6B4"/></svg>`;
}
