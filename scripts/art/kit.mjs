// Drawing kit for the pixelotter art: the darkroom palette, a seeded random generator, path
// helpers, fur strokes, film grain and a headless renderer that turns SVG or HTML into PNG.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** The darkroom palette: charcoal and graphite, warm paper, one dimmed amber safelight. */
export const PAL = {
  dark: {
    bg: '#0c0c0d',
    bg2: '#121214',
    surface: '#17171a',
    surface2: '#1e1e22',
    line: '#2a2a2f',
    hair: 'rgba(255,255,255,0.08)',
    text: '#ebe7e1',
    muted: '#9b968e',
    faint: '#5f5b55',
    amber: '#c08a4e',
    amberSoft: '#8e6438',
    amberGlow: '#d39b5c',
    paper: '#e9e3d8',
  },
  light: {
    bg: '#f3f1ec',
    bg2: '#ebe8e1',
    surface: '#fbfaf7',
    surface2: '#f1eee8',
    line: '#d9d4ca',
    hair: 'rgba(28,27,25,0.10)',
    text: '#1c1b19',
    muted: '#6a655d',
    faint: '#a29c92',
    amber: '#8f6233',
    amberSoft: '#b4834e',
    amberGlow: '#c08a4e',
    paper: '#fbf8f2',
  },
};

/** Muted pigments for the otter and its props. */
export const INK = {
  fur: '#6e4b33',
  furLight: '#9a6f4d',
  furDark: '#3e2819',
  furDeep: '#2e1f15',
  cream: '#dcc6a6',
  creamShade: '#b89c7a',
  nose: '#231a16',
  eye: '#17110e',
  beret: '#3a2a2e',
  beretLight: '#5a4348',
  beretDark: '#22181b',
  wood: '#a77d50',
  woodDark: '#77562f',
  woodLight: '#c9a273',
  metal: '#a9a59d',
  metalDark: '#6c6861',
  paint: { ochre: '#c49a4a', rust: '#a2543a', slate: '#5d7386', sage: '#7d8f6b', cream: '#e6dccb', plum: '#6e4b63', amber: '#c08a4e' },
};

/** Seeded random numbers (mulberry32), so the art is the same on every build. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let uid = 0;
/** A unique id for gradients, filters and clips. */
export const id = (p = 'x') => `${p}${(++uid).toString(36)}`;
export const resetIds = (prefix = '') => {
  uid = 0;
  return prefix;
};

export const f = (n) => Number(n.toFixed(2));

/** A radial gradient definition. stops: [[offset, color, opacity?], ...] */
export function radial(gid, stops, { cx = 0.5, cy = 0.5, r = 0.5, fx, fy } = {}) {
  const st = stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('');
  return `<radialGradient id="${gid}" cx="${cx}" cy="${cy}" r="${r}"${fx !== undefined ? ` fx="${fx}" fy="${fy}"` : ''}>${st}</radialGradient>`;
}

export function linear(gid, stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1, units = '' } = {}) {
  const st = stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('');
  return `<linearGradient id="${gid}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${units ? ` gradientUnits="${units}"` : ''}>${st}</linearGradient>`;
}

export const blur = (fid, sd) => `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

/** Film grain as a filter: fractal noise, desaturated, at low opacity. */
export const grainFilter = (fid, { freq = 0.9, opacity = 0.08, seed = 3 } = {}) =>
  `<filter id="${fid}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 ${opacity * 4} 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>`;

/**
 * Short fur strokes scattered inside an ellipse region, following a flow angle. Returns path
 * data (many tiny curves) to stroke with a thin, low opacity line.
 */
export function furStrokes(rand, { cx, cy, rx, ry, count = 120, len = [6, 12], angle = 90, spread = 25, curl = 0.35 }) {
  let d = '';
  for (let i = 0; i < count; i++) {
    const t = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const x = cx + Math.cos(t) * rx * r;
    const y = cy + Math.sin(t) * ry * r;
    const a = ((angle + (rand() - 0.5) * spread) * Math.PI) / 180;
    const l = len[0] + rand() * (len[1] - len[0]);
    const x2 = x + Math.cos(a) * l;
    const y2 = y + Math.sin(a) * l;
    const mx = (x + x2) / 2 + Math.cos(a + Math.PI / 2) * l * curl * (rand() - 0.5);
    const my = (y + y2) / 2 + Math.sin(a + Math.PI / 2) * l * curl * (rand() - 0.5);
    d += `M${f(x)} ${f(y)}Q${f(mx)} ${f(my)} ${f(x2)} ${f(y2)}`;
  }
  return d;
}

/** Fur strokes along a contour (a list of points), pointing outward, for a soft fuzzy edge. */
export function edgeFur(rand, pts, { len = [4, 9], every = 1, out = 1 } = {}) {
  let d = '';
  for (let i = 0; i < pts.length - 1; i += every) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const nx = -(y1 - y0);
    const ny = x1 - x0;
    const n = Math.hypot(nx, ny) || 1;
    const l = len[0] + rand() * (len[1] - len[0]);
    const tx = x0 + (x1 - x0) * rand();
    const ty = y0 + (y1 - y0) * rand();
    const jitter = (rand() - 0.5) * 0.6;
    d += `M${f(tx)} ${f(ty)}q${f((nx / n) * l * 0.5 * out + (x1 - x0) * jitter * 0.2)} ${f((ny / n) * l * 0.5 * out + (y1 - y0) * jitter * 0.2)} ${f((nx / n) * l * out)} ${f((ny / n) * l * out)}`;
  }
  return d;
}

/** Points along an ellipse arc (degrees, 0 = right, clockwise in screen space). */
export function arcPoints(cx, cy, rx, ry, from, to, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

export const svgDoc = (w, h, body, { title = '', vb = `0 0 ${w} ${h}`, extra = '' } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}"${extra}>${title ? `<title>${title}</title>` : ''}${body}</svg>`;

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];

let browser = null;
let profile = null;
export async function openBrowser() {
  if (browser) return browser;
  const { chromium } = await import('playwright-core');
  const exe = process.env.PIXELOTTER_BROWSER || EDGE.find((p) => existsSync(p));
  if (!exe) throw new Error('No Edge or Chrome found for rendering PNGs');
  profile = mkdtempSync(join(tmpdir(), 'pxo-art-'));
  const ctx = await chromium.launchPersistentContext(profile, { executablePath: exe, headless: true, args: ['--force-color-profile=srgb'] });
  browser = ctx;
  return ctx;
}

export async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
  if (profile) rmSync(profile, { recursive: true, force: true });
}

/**
 * Renders markup to a PNG file. markup: an SVG string or a full HTML page.
 * opts: { width, height, scale, type: 'png' | 'jpeg', quality, transparent }
 */
export async function render(markup, out, { width, height, scale = 1, type = 'png', quality = 90, transparent = false, wait = 120 } = {}) {
  const ctx = await openBrowser();
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height });
  const html = markup.trimStart().startsWith('<svg')
    ? `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:${transparent ? 'transparent' : '#000'}}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${markup}</body></html>`
    : markup;
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(wait);
  mkdirSync(dirname(out), { recursive: true });
  const buf = await page.screenshot({ type, quality: type === 'jpeg' ? quality : undefined, omitBackground: transparent, scale: scale === 1 ? 'css' : 'device', clip: { x: 0, y: 0, width, height } });
  writeFileSync(out, buf);
  await page.close();
  return buf;
}
