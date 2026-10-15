// Builds every piece of pixelotter art from the drawing code in scripts/art/:
//   assets/brand/      mascot, logo, mark, character sheet and brand sheet (SVG and PNG)
//   assets/icons/      the icon set, light and dark, plus icon sheets
//   assets/            animated README banner and illustrations
//   assets/preview/    PNG previews for review
//   docs/              favicon, site sprite, landing art, samples and prints
//   docs/app/          app icons, sprite and samples
// PNG and JPEG files are rendered with a local Edge or Chrome in headless mode.
// Usage: node scripts/art/build-art.mjs [--no-png]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAL, closeBrowser, render } from './kit.mjs';
import { headSVG, mascotSVG } from './otter.mjs';
import { appIconSVG, brandSVG, characterSheetSVG, faviconSVG, logoSVG, mark, markSVG, wordmark } from './brand.mjs';
import { ICON_NAMES, iconSVG, spriteSVG } from './icons.mjs';
import { ILLUSTRATIONS } from './illus.mjs';
import { causticsSVG, otterDeskSVG, seascapeSVG, teapotSVG } from './sample.mjs';
import { bannerSVG, featuresSVG } from './banner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const png = !process.argv.includes('--no-png');
const write = (p, s) => {
  const file = join(root, p);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof s === 'string' ? `${s.trim()}\n` : s);
};
const out = (p) => join(root, p);

function iconSheet(theme) {
  const p = PAL[theme];
  const cols = 12;
  const rows = Math.ceil(ICON_NAMES.length / cols);
  const cell = 56;
  let s = `<rect width="${cols * cell + 32}" height="${rows * cell + 32}" rx="16" fill="${p.surface}"/>`;
  ICON_NAMES.forEach((n, i) => {
    const x = 16 + (i % cols) * cell + 16;
    const y = 16 + Math.floor(i / cols) * cell + 16;
    s += `<g transform="translate(${x} ${y})" fill="none" stroke="${i % 9 === 4 ? p.amber : p.text}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${iconSVG(n).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * cell + 32} ${rows * cell + 32}" width="${cols * cell + 32}" height="${rows * cell + 32}" role="img"><title>The pixelotter icon set: ${ICON_NAMES.length} line icons</title>${s}</svg>`;
}

async function main() {
  // brand
  write('assets/brand/mascot.svg', mascotSVG('light'));
  write('assets/brand/mascot-dark.svg', mascotSVG('dark'));
  write('assets/brand/mascot-head.svg', headSVG('light'));
  write('assets/brand/mascot-head-dark.svg', headSVG('dark'));
  write('assets/brand/mark.svg', markSVG('light'));
  write('assets/brand/mark-dark.svg', markSVG('dark'));
  write('assets/brand/logo.svg', await logoSVG(root, 'light'));
  write('assets/brand/logo-dark.svg', await logoSVG(root, 'dark'));
  write('assets/brand/app-icon.svg', appIconSVG());
  write('assets/brand/favicon.svg', faviconSVG());
  const brand = await brandSVG(root, 'dark');
  const sheet = await characterSheetSVG(root, 'dark');
  write('assets/brand/brand.svg', brand);
  write('assets/brand/character-sheet.svg', sheet);
  write('assets/banner.svg', await bannerSVG(root, 'light'));
  write('assets/banner-dark.svg', await bannerSVG(root, 'dark'));
  write('assets/features.svg', await featuresSVG(root, 'light'));
  write('assets/features-dark.svg', await featuresSVG(root, 'dark'));
  // icons
  for (const n of ICON_NAMES) {
    write(`assets/icons/light/${n}.svg`, iconSVG(n, PAL.light.text));
    write(`assets/icons/dark/${n}.svg`, iconSVG(n, PAL.dark.text));
  }
  write('assets/icons-sheet.svg', iconSheet('light'));
  write('assets/icons-sheet-dark.svg', iconSheet('dark'));
  write('docs/assets/icons.svg', spriteSVG());
  write('docs/app/icons.svg', spriteSVG());
  // illustrations
  for (const [n, fn] of Object.entries(ILLUSTRATIONS)) {
    write(`assets/illustrations/${n}.svg`, fn('light'));
    write(`assets/illustrations/${n}-dark.svg`, fn('dark'));
    write(`docs/assets/art/${n}.svg`, fn('light'));
    write(`docs/assets/art/${n}-dark.svg`, fn('dark'));
  }
  // site and app art
  write('docs/favicon.svg', faviconSVG());
  write('docs/app/icons/icon.svg', appIconSVG());
  write('docs/app/icons/maskable.svg', appIconSVG({ maskable: true }));
  write('docs/assets/art/otto.svg', mascotSVG('light'));
  write('docs/assets/art/otto-dark.svg', mascotSVG('dark'));
  write('docs/assets/art/otto-head.svg', headSVG('dark'));
  write('docs/app/art/otto-loader.svg', headSVG('dark', { expression: 'focused', turn: -0.2 }));
  write('docs/assets/art/caustics.svg', causticsSVG(512, 'dark'));
  write('docs/assets/art/caustics-light.svg', causticsSVG(512, 'light'));
  const wm = await wordmark(root, { x: 0, y: 70, size: 88, color: 'currentColor' });
  write('docs/assets/art/wordmark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(wm.width) + 4} 96" width="${Math.ceil(wm.width) + 4}" height="96" fill="currentColor">${wm.svg}</svg>`);
  write('docs/assets/art/mark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128" width="128" height="128">${mark({ size: 116, theme: 'dark' })}</svg>`);
  write('docs/assets/art/mark-light.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128" width="128" height="128">${mark({ size: 116, theme: 'light' })}</svg>`);

  if (!png) return;
  // samples and prints
  const desk = otterDeskSVG();
  await render(desk, out('docs/app/samples/otter-desk.jpg'), { width: 1600, height: 1200, type: 'jpeg', quality: 86 });
  await render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1200" width="320" height="240">${desk.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`, out('docs/app/samples/otter-desk-thumb.jpg'), { width: 320, height: 240, type: 'jpeg', quality: 80 });
  await render(desk.replace('width="1600" height="1200"', 'width="1200" height="900"'), out('docs/assets/sample/before.jpg'), { width: 1200, height: 900, type: 'jpeg', quality: 84 });
  const tea = teapotSVG();
  await render(tea, out('docs/app/samples/teapot-window.jpg'), { width: 1600, height: 1200, type: 'jpeg', quality: 86 });
  await render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1200" width="320" height="240">${tea.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`, out('docs/app/samples/teapot-window-thumb.jpg'), { width: 320, height: 240, type: 'jpeg', quality: 80 });
  await render(tea.replace('width="1600" height="1200"', 'width="600" height="450"'), out('docs/assets/prints/teapot.jpg'), { width: 600, height: 450, type: 'jpeg', quality: 80 });
  const sea = seascapeSVG();
  await render(sea.replace('width="1200" height="900"', 'width="600" height="450"'), out('docs/assets/prints/seascape.jpg'), { width: 600, height: 450, type: 'jpeg', quality: 80 });
  await render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-170 -210 340 340" width="480" height="480"><rect x="-170" y="-210" width="340" height="340" fill="#1c1714"/>${headSVG('dark').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`, out('docs/assets/prints/portrait.jpg'), { width: 480, height: 480, type: 'jpeg', quality: 80 });
  // icons as PNG for the manifest
  await render(appIconSVG({ size: 512 }), out('docs/app/icons/icon-512.png'), { width: 512, height: 512, transparent: true });
  await render(appIconSVG({ size: 192 }).replace('width="192" height="192"', 'width="192" height="192"'), out('docs/app/icons/icon-192.png'), { width: 192, height: 192, transparent: true });
  await render(appIconSVG({ size: 512, maskable: true }), out('docs/app/icons/maskable-512.png'), { width: 512, height: 512 });
  await render(appIconSVG({ size: 180, maskable: true }), out('docs/app/icons/apple-touch-icon.png'), { width: 180, height: 180 });
  // brand PNGs and previews
  await render(brand, out('assets/brand/brand.png'), { width: 1600, height: 1000 });
  await render(sheet, out('assets/brand/character-sheet.png'), { width: 1800, height: 1300 });
  const bg = (svg, c) => svg.replace('role="img">', `role="img"><rect x="-1000" y="-1000" width="3000" height="3000" fill="${c}"/>`);
  await render(bg(mascotSVG('dark'), '#141416'), out('assets/preview/mascot-dark.png'), { width: 520, height: 660 });
  await render(bg(mascotSVG('light'), '#f3f1ec'), out('assets/preview/mascot-light.png'), { width: 520, height: 660 });
  await closeBrowser();
}

main().catch(async (err) => {
  console.error(err);
  await closeBrowser();
  process.exit(1);
});
