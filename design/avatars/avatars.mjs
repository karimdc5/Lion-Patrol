// Lion Patrol toy avatars (item 14) — PREVIEW ONLY. Original, toy-like set drawn from simple shapes.
// Not imported by the app (lives outside src/, so it can never reach the bundle). Ship only after
// Karim approves the previews: then move into src/ behind AVATARS_ENABLED.
const eyes = (y = 58, dx = 14, r = 6.5, color = '#1B1F2A') =>
  `<circle cx="${64 - dx}" cy="${y}" r="${r}" fill="${color}"/><circle cx="${64 + dx}" cy="${y}" r="${r}" fill="${color}"/>` +
  `<circle cx="${64 - dx + 2.2}" cy="${y - 2.4}" r="${r * 0.33}" fill="#fff"/><circle cx="${64 + dx + 2.2}" cy="${y - 2.4}" r="${r * 0.33}" fill="#fff"/>`;
const cheeks = (y = 70, dx = 24, c = '#FF8FA3') => `<ellipse cx="${64 - dx}" cy="${y}" rx="6" ry="3.6" fill="${c}" opacity=".55"/><ellipse cx="${64 + dx}" cy="${y}" rx="6" ry="3.6" fill="${c}" opacity=".55"/>`;
const smile = (y = 72, w = 8, c = '#1B1F2A') => `<path d="M${64 - w} ${y} Q64 ${y + w * 0.9} ${64 + w} ${y}" stroke="${c}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
const bg = (a, b) => `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="128" height="128" rx="34" fill="url(#g)"/>`;
const shine = `<ellipse cx="44" cy="30" rx="16" ry="7" fill="#fff" opacity=".18" transform="rotate(-18 44 30)"/>`;

export const AVATARS = [
  { id: 'lion-cub', name: 'Lion Cub', svg: bg('#3A2A10', '#1E1608') +
    `<circle cx="64" cy="66" r="42" fill="#C98A2E"/>` + Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<circle cx="${64 + Math.cos(a) * 40}" cy="${66 + Math.sin(a) * 40}" r="11" fill="#B4721F"/>`; }).join('') +
    `<circle cx="64" cy="66" r="31" fill="#F2C14E"/><circle cx="42" cy="42" r="8" fill="#F2C14E"/><circle cx="86" cy="42" r="8" fill="#F2C14E"/><circle cx="42" cy="42" r="4" fill="#E8A13A"/><circle cx="86" cy="42" r="4" fill="#E8A13A"/>` +
    eyes(62, 11, 5.5) + `<path d="M58 72 L70 72 L64 79 Z" fill="#7A3E1D"/>` + smile(80, 6) + cheeks(74, 20) },
  { id: 'robo', name: 'Robo', svg: bg('#173045', '#0C1A26') +
    `<line x1="64" y1="18" x2="64" y2="32" stroke="#9FB3C8" stroke-width="4" stroke-linecap="round"/><circle cx="64" cy="16" r="6" fill="#FF6B6B"/>` +
    `<rect x="26" y="32" width="76" height="68" rx="20" fill="#C9D6E3"/><rect x="34" y="44" width="60" height="34" rx="12" fill="#1B2C3E"/>` +
    `<circle cx="50" cy="61" r="7" fill="#5CE1E6"/><circle cx="78" cy="61" r="7" fill="#5CE1E6"/><circle cx="52" cy="59" r="2.4" fill="#fff"/><circle cx="80" cy="59" r="2.4" fill="#fff"/>` +
    `<rect x="48" y="86" width="32" height="6" rx="3" fill="#7F93A8"/><rect x="18" y="56" width="10" height="20" rx="5" fill="#9FB3C8"/><rect x="100" y="56" width="10" height="20" rx="5" fill="#9FB3C8"/>` },
  { id: 'owl', name: 'Night Owl', svg: bg('#2A1E3F', '#150F22') +
    `<path d="M30 40 L44 28 L50 44 Z M98 40 L84 28 L78 44 Z" fill="#7E5BB5"/><ellipse cx="64" cy="70" rx="38" ry="40" fill="#9A76D1"/><ellipse cx="64" cy="84" rx="22" ry="20" fill="#E8DDF7"/>` +
    `<circle cx="48" cy="58" r="14" fill="#fff"/><circle cx="80" cy="58" r="14" fill="#fff"/>` + eyes(58, 16, 7) + `<path d="M58 70 L70 70 L64 80 Z" fill="#F5A524"/>` },
  { id: 'fox', name: 'Fox', svg: bg('#3D1F12', '#1F0F08') +
    `<path d="M30 30 L52 48 L36 62 Z M98 30 L76 48 L92 62 Z" fill="#E8742C"/><path d="M34 36 L46 48 L38 54 Z M94 36 L82 48 L90 54 Z" fill="#3D1F12"/>` +
    `<path d="M24 58 Q64 24 104 58 Q100 96 64 104 Q28 96 24 58 Z" fill="#F08A3C"/><path d="M40 74 Q64 64 88 74 Q80 100 64 104 Q48 100 40 74 Z" fill="#FFF3E6"/>` +
    eyes(62, 15, 5.5) + `<ellipse cx="64" cy="80" rx="6" ry="4.5" fill="#1B1F2A"/>` },
  { id: 'bear', name: 'Bear', svg: bg('#2B2016', '#16100B') +
    `<circle cx="36" cy="38" r="14" fill="#8C5A3C"/><circle cx="92" cy="38" r="14" fill="#8C5A3C"/><circle cx="36" cy="38" r="7" fill="#C48B63"/><circle cx="92" cy="38" r="7" fill="#C48B63"/>` +
    `<circle cx="64" cy="68" r="40" fill="#A06B47"/><ellipse cx="64" cy="82" rx="18" ry="14" fill="#E2B892"/>` + eyes(60, 15) + `<ellipse cx="64" cy="76" rx="7" ry="5" fill="#2B1A10"/>` + smile(84, 5, '#2B1A10') + cheeks(70, 25) },
  { id: 'panda', name: 'Panda', svg: bg('#1D2B22', '#0F1712') +
    `<circle cx="36" cy="38" r="13" fill="#222"/><circle cx="92" cy="38" r="13" fill="#222"/><circle cx="64" cy="68" r="40" fill="#F7F7F7"/>` +
    `<ellipse cx="48" cy="62" rx="11" ry="14" fill="#222" transform="rotate(-20 48 62)"/><ellipse cx="80" cy="62" rx="11" ry="14" fill="#222" transform="rotate(20 80 62)"/>` +
    `<circle cx="49" cy="61" r="4.5" fill="#fff"/><circle cx="79" cy="61" r="4.5" fill="#fff"/><ellipse cx="64" cy="78" rx="6" ry="4" fill="#222"/>` + smile(85, 5) + cheeks(76, 26) },
  { id: 'penguin', name: 'Penguin', svg: bg('#12304A', '#091827') +
    `<ellipse cx="64" cy="70" rx="38" ry="44" fill="#26313F"/><path d="M64 34 Q40 40 40 72 Q42 104 64 108 Q86 104 88 72 Q88 40 64 34 Z" fill="#F4F6F8"/>` +
    eyes(62, 11, 5.5) + `<path d="M56 72 L72 72 L64 82 Z" fill="#F5A524"/>` + cheeks(74, 19) },
  { id: 'frog', name: 'Frog', svg: bg('#173A22', '#0B1D11') +
    `<circle cx="44" cy="40" r="15" fill="#5CC46B"/><circle cx="84" cy="40" r="15" fill="#5CC46B"/><ellipse cx="64" cy="74" rx="44" ry="34" fill="#5CC46B"/>` +
    `<circle cx="44" cy="40" r="9" fill="#fff"/><circle cx="84" cy="40" r="9" fill="#fff"/><circle cx="45" cy="41" r="5" fill="#1B1F2A"/><circle cx="85" cy="41" r="5" fill="#1B1F2A"/>` +
    `<path d="M40 78 Q64 98 88 78" stroke="#1E5A2B" stroke-width="4" fill="none" stroke-linecap="round"/>` + cheeks(78, 30) },
  { id: 'octo', name: 'Octo', svg: bg('#3A1630', '#1D0B18') +
    Array.from({ length: 5 }, (_, i) => `<path d="M${36 + i * 14} 84 q-6 16 4 26" stroke="#E0569A" stroke-width="9" fill="none" stroke-linecap="round"/>`).join('') +
    `<path d="M24 74 Q24 26 64 26 Q104 26 104 74 Q104 90 64 90 Q24 90 24 74 Z" fill="#F06AAE"/>` + eyes(58, 15) + smile(70, 7) + cheeks(66, 28) },
  { id: 'dino', name: 'Dino', svg: bg('#203316', '#10190B') +
    `<path d="M42 24 l8 10 l6-12 l6 12 l6-12 l6 12 l8-10" fill="#9AD15A"/><rect x="26" y="32" width="76" height="72" rx="34" fill="#7DBB43"/>` +
    `<ellipse cx="64" cy="84" rx="26" ry="14" fill="#B7E08A"/>` + eyes(58, 16) + `<circle cx="56" cy="80" r="2.4" fill="#335C18"/><circle cx="72" cy="80" r="2.4" fill="#335C18"/>` + smile(88, 7, '#335C18') },
  { id: 'astro', name: 'Astro', svg: bg('#141B3A', '#0A0E1F') +
    `<circle cx="22" cy="24" r="2" fill="#fff"/><circle cx="104" cy="18" r="1.6" fill="#fff"/><circle cx="110" cy="96" r="2" fill="#fff"/>` +
    `<circle cx="64" cy="66" r="42" fill="#E9EDF5"/><rect x="34" y="42" width="60" height="44" rx="22" fill="#1E2A4F"/><ellipse cx="50" cy="54" rx="10" ry="5" fill="#fff" opacity=".35"/>` +
    `<circle cx="54" cy="64" r="5" fill="#8BE9FD"/><circle cx="74" cy="64" r="5" fill="#8BE9FD"/>` + smile(74, 6, '#8BE9FD') + `<rect x="98" y="58" width="10" height="16" rx="4" fill="#D4A537"/>` },
  { id: 'bee', name: 'Busy Bee', svg: bg('#3A3110', '#1D1808') +
    `<ellipse cx="38" cy="38" rx="16" ry="11" fill="#DDF2FF" opacity=".85" transform="rotate(-30 38 38)"/><ellipse cx="90" cy="38" rx="16" ry="11" fill="#DDF2FF" opacity=".85" transform="rotate(30 90 38)"/>` +
    `<clipPath id="bee-body"><circle cx="64" cy="70" r="38"/></clipPath><circle cx="64" cy="70" r="38" fill="#F7C531"/>` +
    `<g clip-path="url(#bee-body)"><rect x="20" y="78" width="88" height="9" fill="#2A2412"/><rect x="20" y="94" width="88" height="9" fill="#2A2412"/></g>` +
    `<path d="M54 34 Q48 22 42 20 M74 34 Q80 22 86 20" stroke="#2A2412" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="42" cy="20" r="3.5" fill="#2A2412"/><circle cx="86" cy="20" r="3.5" fill="#2A2412"/>` +
    eyes(58, 13, 6) + smile(68, 6) + cheeks(66, 24) },
].map((a) => ({ ...a, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${a.name}">${a.svg.replace('id="g"', `id="lp-av-${a.id}"`).replace('url(#g)', `url(#lp-av-${a.id})`)}${shine}</svg>` }));
