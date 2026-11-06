// card-legibility.mjs — measures, from RENDERED PIXELS, whether text on the social card is readable.
// Contrast is WCAG relative-luminance contrast. Two measurements:
//   backdropContrast  exact: the text-free backdrop under a text box vs the ink (what the gate uses).
//   inkVisibility     final card only: is the ink actually drawn, and how does it read against what is around it.
import sharp from 'sharp';

export const MIN_CONTRAST = 4.5;
const lin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
export const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => { const [hi, lo] = a >= b ? [a, b] : [b, a]; return (hi + 0.05) / (lo + 0.05); };

async function pixels(file, box) {
  const { data, info } = await sharp(file).removeAlpha()
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h }).raw().toBuffer({ resolveWithObject: true });
  return { data, n: info.width * info.height };
}
const pctl = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/** Contrast of `ink` [r,g,b] against every pixel of a text-free backdrop inside `box`. p1 = the value 99% of pixels reach. */
export async function backdropContrast(file, box, ink) {
  const { data, n } = await pixels(file, box);
  const li = lum(...ink);
  const rs = new Array(n);
  for (let i = 0; i < n; i++) rs[i] = ratio(li, lum(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]));
  rs.sort((a, b) => a - b);
  return { p1: pctl(rs, 0.01), median: pctl(rs, 0.5), min: rs[0] };
}

/** On a FINISHED card: share of pixels that are ink-coloured, and the median contrast of ink vs everything else in the box. */
export async function inkVisibility(file, box, ink, nearDist = 60) {
  const { data, n } = await pixels(file, box);
  const li = lum(...ink);
  let inkCount = 0; const others = [];
  for (let i = 0; i < n; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    if (Math.hypot(r - ink[0], g - ink[1], b - ink[2]) <= nearDist) inkCount++;
    else others.push(ratio(li, lum(r, g, b)));
  }
  others.sort((a, b) => a - b);
  return { inkShare: inkCount / n, backgroundContrast: others.length ? pctl(others, 0.5) : 1 };
}
export const regionReadable = (v) => v.inkShare >= 0.02 && v.backgroundContrast >= MIN_CONTRAST;

/**
 * Render, measure, and on failure render ONCE more with the corrective settings; still failing = throw.
 * render(attempt) -> artifacts; measure(artifacts) -> { ok, detail }.
 */
export async function runGate({ render, measure }) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const art = await render(attempt);
    const m = await measure(art);
    if (m.ok) return { art, attempts: attempt + 1, detail: m.detail };
    last = m.detail;
  }
  throw new Error(`social card failed the legibility gate after a corrective re-render (${last}); refusing to ship an unreadable card`);
}

/**
 * Text for ImageMagick's `caption:` / `label:` as a literal. A leading "@" would read a file into the public card and
 * "%" starts a property expansion. The @file route is blocked by the default Ubuntu ImageMagick policy, so neutralise
 * instead: a leading no-break space (ImageMagick strips ordinary leading whitespace before looking for '@'; the card is trimmed afterwards) and doubled percent signs.
 */
export const literalText = (text) => `\u00a0${String(text).replace(/%/g, '%%')}`;
