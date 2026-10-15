// Otto, the pixelotter mascot: an otter painter in a worn beret with a brush and a palette.
// Drawn in code as layered SVG: base color, a form shadow, ambient occlusion where parts
// touch, an amber rim light from the safelight behind him, fine fur strokes and a cast shadow.
//   otter({ view, expression, theme })   full figure, 600 x 720 frame
//   head({ turn, expression })           head only, centered on 0 0, about 260 x 240
// view: 'three' (three quarter, the main pose), 'front' or 'back'.
// expression: 'confident', 'delighted', 'surprised', 'focused' or 'sheepish'.
import { INK, PAL, arcPoints, blur, edgeFur, f, furStrokes, id, linear, radial, rng } from './kit.mjs';

/**
 * A shape with volume: a lit base, a soft form shadow toward the lower right, an amber rim
 * on the side facing the safelight, and fur strokes, all clipped to the shape.
 */
function volume(d, { base, light, dark, rim = INK.fur, rimSide = 1, fur = null, rimOpacity = 0.75, shadowAt = [0.72, 0.8], lightAt = [0.32, 0.25], bbox }) {
  const clip = id('cl');
  const g = id('vg');
  const sh = id('sh');
  const rm = id('rm');
  const bl = id('bl');
  const [x, y, w, h] = bbox;
  let s = `<defs><clipPath id="${clip}"><path d="${d}"/></clipPath>`;
  s += radial(g, [[0, light], [0.55, base], [1, dark]], { cx: lightAt[0], cy: lightAt[1], r: 0.85 });
  s += radial(sh, [[0, dark, 0.85], [1, dark, 0]], { cx: 0.5, cy: 0.5, r: 0.5 });
  s += linear(rm, rimSide > 0 ? [[0, rim, 0], [0.62, rim, 0], [1, rim, rimOpacity]] : [[0, rim, rimOpacity], [0.38, rim, 0], [1, rim, 0]], { x1: x, y1: 0, x2: x + w, y2: 0, units: 'userSpaceOnUse' });
  s += blur(bl, Math.max(2, w * 0.012));
  s += `</defs><path d="${d}" fill="url(#${g})"/>`;
  s += `<g clip-path="url(#${clip})">`;
  s += `<ellipse cx="${f(x + w * shadowAt[0])}" cy="${f(y + h * shadowAt[1])}" rx="${f(w * 0.6)}" ry="${f(h * 0.55)}" fill="url(#${sh})" opacity=".95"/>`;
  if (fur) s += fur;
  s += `<path d="${d}" fill="none" stroke="url(#${rm})" stroke-width="${f(Math.max(4, w * 0.035))}" filter="url(#${bl})"/>`;
  s += `</g>`;
  return s;
}

/** Fine fur: dark and light strokes in the flow direction, clipped by the caller. */
function furLayer(rand, region, { dark = INK.furDark, light = INK.furLight, count = 140, width = 1.1 } = {}) {
  const a = furStrokes(rand, { ...region, count });
  const b = furStrokes(rand, { ...region, count: Math.round(count * 0.6), len: [4, 9] });
  return `<path d="${a}" fill="none" stroke="${dark}" stroke-width="${width}" stroke-linecap="round" opacity=".38"/><path d="${b}" fill="none" stroke="${light}" stroke-width="${width * 0.8}" stroke-linecap="round" opacity=".32"/>`;
}

function eyes(ex, ey, r, expression, side, rand) {
  // side: -1 left eye, 1 right eye (as seen by the viewer)
  const iris = id('ir');
  let s = `<defs>${radial(iris, [[0, '#3b2a20'], [0.55, INK.eye], [1, '#0a0705']], { cx: 0.42, cy: 0.38, r: 0.62 })}</defs>`;
  const rx = r * 0.86;
  const ry = r;
  if (expression === 'delighted') {
    // happy closed eyes, upward arcs with lashes
    s += `<path d="M${f(ex - rx)} ${f(ey + 2)}Q${f(ex)} ${f(ey - ry * 1.05)} ${f(ex + rx)} ${f(ey + 2)}" fill="none" stroke="${INK.eye}" stroke-width="${f(r * 0.32)}" stroke-linecap="round"/>`;
    return s;
  }
  if (expression === 'focused') {
    // a squint: narrow almond, lowered lid
    s += `<ellipse cx="${f(ex)}" cy="${f(ey + 2)}" rx="${f(rx)}" ry="${f(ry * 0.55)}" fill="url(#${iris})"/>`;
    s += `<path d="M${f(ex - rx * 1.25)} ${f(ey - ry * 0.25)}Q${f(ex)} ${f(ey - ry * 0.75)} ${f(ex + rx * 1.25)} ${f(ey - ry * 0.25 + side * 3)}L${f(ex + rx * 1.25)} ${f(ey - ry * 1.3)}L${f(ex - rx * 1.25)} ${f(ey - ry * 1.3)}Z" fill="${INK.fur}"/>`;
    s += `<path d="M${f(ex - rx * 1.15)} ${f(ey - ry * 0.25)}Q${f(ex)} ${f(ey - ry * 0.72)} ${f(ex + rx * 1.15)} ${f(ey - ry * 0.25 + side * 3)}" fill="none" stroke="${INK.furDeep}" stroke-width="2.4" stroke-linecap="round"/>`;
    s += `<circle cx="${f(ex - rx * 0.3)}" cy="${f(ey - ry * 0.05)}" r="${f(r * 0.17)}" fill="#fff" opacity=".9"/>`;
    return s;
  }
  const wide = expression === 'surprised' ? 1.18 : 1;
  s += `<ellipse cx="${f(ex)}" cy="${f(ey)}" rx="${f(rx * wide)}" ry="${f(ry * wide)}" fill="url(#${iris})"/>`;
  // wet rim and a reflection of the safelight along the lower edge
  s += `<path d="M${f(ex - rx * 0.75 * wide)} ${f(ey + ry * 0.45 * wide)}Q${f(ex)} ${f(ey + ry * 1.0 * wide)} ${f(ex + rx * 0.75 * wide)} ${f(ey + ry * 0.45 * wide)}" fill="none" stroke="${INK.paint.amber}" stroke-width="${f(r * 0.14)}" stroke-linecap="round" opacity=".55"/>`;
  s += `<circle cx="${f(ex - rx * 0.32)}" cy="${f(ey - ry * 0.36)}" r="${f(r * 0.3)}" fill="#fff" opacity=".95"/>`;
  s += `<circle cx="${f(ex + rx * 0.34)}" cy="${f(ey + ry * 0.2)}" r="${f(r * 0.12)}" fill="#fff" opacity=".75"/>`;
  if (expression === 'confident' || expression === 'sheepish') {
    // lowered upper lid: a relaxed, knowing look
    const drop = expression === 'confident' ? 0.3 : 0.22;
    s += `<path d="M${f(ex - rx * 1.3)} ${f(ey - ry * 1.4)}H${f(ex + rx * 1.3)}V${f(ey - ry * (1 - drop * 2) + (expression === 'confident' ? side * 2.5 : 0))}Q${f(ex)} ${f(ey - ry * (1 - drop * 2) - ry * 0.35)} ${f(ex - rx * 1.3)} ${f(ey - ry * (1 - drop * 2))}Z" fill="${INK.fur}"/>`;
    s += `<path d="M${f(ex - rx * 1.05)} ${f(ey - ry * (1 - drop * 2))}Q${f(ex)} ${f(ey - ry * (1 - drop * 2) - ry * 0.35)} ${f(ex + rx * 1.05)} ${f(ey - ry * (1 - drop * 2) + (expression === 'confident' ? side * 2.5 : 0))}" fill="none" stroke="${INK.furDeep}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  if (expression === 'surprised') {
    s += `<ellipse cx="${f(ex)}" cy="${f(ey)}" rx="${f(rx * wide + 2)}" ry="${f(ry * wide + 2)}" fill="none" stroke="${INK.furDeep}" stroke-width="1.6" opacity=".7"/>`;
  }
  void rand;
  return s;
}

function brows(ex, ey, r, expression, side) {
  const lift = { confident: side > 0 ? -6 : 0, delighted: -4, surprised: -12, focused: 5, sheepish: side > 0 ? -2 : -8 }[expression] ?? 0;
  const tilt = { confident: side > 0 ? -5 : 3, focused: side * 6, sheepish: side * -6, surprised: 0, delighted: 0 }[expression] ?? 0;
  const y = ey - r * 1.75 + lift;
  return `<path d="M${f(ex - r * 0.95)} ${f(y + tilt * side * -0.5 + 3)}Q${f(ex)} ${f(y - 4)} ${f(ex + r * 0.95)} ${f(y - tilt * side * -0.5 + 3)}" fill="none" stroke="${INK.furDeep}" stroke-width="3.2" stroke-linecap="round" opacity=".85"/>`;
}

function mouth(mx, my, expression) {
  const c = INK.nose;
  switch (expression) {
    case 'delighted':
      return `<path d="M${f(mx - 26)} ${f(my + 6)}Q${f(mx)} ${f(my + 44)} ${f(mx + 26)} ${f(my + 6)}Q${f(mx)} ${f(my + 14)} ${f(mx - 26)} ${f(my + 6)}Z" fill="#3a1d18"/><path d="M${f(mx - 12)} ${f(my + 26)}Q${f(mx)} ${f(my + 38)} ${f(mx + 12)} ${f(my + 26)}Q${f(mx)} ${f(my + 22)} ${f(mx - 12)} ${f(my + 26)}Z" fill="#a85a4f"/><path d="M${f(mx - 9)} ${f(my + 8)}h18v6h-18z" fill="#efe6d8"/>`;
    case 'surprised':
      return `<ellipse cx="${f(mx)}" cy="${f(my + 18)}" rx="11" ry="14" fill="#3a1d18"/><ellipse cx="${f(mx)}" cy="${f(my + 24)}" rx="6" ry="5" fill="#a85a4f"/>`;
    case 'focused':
      return `<path d="M${f(mx)} ${f(my)}V${f(my + 8)}M${f(mx)} ${f(my + 8)}Q${f(mx - 12)} ${f(my + 16)} ${f(mx - 20)} ${f(my + 10)}M${f(mx)} ${f(my + 8)}Q${f(mx + 12)} ${f(my + 16)} ${f(mx + 20)} ${f(my + 10)}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/><path d="M${f(mx + 6)} ${f(my + 13)}q6 10 14 4q-2 -6 -8 -7z" fill="#a85a4f"/>`;
    case 'sheepish':
      return `<path d="M${f(mx)} ${f(my)}V${f(my + 8)}M${f(mx - 18)} ${f(my + 14)}Q${f(mx - 8)} ${f(my + 10)} ${f(mx)} ${f(my + 14)}Q${f(mx + 8)} ${f(my + 18)} ${f(mx + 18)} ${f(my + 12)}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
    default:
      // confident: a lopsided smirk
      return `<path d="M${f(mx)} ${f(my)}V${f(my + 9)}M${f(mx)} ${f(my + 9)}Q${f(mx - 10)} ${f(my + 17)} ${f(mx - 19)} ${f(my + 12)}M${f(mx)} ${f(my + 9)}Q${f(mx + 14)} ${f(my + 20)} ${f(mx + 27)} ${f(my + 5)}" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/><path d="M${f(mx + 25)} ${f(my + 1)}q4 2 3 7" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
}

/** The beret: a soft felt disc tilted toward the viewer's right, worn and slightly frayed. */
function beret(rand, { tilt = -10, cx = 8, cy = 4, back = false } = {}) {
  const felt = id('ft');
  const tex = id('tx');
  const clip = id('bc');
  const sh = id('bs');
  const d = `M-118 -58C-128 -92 -88 -132 -22 -138C46 -144 118 -122 132 -84C140 -62 120 -46 96 -50C52 -58 -6 -60 -62 -50C-90 -45 -112 -40 -118 -58Z`;
  let s = `<g transform="translate(${cx} ${cy}) rotate(${tilt}) scale(0.9)">`;
  s += `<defs>${radial(felt, [[0, INK.beretLight], [0.6, INK.beret], [1, INK.beretDark]], { cx: 0.38, cy: 0.3, r: 0.8 })}`;
  s += `<filter id="${tex}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="9"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.22"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/></filter>`;
  s += `<clipPath id="${clip}"><path d="${d}"/></clipPath>${radial(sh, [[0, '#000', 0.5], [1, '#000', 0]])}</defs>`;
  // cast shadow of the beret on the head
  const soft = id('bb');
  s += `<defs>${blur(soft, 6)}</defs><path d="M-112 -44C-80 -36 40 -40 112 -38" fill="none" stroke="${INK.furDeep}" stroke-width="16" stroke-linecap="round" opacity=".5" filter="url(#${soft})"/>`;
  s += `<path d="${d}" fill="url(#${felt})"/>`;
  s += `<g clip-path="url(#${clip})">`;
  s += `<rect x="-140" y="-150" width="290" height="120" fill="#fff" filter="url(#${tex})" opacity=".55"/>`;
  // worn, lighter patches and a faded crease
  s += `<ellipse cx="-30" cy="-118" rx="60" ry="14" fill="#7b6268" opacity=".22"/>`;
  s += `<path d="M-70 -100C-30 -112 30 -112 80 -96" fill="none" stroke="${INK.beretDark}" stroke-width="3" opacity=".5"/>`;
  s += `<ellipse cx="70" cy="-62" rx="80" ry="24" fill="url(#${sh})"/>`;
  // amber rim from the safelight on the right
  s += `<path d="M60 -132C110 -120 140 -96 128 -66" fill="none" stroke="${INK.paint.amber}" stroke-width="5" opacity=".55"/>`;
  // a paint drip on the felt
  s += `<path d="M24 -122c6 -2 10 2 9 7c-1 6 -3 12 -6 12c-3 0 -4 -6 -6 -10c-2 -4 -1 -8 3 -9z" fill="${INK.paint.ochre}" opacity=".8"/>`;
  s += `</g>`;
  // the band (headband) underneath, darker, with stitches
  s += `<path d="M-116 -56C-70 -44 40 -46 110 -52" fill="none" stroke="${INK.beretDark}" stroke-width="7" stroke-linecap="round"/>`;
  s += `<path d="M-104 -53C-64 -44 30 -45 100 -50" fill="none" stroke="#8b7378" stroke-width="1.4" stroke-dasharray="4 6" opacity=".55"/>`;
  // the little stalk on top
  if (!back) s += `<path d="M-14 -138c-2 -10 4 -16 12 -14c4 1 4 6 0 7" fill="none" stroke="${INK.beretDark}" stroke-width="6" stroke-linecap="round"/>`;
  else s += `<path d="M-6 -138c-2 -10 4 -16 12 -14" fill="none" stroke="${INK.beretDark}" stroke-width="6" stroke-linecap="round"/>`;
  // frayed edge
  for (let i = 0; i < 14; i++) {
    const t = rand();
    const x = -110 + t * 220;
    const y = -52 + Math.sin(t * Math.PI) * 6 + 2;
    s += `<path d="M${f(x)} ${f(y)}l${f((rand() - 0.5) * 3)} ${f(2 + rand() * 4)}" stroke="${INK.beretDark}" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>`;
  }
  s += `</g>`;
  return s;
}

/** The head on its own, centered on 0 0. turn from -1 (looking left) to 1 (right). */
export function head({ turn = -0.35, expression = 'confident', seed = 11, beretOn = true } = {}) {
  const rand = rng(seed);
  const mx = turn * 30; // muzzle shift
  const skull = `M0 -100C70 -100 118 -62 120 -5C122 48 84 96 0 98C-84 96 -122 48 -120 -5C-118 -62 -70 -100 0 -100Z`;
  let s = '';
  // ears (the far one partly hidden when turned)
  for (const side of [-1, 1]) {
    const far = side * turn > 0;
    const ex = side * (106 - (far ? 10 : 0)) + turn * 6;
    const ear = id('er');
    s += `<defs>${radial(ear, [[0, INK.furLight], [1, INK.furDark]], { cx: 0.4, cy: 0.35 })}</defs>`;
    s += `<circle cx="${f(ex)}" cy="-52" r="${far ? 17 : 21}" fill="url(#${ear})"/><circle cx="${f(ex + side * -1)}" cy="-50" r="${far ? 8 : 10}" fill="${INK.furDeep}" opacity=".85"/>`;
  }
  const fur = furLayer(rand, { cx: 0, cy: -20, rx: 110, ry: 90, angle: 270, spread: 50 }, { count: 220 });
  s += volume(skull, { base: INK.fur, light: INK.furLight, dark: INK.furDark, rim: INK.paint.amber, fur, bbox: [-120, -100, 240, 198], rimOpacity: 0.85 });
  // fuzzy cheeks
  const cheekL = arcPoints(0, 0, 120, 98, 110, 190, 30);
  const cheekR = arcPoints(0, 0, 120, 98, -10, 70, 30);
  s += `<path d="${edgeFur(rand, cheekL, { len: [3, 7] })}${edgeFur(rand, cheekR, { len: [3, 7], out: -1 })}" fill="none" stroke="${INK.fur}" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>`;
  // ambient occlusion under the beret and around the muzzle
  const ao = id('ao');
  s += `<defs>${blur(ao, 8)}</defs>`;
  s += `<ellipse cx="${f(mx)}" cy="52" rx="80" ry="44" fill="${INK.furDeep}" opacity=".35" filter="url(#${ao})"/>`;
  // muzzle: two puffy pads and a chin, cream with soft shading
  const pad = id('pd');
  s += `<defs>${radial(pad, [[0, '#efe1cb'], [0.6, INK.cream], [1, INK.creamShade]], { cx: 0.42, cy: 0.3, r: 0.75 })}</defs>`;
  s += `<ellipse cx="${f(mx)}" cy="80" rx="32" ry="17" fill="url(#${pad})"/>`;
  for (const side of [-1, 1]) {
    const far = side * turn > 0;
    s += `<ellipse cx="${f(mx + side * (far ? 34 : 40))}" cy="50" rx="${far ? 38 : 46}" ry="35" fill="url(#${pad})"/>`;
  }
  // whisker pores
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) s += `<circle cx="${f(mx + side * (26 + (i % 3) * 11))}" cy="${f(46 + Math.floor(i / 3) * 11 + (i % 3) * 2)}" r="1.7" fill="${INK.creamShade}"/>`;
  }
  // eyes and brows
  const eyeY = -14;
  for (const side of [-1, 1]) {
    const far = side * turn > 0;
    const ex = side * (far ? 40 : 48) + turn * 28;
    const r = far ? 15 : 17;
    s += `<ellipse cx="${f(ex)}" cy="${eyeY + 4}" rx="${r + 7}" ry="${r + 6}" fill="${INK.furDark}" opacity=".45" filter="url(#${ao})"/>`;
    s += eyes(ex, eyeY, r, expression, side, rand);
    s += brows(ex, eyeY, r, expression, side);
  }
  // nose: broad, soft, with a wet highlight
  const nose = id('ns');
  s += `<defs>${radial(nose, [[0, '#4a3a33'], [1, INK.nose]], { cx: 0.4, cy: 0.3, r: 0.7 })}</defs>`;
  s += `<path d="M${f(mx - 24)} 14C${f(mx - 20)} 4 ${f(mx + 20)} 4 ${f(mx + 24)} 14C${f(mx + 28)} 25 ${f(mx + 10)} 37 ${f(mx)} 38C${f(mx - 10)} 37 ${f(mx - 28)} 25 ${f(mx - 24)} 14Z" fill="url(#${nose})"/>`;
  s += `<ellipse cx="${f(mx - 8)}" cy="12" rx="8" ry="4" fill="#fff" opacity=".5"/><ellipse cx="${f(mx + 12)}" cy="16" rx="3" ry="2" fill="${INK.paint.amber}" opacity=".5"/>`;
  s += mouth(mx, 38, expression);
  // whiskers, long and fine
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y0 = 48 + i * 9;
      s += `<path d="M${f(mx + side * 52)} ${y0}Q${f(mx + side * 110)} ${f(y0 - 8 + i * 6)} ${f(mx + side * (150 + i * 8))} ${f(y0 + 2 + i * 12)}" fill="none" stroke="#efe6d8" stroke-width="1.3" stroke-linecap="round" opacity=".7"/>`;
    }
  }
  if (beretOn) s += beret(rand, { cx: 10 + turn * 8, cy: -14, tilt: -13 });
  return s;
}

/** A paint stained paw (a small rounded mitt with toe lines). */
function paw(x, y, r, angle, rand, stains = 3) {
  const g = id('pw');
  let s = `<g transform="translate(${f(x)} ${f(y)}) rotate(${angle})"><defs>${radial(g, [[0, INK.furLight], [0.7, INK.fur], [1, INK.furDark]], { cx: 0.35, cy: 0.3 })}</defs>`;
  s += `<ellipse rx="${r}" ry="${f(r * 0.82)}" fill="url(#${g})"/>`;
  s += `<path d="M${f(-r * 0.35)} ${f(-r * 0.75)}v${f(r * 0.45)}M0 ${f(-r * 0.8)}v${f(r * 0.5)}M${f(r * 0.35)} ${f(-r * 0.75)}v${f(r * 0.45)}" stroke="${INK.furDeep}" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>`;
  const colors = Object.values(INK.paint);
  for (let i = 0; i < stains; i++) {
    const c = colors[Math.floor(rand() * colors.length)];
    s += `<ellipse cx="${f((rand() - 0.5) * r * 1.2)}" cy="${f((rand() - 0.3) * r)}" rx="${f(2 + rand() * r * 0.25)}" ry="${f(1.5 + rand() * r * 0.18)}" fill="${c}" opacity=".85" transform="rotate(${f(rand() * 180)})"/>`;
  }
  s += `<path d="M${f(-r * 0.6)} ${f(-r * 0.45)}q${f(r * 0.3)} ${f(-r * 0.4)} ${f(r * 0.8)} ${f(-r * 0.35)}" fill="none" stroke="${INK.paint.amber}" stroke-width="2" opacity=".5"/>`;
  s += `</g>`;
  return s;
}

/** The artist's palette: a kidney shaped board with a thumb hole and dabs of muted paint. */
export function palette(cx, cy, scale = 1, angle = -14) {
  const wood = id('wd');
  const grain = id('gr');
  const d = `M-96 -6C-104 -46 -50 -70 6 -66C66 -62 104 -34 100 4C96 40 52 62 4 60C-28 58 -34 40 -14 30C2 22 -6 6 -24 8C-44 10 -40 30 -60 36C-80 42 -92 26 -96 -6Z`;
  let s = `<g transform="translate(${cx} ${cy}) rotate(${angle}) scale(${scale})"><defs>${radial(wood, [[0, INK.woodLight], [0.65, INK.wood], [1, INK.woodDark]], { cx: 0.4, cy: 0.3, r: 0.8 })}`;
  s += `<clipPath id="${grain}"><path d="${d}"/></clipPath></defs>`;
  s += `<path d="${d}" transform="translate(5 8)" fill="#000" opacity=".35"/>`;
  s += `<path d="${d}" fill="url(#${wood})"/>`;
  s += `<g clip-path="url(#${grain})" opacity=".35">`;
  for (let i = 0; i < 9; i++) s += `<path d="M-110 ${-60 + i * 14}C-40 ${-70 + i * 14} 30 ${-48 + i * 14} 110 ${-58 + i * 14}" fill="none" stroke="${INK.woodDark}" stroke-width="1.2"/>`;
  s += `</g>`;
  const dabs = [
    [-62, -20, INK.paint.cream, 13],
    [-30, -44, INK.paint.ochre, 12],
    [8, -48, INK.paint.rust, 11],
    [44, -36, INK.paint.slate, 12],
    [70, -10, INK.paint.sage, 11],
    [58, 26, INK.paint.plum, 10],
    [26, 40, INK.paint.amber, 11],
  ];
  for (const [x, y, c, r] of dabs) {
    s += `<path d="M${x - r} ${y}c0 ${-r * 0.9} ${r * 1.9} ${-r * 1.1} ${r * 2} ${-r * 0.1}c${r * 0.2} ${r * 0.9} ${-r * 0.6} ${r * 1.2} ${-r * 1.2} ${r}c${-r * 0.5} ${-r * 0.1} ${-r * 0.8} ${-r * 0.4} ${-r * 0.8} ${-r * 0.9}z" fill="${c}"/>`;
    s += `<ellipse cx="${x - r * 0.25}" cy="${y - r * 0.35}" rx="${r * 0.35}" ry="${r * 0.18}" fill="#fff" opacity=".35"/>`;
  }
  // a smear where colors were mixed
  s += `<path d="M-50 10c18 -6 30 4 46 -2" fill="none" stroke="${INK.paint.slate}" stroke-width="7" stroke-linecap="round" opacity=".55"/>`;
  s += `<path d="M-46 14c14 -4 26 2 38 -3" fill="none" stroke="${INK.paint.ochre}" stroke-width="4" stroke-linecap="round" opacity=".5"/>`;
  s += `</g>`;
  return s;
}

/** A round brush with a wooden handle, a metal ferrule and an amber loaded tip. */
export function brush(x0, y0, x1, y1, w = 10) {
  const a = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const handle = id('hd');
  const ferrule = id('fr');
  let s = `<g transform="translate(${f(x0)} ${f(y0)}) rotate(${f(a)})"><defs>${linear(handle, [[0, INK.woodLight], [0.5, INK.wood], [1, INK.woodDark]])}${linear(ferrule, [[0, '#d9d6cf'], [0.5, INK.metal], [1, INK.metalDark]])}</defs>`;
  s += `<path d="M0 ${-w * 0.35}L${f(len * 0.72)} ${-w * 0.5}V${w * 0.5}L0 ${w * 0.35}Z" fill="url(#${handle})"/>`;
  s += `<rect x="${f(len * 0.72)}" y="${-w * 0.55}" width="${f(len * 0.12)}" height="${w * 1.1}" rx="2" fill="url(#${ferrule})"/>`;
  s += `<path d="M${f(len * 0.84)} ${-w * 0.55}C${f(len * 0.93)} ${-w * 0.55} ${f(len * 0.98)} ${-w * 0.2} ${f(len)} 0C${f(len * 0.98)} ${w * 0.2} ${f(len * 0.93)} ${w * 0.55} ${f(len * 0.84)} ${w * 0.55}Z" fill="${INK.paint.amber}"/>`;
  s += `<path d="M${f(len * 0.86)} ${-w * 0.25}C${f(len * 0.92)} ${-w * 0.25} ${f(len * 0.96)} -1 ${f(len * 0.99)} 0" fill="none" stroke="#f0cf9f" stroke-width="1.6" opacity=".7"/>`;
  s += `<path d="M${f(len * 0.05)} ${-w * 0.12}L${f(len * 0.7)} ${-w * 0.25}" stroke="#fff" stroke-width="1.4" opacity=".3"/>`;
  s += `</g>`;
  return s;
}

/** A soft glow of light at the brush tip: Otto paints with light. */
function glowDot(x, y, r = 34) {
  const g = id('gl');
  return `<defs>${radial(g, [[0, '#f3c88b', 0.9], [0.35, INK.paint.amber, 0.45], [1, INK.paint.amber, 0]])}</defs><circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g})"/>`;
}

/** The full figure in a 600 by 720 frame. */
export function otter({ view = 'three', expression = 'confident', theme = 'dark', seed = 5, glow = true } = {}) {
  const rand = rng(seed);
  const p = PAL[theme];
  const back = view === 'back';
  const turn = view === 'front' ? 0 : view === 'three' ? -0.38 : 0;
  let s = '';
  // cast shadow on the ground
  const cs = id('cs');
  s += `<defs>${radial(cs, [[0, '#000', theme === 'dark' ? 0.75 : 0.35], [1, '#000', 0]])}</defs>`;
  s += `<ellipse cx="300" cy="676" rx="220" ry="30" fill="url(#${cs})"/>`;
  // tail, behind the body: thick at the base, tapering, curling on the ground
  const tail = back
    ? 'M268 560C250 620 252 668 300 694C348 720 420 706 460 668C484 646 476 622 452 632C418 646 382 662 350 646C318 630 330 590 334 560Z'
    : 'M360 560C410 600 470 616 520 604C556 596 566 570 552 556C540 546 524 560 502 566C462 576 420 560 392 528Z';
  const tailBox = back ? [250, 560, 234, 160] : [360, 528, 206, 92];
  const tailFur = furLayer(rand, { cx: back ? 360 : 460, cy: back ? 650 : 572, rx: back ? 100 : 90, ry: back ? 50 : 30, angle: back ? 20 : -5, spread: 30 }, { count: 90 });
  s += volume(tail, { base: INK.fur, light: INK.furLight, dark: INK.furDeep, rim: INK.paint.amber, fur: tailFur, bbox: tailBox, rimOpacity: 0.9 });
  if (back) s += palette(452, 470, 0.9, 18);
  // feet
  for (const [x, dx] of [
    [248, -1],
    [352, 1],
  ]) {
    const g = id('ft');
    s += `<defs>${radial(g, [[0, INK.furLight], [0.6, INK.fur], [1, INK.furDeep]], { cx: 0.4, cy: 0.3 })}</defs>`;
    s += `<ellipse cx="${x + dx * 6}" cy="654" rx="48" ry="20" fill="url(#${g})"/>`;
    s += `<path d="M${x + dx * 6 - 20} 660v-8M${x + dx * 6} 662v-9M${x + dx * 6 + 20} 660v-8" stroke="${INK.furDeep}" stroke-width="2" stroke-linecap="round" opacity=".6"/>`;
  }
  // body: a soft pear, narrower at the shoulders
  const body = 'M300 300C372 300 404 352 410 420C418 500 424 580 398 630C372 668 228 668 202 630C176 580 182 500 190 420C196 352 228 300 300 300Z';
  const bodyFur = furLayer(rand, { cx: 300, cy: 480, rx: 120, ry: 170, angle: 95, spread: 30 }, { count: 300 });
  s += volume(body, { base: INK.fur, light: INK.furLight, dark: INK.furDark, rim: INK.paint.amber, fur: bodyFur, bbox: [182, 300, 242, 368], rimOpacity: 0.9, lightAt: [0.35, 0.2] });
  s += `<path d="${edgeFur(rand, arcPoints(300, 480, 116, 180, 120, 240, 40), { len: [3, 6] })}${edgeFur(rand, arcPoints(300, 480, 116, 180, -60, 60, 40), { len: [4, 9], out: -1 })}" fill="none" stroke="${INK.furDark}" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>`;
  if (!back) {
    // cream chest and belly
    const belly = 'M300 326C340 330 354 372 352 430C350 500 340 560 322 600C312 618 288 618 278 600C260 560 250 500 248 430C246 372 260 330 300 326Z';
    const g = id('bl');
    s += `<defs>${radial(g, [[0, '#ecdcc2'], [0.6, INK.cream], [1, INK.creamShade]], { cx: 0.4, cy: 0.25, r: 0.8 })}</defs>`;
    const fade = id('fd');
    s += `<defs>${linear(fade, [[0, '#fff', 1], [0.55, '#fff', 0.9], [1, '#fff', 0]])}<mask id="${fade}m"><rect x="200" y="320" width="200" height="310" fill="url(#${fade})"/></mask></defs>`;
    s += `<path d="${belly}" fill="url(#${g})" mask="url(#${fade}m)"/>`;
    s += `<path d="${furStrokes(rand, { cx: 300, cy: 480, rx: 55, ry: 140, count: 160, angle: 90, spread: 30, len: [5, 10] })}" fill="none" stroke="${INK.creamShade}" stroke-width="1" opacity=".55"/>`;
    // a painter's smock strap? no: a paint smudge on the chest, Otto wipes his paws there
    s += `<path d="M318 470c10 -6 22 -4 26 4c2 6 -8 8 -16 6c-6 -2 -12 -6 -10 -10z" fill="${INK.paint.slate}" opacity=".55"/><path d="M262 520c8 -4 16 0 18 6c1 4 -6 5 -12 3c-4 -2 -8 -5 -6 -9z" fill="${INK.paint.ochre}" opacity=".5"/>`;
  } else {
    // the back: a darker stripe down the spine
    s += `<path d="M300 320C318 400 316 520 300 640C284 520 282 400 300 320Z" fill="${INK.furDark}" opacity=".45"/>`;
  }
  // ambient occlusion under the head
  const ao = id('ao');
  s += `<defs>${blur(ao, 14)}</defs><ellipse cx="300" cy="322" rx="110" ry="26" fill="${INK.furDeep}" opacity=".6" filter="url(#${ao})"/>`;

  // arms
  const armG = id('ag');
  s += `<defs>${radial(armG, [[0, INK.furLight], [0.6, INK.fur], [1, INK.furDark]], { cx: 0.35, cy: 0.25, r: 0.8 })}</defs>`;
  if (view === 'three') {
    // left arm (viewer's left) holds the palette at the hip
    s += palette(176, 474, 1.0, -16);
    s += volume('M222 360C196 380 184 420 186 456C188 474 210 480 222 466C228 432 236 404 244 384Z', { base: INK.fur, light: INK.furLight, dark: INK.furDeep, rim: INK.paint.amber, bbox: [184, 360, 60, 120], rimOpacity: 0.5, fur: furLayer(rand, { cx: 214, cy: 420, rx: 24, ry: 50, angle: 100 }, { count: 40 }) });
    s += paw(198, 468, 22, -20, rand, 3);
    // right arm raised, holding the brush out with a flourish
    s += volume('M384 362C420 360 452 336 470 300C478 284 466 270 452 278C432 306 410 322 380 330Z', { base: INK.fur, light: INK.furLight, dark: INK.furDeep, rim: INK.paint.amber, bbox: [380, 270, 100, 92], rimOpacity: 0.9, fur: furLayer(rand, { cx: 430, cy: 320, rx: 40, ry: 24, angle: -40 }, { count: 40 }) });
    s += `<path d="M386 340C414 336 440 318 456 292" fill="none" stroke="${INK.paint.amber}" stroke-width="4" opacity=".5"/>`;
    s += brush(436, 318, 548, 182, 11);
    s += paw(462, 284, 21, -40, rand, 4);
    if (glow) s += glowDot(548, 182, 46);
  } else if (view === 'front') {
    s += palette(170, 492, 0.9, -8);
    s += `<path d="M222 360C200 392 194 430 198 470C200 488 222 492 232 478C236 444 240 410 246 388Z" fill="url(#${armG})"/>`;
    s += paw(210, 482, 21, -10, rand, 3);
    s += `<path d="M378 360C400 392 406 430 402 470C400 488 378 492 368 478C364 444 360 410 354 388Z" fill="url(#${armG})"/>`;
    s += brush(392, 520, 470, 380, 10);
    s += paw(390, 482, 21, 10, rand, 3);
  } else {
    // back view: elbows and the brush peeking over the shoulder
    s += brush(250, 360, 140, 200, 10);
    s += `<path d="M218 360C196 392 190 430 196 466C202 480 220 478 226 466C230 434 236 404 244 386Z" fill="url(#${armG})"/>`;
    s += `<path d="M382 360C404 392 410 430 404 466C398 480 380 478 374 466C370 434 364 404 356 386Z" fill="url(#${armG})"/>`;
  }

  const key = id('ky');
  s += `<defs>${radial(key, [[0, '#f6e7cf', 0.28], [1, '#f6e7cf', 0]])}</defs><ellipse cx="250" cy="400" rx="80" ry="120" fill="url(#${key})"/>`;
  // head
  if (back) {
    const skull = 'M0 -100C70 -100 118 -62 120 -5C122 48 84 96 0 98C-84 96 -122 48 -120 -5C-118 -62 -70 -100 0 -100Z';
    const hf = furLayer(rand, { cx: 0, cy: 0, rx: 110, ry: 90, angle: 90, spread: 40 }, { count: 220 });
    let h = '';
    for (const side of [-1, 1]) h += `<circle cx="${side * 106}" cy="-52" r="21" fill="${INK.furDark}"/>`;
    h += volume(skull, { base: INK.furDark, light: INK.fur, dark: INK.furDeep, rim: INK.paint.amber, fur: hf, bbox: [-120, -100, 240, 198], rimOpacity: 0.9 });
    h += beret(rand, { cx: 0, tilt: 8, back: true });
    s += `<g transform="translate(300 218)">${h}</g>`;
  } else {
    s += `<g transform="translate(300 218)">${head({ turn, expression, seed: seed + 3 })}</g>`;
  }
  void p;
  return s;
}

/** The mascot as a standalone SVG. */
export function mascotSVG(theme = 'dark', { view = 'three', expression = 'confident', title = 'Otto, the pixelotter otter painter, in a beret with a brush and a palette' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="60 60 520 660" width="520" height="660" role="img"><title>${title}</title>${otter({ view, expression, theme })}</svg>`;
}
/** Head only, for avatars and the header mark. */
export function headSVG(theme = 'dark', { expression = 'confident', turn = -0.3 } = {}) {
  void theme; // the head reads the same on light and dark backgrounds
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-170 -200 340 320" width="340" height="320" role="img"><title>Otto the otter painter</title>${head({ turn, expression })}</svg>`;
}
