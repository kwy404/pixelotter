// The sample photos: illustrated still lifes rendered to look like photographs, so the app
// and the landing page have something to edit without stock photos of real people.
//   otterDesk: a felt figurine of Otto on a wooden darkroom table, safelight bokeh behind
//   teapot:    a ceramic teapot on a window sill in soft daylight
import { INK, blur, f, id, linear, radial, rng } from './kit.mjs';
import { otter } from './otter.mjs';

function bokeh(rand, W, H, n, colors, [rmin, rmax], yMax = 1) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const r = rmin + rand() * (rmax - rmin);
    const c = colors[Math.floor(rand() * colors.length)];
    const g = id('bk');
    s += `<defs>${radial(g, [[0, c, 0.5], [0.7, c, 0.32], [0.92, c, 0.42], [1, c, 0]])}</defs><circle cx="${f(rand() * W)}" cy="${f(rand() * H * yMax)}" r="${f(r)}" fill="url(#${g})"/>`;
  }
  return s;
}

export function otterDeskSVG(W = 1600, H = 1200) {
  const rand = rng(42);
  let s = '';
  const wall = id('wl');
  const far = id('fb');
  const near = id('nb');
  const grain = id('gn');
  const vig = id('vg');
  s += `<defs>${linear(wall, [[0, '#1b1512'], [0.6, '#2a1d15'], [1, '#3a2617']])}${blur(far, 22)}${blur(near, 6)}`;
  s += radial(vig, [[0, '#000', 0], [0.7, '#000', 0.15], [1, '#000', 0.7]], { r: 0.75 });
  s += `<filter id="${grain}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="4" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.16"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/></filter></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#${wall})"/>`;
  // the darkroom behind, out of focus: shelves, an enlarger, prints on a line, safelight
  s += `<g filter="url(#${far})">`;
  s += `<rect x="80" y="160" width="420" height="16" fill="#3b2a1e"/><rect x="80" y="300" width="420" height="16" fill="#3b2a1e"/>`;
  for (let i = 0; i < 7; i++) s += `<rect x="${110 + i * 52}" y="${100 + (i % 3) * 6}" width="34" height="${60 - (i % 3) * 6}" fill="${['#4a3626', '#5a4330', '#33261b'][i % 3]}"/>`;
  for (let i = 0; i < 5; i++) s += `<rect x="${120 + i * 70}" y="236" width="44" height="64" rx="4" fill="${['#5c4a3a', '#2f2a26', '#6b5440'][i % 3]}"/>`;
  // the enlarger column and head
  s += `<rect x="1180" y="120" width="26" height="560" fill="#2d241d"/><path d="M1110 170h170l-20 120h-130z" fill="#3a2e25"/><rect x="1150" y="290" width="90" height="40" fill="#2a211b"/>`;
  // drying line with prints
  s += `<path d="M0 90Q800 140 1600 80" stroke="#6b5440" stroke-width="3" fill="none"/>`;
  for (let i = 0; i < 6; i++) {
    const x = 560 + i * 150;
    const y = 112 + Math.sin(i) * 6;
    s += `<rect x="${x}" y="${y}" width="104" height="132" fill="${['#cdbfa9', '#bfae97', '#d6c9b5'][i % 3]}" transform="rotate(${(i % 2 ? 2 : -2)} ${x} ${y})"/><rect x="${x + 10}" y="${y + 10}" width="84" height="96" fill="${['#5e5246', '#7c6a56', '#4a4038'][i % 3]}" transform="rotate(${(i % 2 ? 2 : -2)} ${x} ${y})"/>`;
  }
  s += `</g>`;
  // safelight glow and bokeh
  const glow = id('sg');
  s += `<defs>${radial(glow, [[0, '#ffb466', 0.55], [0.4, '#c0742f', 0.25], [1, '#c0742f', 0]])}</defs><circle cx="1360" cy="210" r="420" fill="url(#${glow})"/>`;
  s += bokeh(rand, W, H, 26, ['#e9a25a', '#c47a3a', '#f2c58e', '#8a5a34'], [18, 64], 0.55);
  // the table: warm wood in perspective, with grain and a soft reflection of the light
  const wood = id('wd');
  s += `<defs>${linear(wood, [[0, '#5a3a22'], [0.35, '#6e4a2c'], [1, '#2c1b10']])}</defs>`;
  s += `<path d="M0 760L1600 700V1200H0Z" fill="url(#${wood})"/>`;
  for (let i = 0; i < 28; i++) {
    const y0 = 760 + i * 16 + rand() * 8;
    s += `<path d="M0 ${f(y0)}C400 ${f(y0 - 18 + rand() * 12)} 1000 ${f(y0 - 40 + rand() * 20)} 1600 ${f(y0 - 60 + i * 2)}" stroke="#2a1a0f" stroke-opacity="${f(0.15 + rand() * 0.2)}" stroke-width="${f(1 + rand() * 2)}" fill="none"/>`;
  }
  s += `<path d="M0 760L1600 700" stroke="#a57446" stroke-opacity=".5" stroke-width="3"/>`;
  const refl = id('rf');
  s += `<defs>${radial(refl, [[0, '#f0a65a', 0.28], [1, '#f0a65a', 0]])}</defs><ellipse cx="1150" cy="820" rx="460" ry="70" fill="url(#${refl})"/>`;
  // props on the table, slightly out of focus: a print tong and a film canister
  s += `<g filter="url(#${near})"><rect x="120" y="900" width="220" height="16" rx="8" fill="#2c2a28" transform="rotate(-8 120 900)"/><rect x="1260" y="760" width="90" height="120" rx="10" fill="#1c1a19"/><rect x="1260" y="760" width="90" height="22" rx="8" fill="#3a3734"/><rect x="1270" y="800" width="70" height="50" fill="#b98a4d" opacity=".8"/></g>`;
  // Otto the figurine: felt, standing on the table, with a soft contact shadow
  const contact = id('ct');
  s += `<defs>${radial(contact, [[0, '#000', 0.75], [1, '#000', 0]])}</defs><ellipse cx="805" cy="1022" rx="330" ry="46" fill="url(#${contact})"/>`;
  s += `<g transform="translate(430 170) scale(1.25)">${otter({ view: 'three', expression: 'confident', theme: 'dark', glow: true, seed: 8 })}</g>`;
  // film grain and vignette over everything
  s += `<rect width="${W}" height="${H}" fill="#808080" filter="url(#${grain})"/>`;
  s += `<rect width="${W}" height="${H}" fill="url(#${vig})"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${s}</svg>`;
}

export function teapotSVG(W = 1600, H = 1200) {
  const rand = rng(7);
  let s = '';
  const sky = id('sk');
  const sill = id('sl');
  const glaze = id('gz');
  const grain = id('gn');
  const soft = id('sf');
  s += `<defs>${linear(sky, [[0, '#cfd6d8'], [1, '#e8e2d6']])}${linear(sill, [[0, '#d9d1c4'], [1, '#a99d8b']])}${radial(glaze, [[0, '#a7b8b0'], [0.55, '#6f877e'], [1, '#33443e']], { cx: 0.35, cy: 0.3, r: 0.8 })}${blur(soft, 18)}`;
  s += `<filter id="${grain}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.12"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/></filter></defs>`;
  // window light and a blurred garden outside
  s += `<rect width="${W}" height="${H}" fill="url(#${sky})"/>`;
  s += `<g filter="url(#${soft})">`;
  for (let i = 0; i < 30; i++) s += `<circle cx="${f(rand() * W)}" cy="${f(380 + rand() * 300)}" r="${f(40 + rand() * 120)}" fill="${['#8fa58a', '#a8b99a', '#6f8a6c', '#c2c9b2'][i % 4]}" opacity="${f(0.4 + rand() * 0.4)}"/>`;
  s += `</g>`;
  // window frame
  s += `<rect x="0" y="0" width="${W}" height="60" fill="#efeae1"/><rect x="770" y="0" width="60" height="760" fill="#efeae1"/><rect x="0" y="0" width="60" height="760" fill="#efeae1"/><rect x="${W - 60}" y="0" width="60" height="760" fill="#efeae1"/>`;
  // the sill
  s += `<rect x="0" y="740" width="${W}" height="${H - 740}" fill="url(#${sill})"/><rect x="0" y="740" width="${W}" height="10" fill="#f4efe6"/>`;
  // soft shadow
  const sh = id('ts');
  s += `<defs>${radial(sh, [[0, '#3a3128', 0.55], [1, '#3a3128', 0]])}</defs><ellipse cx="840" cy="980" rx="380" ry="50" fill="url(#${sh})"/>`;
  // the teapot: body, lid, knob, spout and handle
  s += `<path d="M1040 640C1140 600 1180 700 1110 800C1080 840 1050 860 1030 870" fill="none" stroke="#3f544c" stroke-width="40" stroke-linecap="round"/>`;
  s += `<path d="M560 760C500 700 470 640 430 600C420 590 440 580 452 590C500 630 540 660 600 690Z" fill="url(#${glaze})"/>`;
  s += `<ellipse cx="800" cy="800" rx="290" ry="200" fill="url(#${glaze})"/>`;
  s += `<ellipse cx="800" cy="630" rx="170" ry="40" fill="#5f776e"/><ellipse cx="800" cy="600" rx="40" ry="26" fill="#7a9188"/>`;
  s += `<ellipse cx="700" cy="720" rx="90" ry="40" fill="#fff" opacity=".35" transform="rotate(-20 700 720)"/>`;
  s += `<path d="M560 860C660 960 940 960 1040 860" fill="none" stroke="#24332d" stroke-width="10" opacity=".4"/>`;
  s += `<rect width="${W}" height="${H}" fill="#808080" filter="url(#${grain})"/>`;
  void INK;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${s}</svg>`;
}

/** A quiet seascape at dusk, for the floating prints on the landing page. */
export function seascapeSVG(W = 1200, H = 900) {
  const rand = rng(17);
  const sky = id('sk');
  const sea = id('se');
  const sun = id('su');
  const grain = id('gn');
  let s = `<defs>${linear(sky, [[0, '#2b2a33'], [0.6, '#6d5a52'], [1, '#c48d63']])}${linear(sea, [[0, '#4a4040'], [1, '#141215']])}${radial(sun, [[0, '#f5d2a2', 0.95], [0.25, '#e0a56e', 0.6], [1, '#e0a56e', 0]])}`;
  s += `<filter id="${grain}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" seed="5" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.14"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/></filter></defs>`;
  s += `<rect width="${W}" height="${H * 0.6}" fill="url(#${sky})"/><rect y="${H * 0.6}" width="${W}" height="${H * 0.4}" fill="url(#${sea})"/>`;
  s += `<circle cx="${W * 0.62}" cy="${H * 0.57}" r="${H * 0.32}" fill="url(#${sun})"/>`;
  for (let i = 0; i < 60; i++) {
    const y = H * 0.61 + Math.pow(rand(), 1.6) * H * 0.38;
    const w = 20 + rand() * 160 * (y / H);
    s += `<rect x="${f(W * 0.62 - w / 2 + (rand() - 0.5) * 200 * (y / H))}" y="${f(y)}" width="${f(w)}" height="${f(1.5 + rand() * 2)}" fill="#f0c08c" opacity="${f(0.15 + rand() * 0.45)}"/>`;
  }
  s += `<path d="M0 ${H * 0.62}C${W * 0.2} ${H * 0.58} ${W * 0.3} ${H * 0.5} ${W * 0.42} ${H * 0.6}L0 ${H * 0.66}Z" fill="#17151a" opacity=".85"/>`;
  s += `<rect width="${W}" height="${H}" fill="#808080" filter="url(#${grain})"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${s}</svg>`;
}

/**
 * A soft ripple texture that tiles, for the developer liquid on the landing page: thin bright
 * bands where the noise crosses a level, like light refracted by a slowly moving surface.
 */
export function causticsSVG(S = 512, theme = 'dark') {
  const t = id('ct');
  const [r, g, b] = theme === 'dark' ? [0.75, 0.55, 0.32] : [0.45, 0.36, 0.25];
  const color = `<feColorMatrix in="n" type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 0 1" result="c"/>`;
  const low = '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -8 0 0 0 4.4" result="a1"/>';
  const high = '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  8 0 0 0 -3.6" result="a2"/>';
  const band = '<feComposite in="a1" in2="a2" operator="arithmetic" k1="0.3" k2="0" k3="0" k4="0" result="band"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"><defs><filter id="${t}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="3" seed="11" stitchTiles="stitch" result="n"/>${color}${low}${high}${band}<feComposite in="c" in2="band" operator="in"/></filter></defs><rect width="${S}" height="${S}" filter="url(#${t})"/></svg>`;
}
