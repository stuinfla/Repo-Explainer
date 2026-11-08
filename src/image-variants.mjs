// src/image-variants.mjs — responsive AVIF + JPEG variants for the raster images that remain on a page.
//
// WHY: a 1536px gpt-image PNG is 1-2 MB and renders ~400px wide on a phone. Measured on the live ruvllm page the
// three rasters were 92% of the 4.6 MB transferred; the same pixels at 960px AVIF are ~20-40 KB. The original
// full-size PNG is still shipped (the click-to-enlarge lightbox shows it) but is never fetched on page load.
//
// QUALITY RULE: the lowest AVIF quality, never below QUALITY_FLOOR, whose luma SSIM against the same-size
// resized original is >= SSIM_TARGET, measured on the 960px variant (the width most phones and laptops get).
// SSIM here: 8x8 windows, stride 4, uniform weights, C1=(0.01*255)^2, C2=(0.03*255)^2, on 8-bit luma.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

export const WIDTHS = [480, 960, 1440];
export const QUALITY_FLOOR = 50;
export const QUALITY_STEPS = [50, 55, 60, 65, 70, 75, 80];
export const SSIM_TARGET = 0.98;
const MEASURE_WIDTH = 960;

/** Mean SSIM of two equal-size 8-bit single-channel buffers. */
export function ssimLuma(a, b, w, h) {
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, N = 64;
  let sum = 0, count = 0;
  for (let y = 0; y + 8 <= h; y += 4) {
    for (let x = 0; x + 8 <= w; x += 4) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let j = 0; j < 8; j++) {
        const row = (y + j) * w + x;
        for (let i = 0; i < 8; i++) {
          const p = a[row + i], q = b[row + i];
          sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q;
        }
      }
      const ma = sa / N, mb = sb / N;
      const va = saa / N - ma * ma, vb = sbb / N - mb * mb, cov = sab / N - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  }
  return count ? sum / count : 1;
}

const luma = async (input) => {
  const { data, info } = await sharp(input).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};

/** SSIM between the original resized to `width` and its AVIF encoding at `quality`. Returns { ssim, bytes }. */
export async function avifSsim(srcBuf, width, quality) {
  const ref = await sharp(srcBuf).resize({ width, withoutEnlargement: true }).png().toBuffer();
  const enc = await sharp(ref).avif({ quality, effort: 4 }).toBuffer();
  const [A, B] = await Promise.all([luma(ref), luma(enc)]);
  return { ssim: ssimLuma(A.data, B.data, A.w, A.h), bytes: enc.length };
}

/** Lowest quality in QUALITY_STEPS (>= QUALITY_FLOOR) that reaches SSIM_TARGET; the top step when none does. */
export async function pickQuality(srcBuf, { target = SSIM_TARGET, steps = QUALITY_STEPS } = {}) {
  let last = null;
  for (const q of steps) {
    last = { quality: q, ...(await avifSsim(srcBuf, MEASURE_WIDTH, q)) };
    if (last.ssim >= target) return last;
  }
  return last;
}

const stem = (file) => path.basename(file).replace(/\.[^.]+$/, '');

/**
 * Write <stem>-<w>.avif and <stem>-<w>.jpg for every width <= the source width (the source width itself when it is
 * narrower than the smallest step) into outDir. Idempotent: a sidecar keyed on the source bytes + quality skips re-encoding.
 * Returns { stem, width, height, quality, ssim, widths:[…], avif:[{w,file,bytes}], jpg:[…] }.
 */
export async function makeVariants(srcFile, outDir, opts = {}) {
  const buf = fs.readFileSync(srcFile);
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error(`image-variants: cannot read dimensions of ${srcFile}`);
  const name = stem(srcFile);
  const widths = [...new Set(WIDTHS.filter((w) => w <= meta.width).concat(meta.width < WIDTHS[0] ? [meta.width] : []))];
  const key = crypto.createHash('sha256').update(buf).update(JSON.stringify([widths, opts.quality ?? 'auto', opts.target ?? SSIM_TARGET])).digest('hex');
  fs.mkdirSync(outDir, { recursive: true });
  const sidecar = path.join(outDir, `.${name}.variants.json`);
  const files = (ext) => widths.map((w) => path.join(outDir, `${name}-${w}.${ext}`));
  try {
    const prev = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    if (prev.key === key && [...files('avif'), ...files('jpg')].every((f) => fs.existsSync(f))) return prev.result;
  } catch { /* no usable cache: encode */ }

  const picked = opts.quality ? { quality: opts.quality, ...(await avifSsim(buf, MEASURE_WIDTH, opts.quality)) } : await pickQuality(buf, { target: opts.target });
  const avif = [], jpg = [];
  for (const w of widths) {
    const base = sharp(buf).removeAlpha().resize({ width: w, withoutEnlargement: true });
    const a = await base.clone().avif({ quality: picked.quality, effort: 4 }).toBuffer();
    const j = await base.clone().jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    fs.writeFileSync(path.join(outDir, `${name}-${w}.avif`), a);
    fs.writeFileSync(path.join(outDir, `${name}-${w}.jpg`), j);
    avif.push({ w, file: `${name}-${w}.avif`, bytes: a.length });
    jpg.push({ w, file: `${name}-${w}.jpg`, bytes: j.length });
  }
  const result = { stem: name, width: meta.width, height: meta.height, quality: picked.quality, ssim: Number(picked.ssim.toFixed(4)), widths, avif, jpg };
  fs.writeFileSync(sidecar, JSON.stringify({ key, result }));
  return result;
}

/**
 * The <picture> for a variant set. `original` is the full-size file the lightbox keeps; `sizes` tells the browser how
 * wide the slot renders. `eager` marks the first visible image: fetchpriority=high and no lazy loading.
 */
export function pictureHtml(v, { alt, sizes, eager = false, esc = (s) => s }) {
  const set = (list) => list.map((x) => `assets/${x.file} ${x.w}w`).join(', ');
  const mid = v.jpg.find((x) => x.w === 960) || v.jpg[v.jpg.length - 1];
  const loading = eager ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
  return `<picture><source type="image/avif" srcset="${set(v.avif)}" sizes="${esc(sizes)}">`
    + `<img src="assets/${mid.file}" srcset="${set(v.jpg)}" sizes="${esc(sizes)}" width="${v.width}" height="${v.height}" alt="${esc(alt)}" ${loading}></picture>`;
}
