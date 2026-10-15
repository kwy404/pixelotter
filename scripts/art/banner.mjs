// Animated SVGs for the README: the banner (a drifting light leak, a breathing aperture and
// Otto) and a contact sheet strip of features whose frames develop one after another. The
// animation is CSS inside the SVG, so it also plays where the SVG is shown as an image, and it
// stops for people who prefer reduced motion.
import { PAL, grainFilter, id, radial } from './kit.mjs';
import { head } from './otter.mjs';
import { loadFont, mark, textPath, wordmark } from './brand.mjs';
import { ICONS } from './icons.mjs';

const REDUCED = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}';

export async function bannerSVG(root, theme = 'dark') {
  const p = PAL[theme];
  const W = 880;
  const H = 300;
  const text = await loadFont('textRegular', root);
  const mono = await loadFont('mono', root);
  const leak = id('lk');
  const leak2 = id('lk');
  const gr = id('gr');
  const clip = id('cp');
  const wm = await wordmark(root, { x: 230, y: 150, size: 76, color: p.text });
  const tag = textPath(text, 'A photo editor that lives in your browser.', 234, 194, 19).d;
  const sub = textPath(mono, 'LAYERS  CUTOUTS  STICKERS  OFFLINE  PEER TO PEER', 234, 236, 11.5, { tracking: 1.6 }).d;
  let s = `<style>
.leak{animation:drift 14s ease-in-out infinite alternate;transform-origin:center}
.leak2{animation:drift2 18s ease-in-out infinite alternate}
.ap{animation:breathe 7s ease-in-out infinite;transform-origin:120px 150px}
.glow{animation:pulse 3.2s ease-in-out infinite}
@keyframes drift{from{transform:translate(-60px,10px)}to{transform:translate(90px,-20px)}}
@keyframes drift2{from{transform:translate(40px,0)}to{transform:translate(-80px,20px)}}
@keyframes breathe{0%,100%{transform:rotate(0deg)}50%{transform:rotate(14deg)}}
@keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}}
${REDUCED}
</style>`;
  s += `<defs>${radial(leak, [[0, p.amber, theme === 'dark' ? 0.32 : 0.22], [1, p.amber, 0]])}${radial(leak2, [[0, '#d7b48a', theme === 'dark' ? 0.16 : 0.18], [1, '#d7b48a', 0]])}${grainFilter(gr, { opacity: 0.07 })}<clipPath id="${clip}"><rect width="${W}" height="${H}" rx="20"/></clipPath></defs>`;
  s += `<g clip-path="url(#${clip})"><rect width="${W}" height="${H}" fill="${p.bg}"/>`;
  s += `<g class="leak"><ellipse cx="640" cy="40" rx="320" ry="150" fill="url(#${leak})"/></g>`;
  s += `<g class="leak2"><ellipse cx="200" cy="300" rx="260" ry="110" fill="url(#${leak2})"/></g>`;
  for (let x = 0; x <= W; x += 40) s += `<path d="M${x} 0V${H}" stroke="${theme === 'dark' ? '#fff' : '#1c1b19'}" stroke-opacity=".035"/>`;
  for (let y = 0; y <= H; y += 40) s += `<path d="M0 ${y}H${W}" stroke="${theme === 'dark' ? '#fff' : '#1c1b19'}" stroke-opacity=".035"/>`;
  s += `<g class="ap">${mark({ x: 120, y: 150, size: 150, theme })}</g>`;
  s += wm.svg;
  s += `<path d="${tag}" fill="${p.muted}"/><path d="${sub}" fill="${p.amber}"/>`;
  s += `<g transform="translate(770 190) scale(.62)">${head({ expression: 'confident', turn: -0.45 })}</g>`;
  s += `<circle class="glow" cx="840" cy="250" r="26" fill="url(#${leak})"/>`;
  s += `<rect width="${W}" height="${H}" fill="#808080" filter="url(#${gr})"/>`;
  s += `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="19.5" fill="none" stroke="${p.hair}"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"><title>pixelotter: a photo editor that lives in your browser</title>${s}</svg>`;
}

export async function featuresSVG(root, theme = 'dark') {
  const p = PAL[theme];
  const text = await loadFont('text', root);
  const reg = await loadFont('textRegular', root);
  const mono = await loadFont('mono', root);
  const W = 880;
  const H = 250;
  const items = [
    ['layers', 'Layers and masks', 'groups, blend modes'],
    ['cutout', 'Remove background', 'model runs offline'],
    ['sticker', 'Sticker maker', '512 px WebP, 100 kB'],
    ['text', 'Text and shapes', 'curves, bubbles'],
    ['collaborate', 'Edit together', 'up to 5 friends'],
    ['offline', 'Works offline', 'installable app'],
  ];
  let s = `<style>.f{animation:dev 9s ease-in-out infinite;opacity:.25}
${items.map((_, i) => `.f${i}{animation-delay:${(i * 0.6).toFixed(1)}s}`).join('')}
@keyframes dev{0%{opacity:.12}18%{opacity:1}80%{opacity:1}100%{opacity:.12}}
${REDUCED.replace('animation:none!important', 'animation:none!important;opacity:1!important')}</style>`;
  s += `<rect width="${W}" height="${H}" rx="18" fill="${theme === 'dark' ? '#0f0e0f' : '#e7e2d9'}"/>`;
  for (let k = 0; k < 29; k++) {
    s += `<rect x="${14 + k * 30}" y="12" width="14" height="18" rx="3" fill="${theme === 'dark' ? '#242224' : '#cfc8bb'}"/>`;
    s += `<rect x="${14 + k * 30}" y="${H - 30}" width="14" height="18" rx="3" fill="${theme === 'dark' ? '#242224' : '#cfc8bb'}"/>`;
  }
  items.forEach(([icon, title, sub], i) => {
    const x = 20 + i * 142;
    s += `<g class="f f${i}"><rect x="${x}" y="44" width="132" height="162" rx="6" fill="${p.surface}" stroke="${p.hair}"/>`;
    s += `<g transform="translate(${x + 18} 64) scale(1.4)" fill="none" stroke="${p.amber}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g>`;
    s += `<path d="${textPath(text, title, x + 18, 132, 13).d}" fill="${p.text}"/>`;
    s += `<path d="${textPath(reg, sub, x + 18, 152, 11).d}" fill="${p.muted}"/>`;
    s += `<path d="${textPath(mono, `${i + 12}A`, x + 18, 192, 10, { tracking: 1 }).d}" fill="${p.amber}" opacity=".8"/></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"><title>pixelotter features: layers and masks, remove background, sticker maker, text and shapes, edit together, works offline</title>${s}</svg>`;
}
