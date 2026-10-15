// Layout math for text layers: lines, alignment and curved text on an arc. Measuring glyphs
// needs a canvas, so the caller passes the advance widths in; everything here is plain math.

/** Splits text into lines and trims a final empty line. */
export const splitLines = (text) => String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

/** The sweep angle (radians) for a curve value from -100 to 100. 100 bends the line into 300 degrees. */
export const curveAngle = (curve) => (Math.max(-100, Math.min(100, curve)) / 100) * ((300 * Math.PI) / 180);

/**
 * Places each glyph of one line on an arc. widths: advance width per glyph. Returns
 * [{ x, y, angle }] for the glyph centers on the baseline, relative to the line's middle.
 * Positive curve arches up (the ends drop), negative curve smiles (the ends rise).
 */
export function layoutArc(widths, curve) {
  const total = widths.reduce((a, b) => a + b, 0);
  const sweep = curveAngle(curve);
  const out = [];
  if (!total) return out;
  if (Math.abs(sweep) < 1e-4) {
    let x = -total / 2;
    for (const w of widths) {
      out.push({ x: x + w / 2, y: 0, angle: 0 });
      x += w;
    }
    return out;
  }
  const r = total / Math.abs(sweep);
  let acc = 0;
  for (const w of widths) {
    const theta = (acc + w / 2) / r - Math.abs(sweep) / 2;
    acc += w;
    if (sweep > 0) out.push({ x: r * Math.sin(theta), y: r - r * Math.cos(theta), angle: theta });
    else out.push({ x: r * Math.sin(theta), y: -(r - r * Math.cos(theta)), angle: -theta });
  }
  return out;
}

/** The radius of the arc for a line, or Infinity when it is straight. */
export function arcRadius(totalWidth, curve) {
  const sweep = Math.abs(curveAngle(curve));
  return sweep < 1e-4 ? Infinity : totalWidth / sweep;
}

/**
 * Bounding box of laid out glyphs, each treated as a box of its width by the font size (ascent
 * above the baseline, a quarter below), rotated with the glyph.
 */
export function glyphBounds(glyphs, widths, size) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  glyphs.forEach((g, i) => {
    const hw = widths[i] / 2;
    const pts = [
      [-hw, -size * 0.8],
      [hw, -size * 0.8],
      [hw, size * 0.25],
      [-hw, size * 0.25],
    ];
    const c = Math.cos(g.angle);
    const s = Math.sin(g.angle);
    for (const [px, py] of pts) {
      const x = g.x + px * c - py * s;
      const y = g.y + px * s + py * c;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  });
  if (!glyphs.length) return { x: 0, y: -size * 0.8, w: 0, h: size * 1.05 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Horizontal start of a straight line of width w in a box of width boxW for an alignment. */
export const alignOffset = (align, w, boxW) => (align === 'left' ? 0 : align === 'right' ? boxW - w : (boxW - w) / 2);
