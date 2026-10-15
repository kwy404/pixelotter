// The pixelotter identity: the aperture mark (an otter tail curling around six aperture
// blades), the wordmark (set in Fraunces, converted to outlines so it renders the same
// everywhere), the app icon, the favicon, the brand sheet and the character sheet.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { INK, PAL, f, grainFilter, id, linear, radial } from './kit.mjs';
import { brush, head, otter, palette } from './otter.mjs';

const require = createRequire(import.meta.url);

/** Font files (SIL Open Font License) fetched once into tmp/fonts for outlining text. */
export const FONTS = {
  display: { family: 'Fraunces', weight: 600, file: 'fraunces-600.woff', css: 'Fraunces:wght@600' },
  displayLight: { family: 'Fraunces', weight: 400, file: 'fraunces-400.woff', css: 'Fraunces:wght@400' },
  text: { family: 'Inter', weight: 500, file: 'inter-500.woff', css: 'Inter:wght@500' },
  textRegular: { family: 'Inter', weight: 400, file: 'inter-400.woff', css: 'Inter:wght@400' },
  mono: { family: 'JetBrains Mono', weight: 500, file: 'mono-500.woff', css: 'JetBrains+Mono:wght@500' },
};

const loaded = new Map();
export async function loadFont(key, root) {
  if (loaded.has(key)) return loaded.get(key);
  const spec = FONTS[key];
  const dir = join(root, 'tmp', 'fonts');
  const file = join(dir, spec.file);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const ua = 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Safari/534.30';
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${spec.css}`, { headers: { 'User-Agent': ua } })).text();
    const block = css.split('/* latin */')[1] ?? css;
    const url = /url\((https:[^)]+)\)/.exec(block)[1];
    writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  }
  const opentype = require('opentype.js');
  const font = opentype.loadSync(file);
  loaded.set(key, font);
  return font;
}

/** Text as outlined path data. align: 'left' | 'center' | 'right'. Returns { d, width }. */
export function textPath(font, text, x, y, size, { align = 'left', tracking = 0 } = {}) {
  let width = 0;
  const glyphs = font.stringToGlyphs(text);
  for (let i = 0; i < glyphs.length; i++) {
    width += (glyphs[i].advanceWidth / font.unitsPerEm) * size + (i < glyphs.length - 1 ? tracking : 0);
    if (i < glyphs.length - 1) width += (font.getKerningValue(glyphs[i], glyphs[i + 1]) / font.unitsPerEm) * size;
  }
  let cx = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  let d = '';
  for (let i = 0; i < glyphs.length; i++) {
    d += glyphs[i].getPath(cx, y, size).toPathData(2);
    cx += (glyphs[i].advanceWidth / font.unitsPerEm) * size + tracking;
    if (i < glyphs.length - 1) cx += (font.getKerningValue(glyphs[i], glyphs[i + 1]) / font.unitsPerEm) * size;
  }
  return { d, width };
}

/**
 * The mark: six aperture blades inside a ring, and the ring itself is an otter tail that
 * thickens and curls at its end. size: the outer diameter.
 */
export function mark({ x = 0, y = 0, size = 120, theme = 'dark', ring = null, blade = null, center = null } = {}) {
  const p = PAL[theme];
  const R = size / 2;
  const rIn = R * 0.6;
  const rHole = R * 0.2;
  const ringColor = ring ?? p.amber;
  const tone = blade ?? (theme === 'dark' ? ['#2a2a2f', '#323238', '#3a3a41'] : ['#d8d2c6', '#cfc8ba', '#e2ddd3']);
  let s = `<g transform="translate(${f(x)} ${f(y)})">`;
  // blades: lines along the edges of the inner hexagon, extended to the ring
  const V = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i * 60 - 90 + 15) * Math.PI) / 180;
    V.push([Math.cos(a) * rHole, Math.sin(a) * rHole]);
  }
  const hit = (p0, p1) => {
    // extend p0 -> p1 beyond p1 until it meets the circle of radius rIn
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const a = dx * dx + dy * dy;
    const b = 2 * (p1[0] * dx + p1[1] * dy);
    const c = p1[0] ** 2 + p1[1] ** 2 - rIn * rIn;
    const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    return [p1[0] + dx * t, p1[1] + dy * t];
  };
  const E = V.map((v, i) => hit(v, V[(i + 1) % 6]));
  for (let i = 0; i < 6; i++) {
    const a = V[i];
    const b = V[(i + 1) % 6];
    const e = E[i];
    const ePrev = E[(i + 5) % 6];
    s += `<path d="M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}L${f(e[0])} ${f(e[1])}A${f(rIn)} ${f(rIn)} 0 0 0 ${f(ePrev[0])} ${f(ePrev[1])}Z" fill="${tone[i % 3]}" stroke="${theme === 'dark' ? '#0c0c0d' : '#f3f1ec'}" stroke-width="${f(size * 0.012)}" stroke-linejoin="round"/>`;
  }
  // the hole: a warm glow, like the safelight seen through the lens
  const g = id('mk');
  s += `<defs>${radial(g, [[0, center ?? '#f0c98f'], [1, p.amber]])}</defs><polygon points="${V.map((v) => `${f(v[0])},${f(v[1])}`).join(' ')}" fill="url(#${g})"/>`;
  // the tail ring: a crescent that starts thin at the top, grows thick around the bottom and
  // curls inward at the end, at the upper right
  const outer = R;
  const w0 = size * 0.03;
  const w1 = size * 0.12;
  const steps = 64;
  const from = -80;
  const to = 250;
  const ptsO = [];
  const ptsI = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = ((from + (to - from) * t) * Math.PI) / 180;
    const w = w0 + (w1 - w0) * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5) * (t > 0.85 ? 1 - (t - 0.85) * 2.4 : 1);
    const r0 = outer - size * 0.02;
    ptsO.push([Math.cos(ang) * r0, Math.sin(ang) * r0]);
    ptsI.push([Math.cos(ang) * (r0 - w), Math.sin(ang) * (r0 - w)]);
  }
  const end = ptsO[ptsO.length - 1];
  const endI = ptsI[ptsI.length - 1];
  const curl = `C${f(end[0] + size * 0.02)} ${f(end[1] - size * 0.12)} ${f(endI[0] + size * 0.16)} ${f(endI[1] - size * 0.06)} ${f(endI[0] + size * 0.1)} ${f(endI[1] + size * 0.02)}`;
  let d = `M${f(ptsO[0][0])} ${f(ptsO[0][1])}`;
  for (const q of ptsO.slice(1)) d += `L${f(q[0])} ${f(q[1])}`;
  d += curl;
  d += `L${f(endI[0])} ${f(endI[1])}`;
  for (const q of ptsI.slice().reverse()) d += `L${f(q[0])} ${f(q[1])}`;
  d += 'Z';
  const tg = id('tl');
  s += `<defs>${linear(tg, [[0, ringColor, 0.55], [0.5, ringColor], [1, theme === 'dark' ? '#e1b27a' : '#6f4a24']], { x1: 0, y1: 0, x2: 1, y2: 1 })}</defs><path d="${d}" fill="url(#${tg})"/>`;
  s += `</g>`;
  return s;
}

export function markSVG(theme = 'dark', size = 256) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128" width="${size}" height="${size}" role="img"><title>pixelotter mark: an otter tail curling around an aperture</title>${mark({ size: 116, theme })}</svg>`;
}

/** App icon: the mark on a charcoal tile with a faint safelight glow. */
export function appIconSVG({ size = 512, maskable = false } = {}) {
  const g = id('ai');
  const bg = id('ab');
  const inset = maskable ? 0.58 : 0.7;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}"><defs>${linear(bg, [[0, '#1d1d21'], [1, '#0c0c0d']])}${radial(g, [[0, '#c08a4e', 0.35], [1, '#c08a4e', 0]], { cx: 0.5, cy: 0.42, r: 0.5 })}</defs>${maskable ? `<rect width="512" height="512" fill="url(#${bg})"/>` : `<rect x="16" y="16" width="480" height="480" rx="112" fill="url(#${bg})"/><rect x="16.5" y="16.5" width="479" height="479" rx="111.5" fill="none" stroke="#ffffff" stroke-opacity=".08"/>`}<circle cx="256" cy="256" r="220" fill="url(#${g})"/>${mark({ x: 256, y: 256, size: 512 * inset, theme: 'dark' })}</svg>`;
}

export function faviconSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" rx="15" fill="#141416"/>${mark({ x: 32, y: 32, size: 52, theme: 'dark' })}</svg>`;
}

/** Wordmark: "pixelotter" in Fraunces SemiBold, outlined. */
export async function wordmark(root, { x = 0, y = 0, size = 96, color = '#ebe7e1', align = 'left' } = {}) {
  const font = await loadFont('display', root);
  const { d, width } = textPath(font, 'pixelotter', x, y, size, { align, tracking: -size * 0.01 });
  return { svg: `<path d="${d}" fill="${color}"/>`, width };
}

export async function logoSVG(root, theme = 'dark') {
  const p = PAL[theme];
  const wm = await wordmark(root, { x: 150, y: 92, size: 88, color: p.text });
  const w = Math.ceil(150 + wm.width + 16);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 130" width="${w}" height="130" role="img"><title>pixelotter</title>${mark({ x: 64, y: 64, size: 112, theme })}${wm.svg}</svg>`;
}

const label = (font, text, x, y, size, color, opts) => `<path d="${textPath(font, text, x, y, size, opts).d}" fill="${color}"/>`;

/** A darkroom backdrop: charcoal, a hairline grid, soft safelight glow and film grain. */
export function backdrop(W, H, theme = 'dark', { glowX = 0.78, glowY = 0.18, grid = 40 } = {}) {
  const p = PAL[theme];
  const gl = id('gl');
  const gr = id('gr');
  const pat = id('pt');
  let s = `<defs>${radial(gl, [[0, p.amber, theme === 'dark' ? 0.22 : 0.16], [1, p.amber, 0]], { cx: glowX, cy: glowY, r: 0.6 })}${grainFilter(gr, { opacity: theme === 'dark' ? 0.06 : 0.05 })}<pattern id="${pat}" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse"><path d="M${grid} 0H0V${grid}" fill="none" stroke="${theme === 'dark' ? '#ffffff' : '#1c1b19'}" stroke-opacity="${theme === 'dark' ? 0.035 : 0.05}"/></pattern></defs>`;
  s += `<rect width="${W}" height="${H}" fill="${p.bg}"/><rect width="${W}" height="${H}" fill="url(#${pat})"/><rect width="${W}" height="${H}" fill="url(#${gl})"/>`;
  s += `<rect width="${W}" height="${H}" fill="#808080" filter="url(#${gr})"/>`;
  return s;
}

/** The brand sheet: mark, wordmark, icon, palette, type pairing and the mascot head. */
export async function brandSVG(root, theme = 'dark') {
  const p = PAL[theme];
  const W = 1600;
  const H = 1000;
  const disp = await loadFont('display', root);
  const dispL = await loadFont('displayLight', root);
  const text = await loadFont('text', root);
  const mono = await loadFont('mono', root);
  let s = backdrop(W, H, theme);
  // frame lines like a contact sheet
  s += `<rect x="40.5" y="40.5" width="${W - 81}" height="${H - 81}" fill="none" stroke="${p.hair}"/>`;
  s += label(mono, 'PIXELOTTER  /  BRAND IDENTITY  /  SHEET 01', 72, 84, 15, p.muted, { tracking: 2 });
  s += label(mono, '14A', W - 72, 84, 15, p.amber, { align: 'right', tracking: 2 });
  // logo lockup
  s += mark({ x: 210, y: 270, size: 220, theme });
  const wm = await wordmark(root, { x: 360, y: 300, size: 132, color: p.text });
  s += wm.svg;
  s += label(dispL, 'A photo editor that lives in your browser.', 366, 380, 30, p.muted);
  // section labels
  const section = (t, x, y) => `<path d="M${x} ${y - 22}h28" stroke="${p.amber}" stroke-width="2"/>` + label(mono, t, x, y, 13, p.muted, { tracking: 2.2 });
  // app icon and favicon
  s += section('APP ICON', 72, 480);
  s += `<g transform="translate(72 500) scale(0.34)">${appIconSVG({ size: 512 }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`;
  s += `<g transform="translate(270 560) scale(1.1)">${faviconSVG().replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`;
  s += `<g transform="translate(366 580) scale(0.5)">${faviconSVG().replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`;
  s += label(mono, '512   64   32', 72, 700, 12, p.faint, { tracking: 1.5 });
  // palette swatches
  s += section('DARKROOM PALETTE', 480, 480);
  const sw = [
    ['Charcoal', '#0c0c0d'],
    ['Graphite', '#17171a'],
    ['Slate line', '#2a2a2f'],
    ['Safelight', '#c08a4e'],
    ['Dim amber', '#8e6438'],
    ['Paper', '#e9e3d8'],
    ['Silver', '#9b968e'],
  ];
  sw.forEach(([n, c], i) => {
    const x = 480 + i * 104;
    s += `<rect x="${x}" y="500" width="92" height="120" rx="6" fill="${c}" stroke="${p.hair}"/>`;
    s += label(text, n, x, 645, 13, p.text);
    s += label(mono, c.toUpperCase(), x, 664, 11, p.muted, { tracking: 1 });
  });
  // type pairing
  s += section('TYPE', 480, 740);
  s += label(disp, 'Aa', 480, 840, 96, p.text);
  s += label(text, 'Fraunces SemiBold', 620, 790, 18, p.text);
  s += label(text, 'Display and wordmark', 620, 814, 14, p.muted);
  s += label(text, 'Aa', 860, 840, 96, p.text);
  s += label(text, 'Inter Medium', 1000, 790, 18, p.text);
  s += label(text, 'Interface and text', 1000, 814, 14, p.muted);
  s += label(mono, '14A  ISO 400  f/2.8', 480, 900, 18, p.amber, { tracking: 1 });
  s += label(text, 'JetBrains Mono for frame numbers and values', 480, 926, 14, p.muted);
  // the mascot head in a round frame
  const hc = id('hc');
  s += `<defs><clipPath id="${hc}"><circle cx="1360" cy="290" r="170"/></clipPath></defs><circle cx="1360" cy="290" r="171" fill="${p.surface}" stroke="${p.hair}"/>`;
  s += `<g clip-path="url(#${hc})"><g transform="translate(1360 330) scale(1.15)">${head({ expression: 'confident', turn: -0.3 })}</g></g>`;
  s += section('MASCOT', 1220, 520);
  s += label(text, 'Otto, the otter painter', 1220, 560, 18, p.text);
  s += label(text, 'Paints with light. Never with', 1220, 586, 14, p.muted);
  s += label(text, 'bright colors.', 1220, 606, 14, p.muted);
  // small marks on light and dark
  s += `<rect x="1220" y="650" width="150" height="150" rx="8" fill="#0c0c0d" stroke="${p.hair}"/>${mark({ x: 1295, y: 725, size: 100, theme: 'dark' })}`;
  s += `<rect x="1390" y="650" width="150" height="150" rx="8" fill="#f3f1ec" stroke="${p.hair}"/>${mark({ x: 1465, y: 725, size: 100, theme: 'light' })}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"><title>pixelotter brand identity: mark, wordmark, app icon, darkroom palette, type and mascot</title>${s}</svg>`;
}

/** The character sheet: three views, five expressions, props and swatches. */
export async function characterSheetSVG(root, theme = 'dark') {
  const p = PAL[theme];
  const W = 1800;
  const H = 1300;
  const text = await loadFont('text', root);
  const mono = await loadFont('mono', root);
  const disp = await loadFont('display', root);
  let s = backdrop(W, H, theme, { glowX: 0.5, glowY: 0.05 });
  s += `<rect x="40.5" y="40.5" width="${W - 81}" height="${H - 81}" fill="none" stroke="${p.hair}"/>`;
  s += label(mono, 'CHARACTER SHEET  /  OTTO  /  THE OTTER PAINTER', 72, 84, 15, p.muted, { tracking: 2 });
  s += label(mono, '22A', W - 72, 84, 15, p.amber, { align: 'right', tracking: 2 });
  s += label(disp, 'Otto', 72, 160, 64, p.text);
  s += label(text, 'Calm, confident, a little smug about his brushwork. Paints with light.', 72, 196, 18, p.muted);
  // turnaround with construction lines
  const views = [
    ['FRONT', 'front', 0],
    ['THREE QUARTER', 'three', 1],
    ['BACK', 'back', 2],
  ];
  for (let y = 300; y <= 740; y += 110) s += `<path d="M72 ${y}H1060" stroke="${p.amber}" stroke-opacity=".12" stroke-dasharray="3 6"/>`;
  for (const [name, view, i] of views) {
    const x = 72 + i * 340;
    s += `<g transform="translate(${x - 40} 230) scale(0.66)">${otter({ view, expression: 'confident', theme, glow: view === 'three' })}</g>`;
    s += label(mono, name, x + 158, 770, 13, p.muted, { align: 'center', tracking: 2 });
  }
  // expressions
  s += `<path d="M72 820h28" stroke="${p.amber}" stroke-width="2"/>`;
  s += label(mono, 'EXPRESSIONS', 72, 842, 13, p.muted, { tracking: 2.2 });
  const ex = ['confident', 'delighted', 'surprised', 'focused', 'sheepish'];
  ex.forEach((e, i) => {
    const x = 160 + i * 205;
    const c = id('ec');
    s += `<defs><clipPath id="${c}"><rect x="${x - 95}" y="870" width="190" height="230" rx="10"/></clipPath></defs><rect x="${x - 95}" y="870" width="190" height="230" rx="10" fill="${p.surface}" stroke="${p.hair}"/>`;
    s += `<g clip-path="url(#${c})"><g transform="translate(${x} 1000) scale(0.62)">${head({ expression: e, turn: -0.15 })}</g></g>`;
    s += label(mono, e.toUpperCase(), x, 1130, 12, p.muted, { align: 'center', tracking: 2 });
  });
  // props
  s += `<path d="M1150 260h28" stroke="${p.amber}" stroke-width="2"/>`;
  s += label(mono, 'PROPS', 1150, 282, 13, p.muted, { tracking: 2.2 });
  s += `<rect x="1150" y="300" width="580" height="520" rx="10" fill="${p.surface}" stroke="${p.hair}"/>`;
  s += palette(1330, 450, 1.3, -10);
  s += brush(1200, 700, 1460, 560, 16);
  s += label(text, 'Beechwood palette, thumb hole worn smooth', 1180, 760, 14, p.muted);
  s += label(text, 'Round brush no. 8, always loaded with amber light', 1180, 784, 14, p.muted);
  s += label(text, 'Felt beret, frayed band, one ochre drip', 1180, 808, 14, p.muted);
  // palette swatches row
  s += `<path d="M1150 880h28" stroke="${p.amber}" stroke-width="2"/>`;
  s += label(mono, 'COLOR SCRIPT', 1150, 902, 13, p.muted, { tracking: 2.2 });
  const sw = [INK.furDeep, INK.furDark, INK.fur, INK.furLight, INK.cream, INK.beret, INK.wood, INK.paint.amber, INK.paint.slate, INK.paint.sage, INK.paint.rust];
  sw.forEach((c, i) => {
    const x = 1150 + (i % 6) * 97;
    const y = 925 + Math.floor(i / 6) * 120;
    s += `<rect x="${x}" y="${y}" width="86" height="70" rx="6" fill="${c}" stroke="${p.hair}"/>`;
    s += label(mono, c.toUpperCase(), x, y + 92, 11, p.muted, { tracking: 1 });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"><title>Character sheet for Otto, the pixelotter otter painter: front, three quarter and back views, five expressions, props and colors</title>${s}</svg>`;
}
