// Darkroom illustrations for the site and the README, in the muted style: graphite shapes,
// hairlines, one amber safelight accent. Each comes in a dark and a light version.
//   develop:  Otto paints light onto a print floating in the developer tray
//   contact:  a contact sheet with a grease pencil circle around the keeper
//   passing:  two devices pass a print, six word tiles and a QR between them
//   together: cursors of friends around one print on the easel
import { PAL, f, grainFilter, id, linear, radial, rng } from './kit.mjs';
import { otter } from './otter.mjs';

const W = 960;
const H = 640;

function frame(theme, body) {
  const p = PAL[theme];
  const gr = id('gr');
  const gl = id('gl');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${grainFilter(gr, { opacity: theme === 'dark' ? 0.06 : 0.045 })}${radial(gl, [[0, p.amber, theme === 'dark' ? 0.2 : 0.12], [1, p.amber, 0]], { cx: 0.7, cy: 0.2, r: 0.7 })}</defs><rect width="${W}" height="${H}" rx="18" fill="${p.surface}"/><rect width="${W}" height="${H}" rx="18" fill="url(#${gl})"/>${body}<rect width="${W}" height="${H}" rx="18" fill="#808080" filter="url(#${gr})"/><rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="17.5" fill="none" stroke="${p.hair}"/></svg>`;
}

/** A print: paper border, an image area with a few soft shapes, optional developing state. */
function print(p, x, y, w, h, { rot = 0, dev = 1, seed = 1, theme = 'dark' } = {}) {
  const rand = rng(seed);
  const clip = id('pc');
  const img = id('pi');
  const tone = theme === 'dark' ? ['#3b342d', '#5d5145', '#7f6e5c'] : ['#8a7b69', '#a8977f', '#c7b8a0'];
  let s = `<g transform="translate(${x} ${y}) rotate(${rot})">`;
  s += `<rect x="-${w / 2 + 3}" y="-${h / 2 - 6}" width="${w + 6}" height="${h + 6}" fill="#000" opacity=".35" transform="translate(6 8)"/>`;
  s += `<rect x="-${w / 2}" y="-${h / 2}" width="${w}" height="${h}" fill="${p.paper}"/>`;
  const m = w * 0.07;
  s += `<defs><clipPath id="${clip}"><rect x="${-w / 2 + m}" y="${-h / 2 + m}" width="${w - 2 * m}" height="${h - 2 * m - m}"/></clipPath>${linear(img, [[0, tone[0]], [1, tone[2]]])}</defs>`;
  s += `<g clip-path="url(#${clip})" opacity="${dev}"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="url(#${img})"/>`;
  for (let i = 0; i < 4; i++) s += `<circle cx="${f((rand() - 0.5) * w)}" cy="${f(h * 0.1 + rand() * h * 0.3)}" r="${f(w * (0.12 + rand() * 0.2))}" fill="${tone[i % 3]}" opacity=".8"/>`;
  s += `<path d="M${-w / 2} ${h * 0.18}Q0 ${h * 0.05} ${w / 2} ${h * 0.2}V${h / 2}H${-w / 2}Z" fill="${tone[0]}"/>`;
  s += `</g></g>`;
  return s;
}

export function developSVG(theme = 'dark') {
  const p = PAL[theme];
  let s = '';
  // the tray of developer, seen at an angle
  const liq = id('lq');
  s += `<defs>${linear(liq, theme === 'dark' ? [[0, '#1b1a19'], [1, '#2a2622']] : [[0, '#ddd6ca'], [1, '#cfc6b6']])}</defs>`;
  s += `<path d="M120 420L840 420L900 600H60Z" fill="${theme === 'dark' ? '#0f0f10' : '#bdb3a3'}"/>`;
  s += `<path d="M140 430L820 430L872 585H88Z" fill="url(#${liq})"/>`;
  for (let i = 0; i < 4; i++) s += `<ellipse cx="420" cy="510" rx="${f(120 + i * 70)}" ry="${f(22 + i * 12)}" fill="none" stroke="${p.amber}" stroke-opacity="${f(0.22 - i * 0.04)}"/>`;
  s += print(p, 420, 470, 300, 210, { rot: -4, dev: 0.85, seed: 3, theme }).replace('<g transform', '<g transform="skewX(-8)" ><g transform') + '</g>';
  s += print(p, 700, 520, 150, 110, { rot: 8, dev: 0.35, seed: 5, theme });
  // a stroke of light being painted onto the print
  const light = id('lt');
  s += `<defs>${radial(light, [[0, '#f3c88b', 0.85], [1, p.amber, 0]])}</defs><path d="M300 470C360 420 470 430 540 450" fill="none" stroke="#f0c48a" stroke-width="5" stroke-linecap="round" opacity=".8"/><circle cx="540" cy="450" r="40" fill="url(#${light})"/>`;
  s += `<g transform="translate(560 40) scale(0.62)">${otter({ view: 'three', expression: 'focused', theme, glow: true })}</g>`;
  return frame(theme, s);
}

export function contactSVG(theme = 'dark') {
  const p = PAL[theme];
  let s = '';
  s += `<rect x="90" y="70" width="780" height="500" fill="${theme === 'dark' ? '#121112' : '#2a2724'}"/>`;
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 26; k++) s += `<rect x="${104 + k * 30}" y="${84 + i * 450}" width="16" height="22" rx="3" fill="${theme === 'dark' ? '#2a2826' : '#4a4540'}"/>`;
  }
  const n = ['12', '13', '14', '15', '16', '17', '18', '19'];
  for (let i = 0; i < 8; i++) {
    const x = 120 + (i % 4) * 185;
    const y = 130 + Math.floor(i / 4) * 200;
    s += `<rect x="${x}" y="${y}" width="165" height="180" fill="${p.paper}" opacity=".08"/>`;
    s += print(p, x + 82, y + 90, 150, 165, { seed: 10 + i, dev: 0.9, theme: 'dark' });
    s += `<text x="${x + 4}" y="${y + 196}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="12" fill="${p.amber}" opacity=".8">${n[i]}A</text>`;
  }
  // grease pencil circle around the keeper and a check mark
  s += `<path d="M482 318C462 292 478 252 540 238C620 220 690 250 700 300C712 352 650 380 580 384C520 388 476 360 470 330" fill="none" stroke="${p.amber}" stroke-width="5" stroke-linecap="round"/>`;
  s += `<path d="M712 250l14 16 28-36" fill="none" stroke="${p.amber}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return frame(theme, s);
}

export function passingSVG(theme = 'dark') {
  const p = PAL[theme];
  let s = '';
  const dev = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${theme === 'dark' ? '#0e0e10' : '#26231f'}"/><rect x="${x + 10}" y="${y + 10}" width="${w - 20}" height="${h - 20}" rx="14" fill="${theme === 'dark' ? '#1b1b1f' : '#f8f6f2'}" stroke="${p.hair}"/>`;
  s += dev(80, 120, 260, 420);
  s += dev(620, 120, 260, 420);
  // six word tiles on the left phone, a small QR
  const words = ['amber', 'otter', 'paper', 'river', 'silver', 'velvet'];
  words.forEach((w, i) => {
    const x = 110 + (i % 2) * 104;
    const y = 160 + Math.floor(i / 2) * 50;
    s += `<rect x="${x}" y="${y}" width="96" height="38" rx="8" fill="none" stroke="${p.amber}" stroke-opacity=".6"/><text x="${x + 48}" y="${y + 24}" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="14" fill="${p.text}">${w}</text>`;
  });
  const rand = rng(9);
  for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) if (rand() > 0.5 || (x < 3 && y < 3) || (x > 9 && y < 3) || (x < 3 && y > 9)) s += `<rect x="${150 + x * 9}" y="${330 + y * 9}" width="9" height="9" fill="${p.text}" opacity=".85"/>`;
  // the print travelling between them
  s += `<path d="M350 330C430 250 530 250 610 330" fill="none" stroke="${p.amber}" stroke-width="2" stroke-dasharray="4 8"/>`;
  s += print(p, 480, 280, 130, 100, { rot: -6, seed: 21, theme });
  // the arrived print and a check
  s += print(p, 750, 290, 190, 150, { rot: 0, seed: 21, theme });
  s += `<circle cx="750" cy="440" r="26" fill="none" stroke="${p.amber}" stroke-width="2"/><path d="M738 440l9 9 16-18" fill="none" stroke="${p.amber}" stroke-width="2.4" stroke-linecap="round"/>`;
  s += `<text x="750" y="500" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="13" fill="${p.muted}">SHA-256 match</text>`;
  return frame(theme, s);
}

export function togetherSVG(theme = 'dark') {
  const p = PAL[theme];
  let s = '';
  // the easel
  s += `<path d="M330 600L470 90M630 600L490 90M480 90V600" stroke="${theme === 'dark' ? '#3a3632' : '#a89a86'}" stroke-width="10" stroke-linecap="round"/>`;
  s += print(p, 480, 300, 360, 270, { seed: 31, theme });
  s += `<rect x="290" y="440" width="380" height="16" rx="4" fill="${theme === 'dark' ? '#3a3632' : '#a89a86'}"/>`;
  const cursors = [
    [360, 230, '#d39b5c', 'Ana'],
    [560, 210, '#7fa7c9', 'Bo'],
    [600, 360, '#9cc39a', 'Cy'],
  ];
  for (const [x, y, c, n] of cursors) {
    s += `<path d="M${x} ${y}l0 26 7-7 6 12 5-2-6-12 10 0Z" fill="${c}" stroke="#0c0c0d" stroke-width="1.5" stroke-linejoin="round"/>`;
    s += `<rect x="${x + 16}" y="${y + 24}" width="${n.length * 9 + 16}" height="22" rx="11" fill="${c}"/><text x="${x + 24}" y="${y + 39}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="600" fill="#0c0c0d">${n}</text>`;
  }
  // a layer lock badge
  s += `<rect x="640" y="110" width="200" height="120" rx="12" fill="${p.surface2}" stroke="${p.hair}"/>`;
  ['Ana  text', 'Bo   photo', 'Cy   shapes'].forEach((t, i) => {
    s += `<circle cx="664" cy="${142 + i * 30}" r="6" fill="${cursors[i][2]}"/><text x="680" y="${147 + i * 30}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="13" fill="${p.text}">${t}</text>`;
  });
  return frame(theme, s);
}

export const ILLUSTRATIONS = { develop: developSVG, contact: contactSVG, passing: passingSVG, together: togetherSVG };
