// overview-clean.mjs — remove NotebookLM's "Gemini Notebook" branding from the overview media before it ships.
// Local only: nothing is uploaded anywhere. The infographic gets a patch of its own smooth background over the mark;
// the video gets ffmpeg `delogo` on every frame and loses its trailing splash card. Mark positions are fractions of
// the frame, measured on 2752x1536 infographics and 1280x720 video.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

export const INFOGRAPHIC_MARK = { x: 0.915, y: 0.972, w: 0.085, h: 0.028 };
export const VIDEO_MARK = { x: 0.895, y: 0.964, w: 0.102, h: 0.029 };
const FLAT_STDEV = 14;   // the strip copied over the mark must be near-flat, or we would paste content over content

/** Pixel box of a fractional mark inside a W x H frame, clamped inside it. */
export function markBox(mark, W, H) {
  const x = Math.round(mark.x * W), y = Math.round(mark.y * H);
  return { x, y, w: Math.min(Math.round(mark.w * W), W - 1 - x), h: Math.min(Math.round(mark.h * H), H - 1 - y) };
}

/** Infographic: paint the area above the mark (same width) over it, feathered. Returns {cleaned, reason?}. */
export async function cleanInfographic(inPng, outPng) {
  const img = sharp(inPng), { width: W, height: H } = await img.metadata();
  const b = markBox(INFOGRAPHIC_MARK, W, H);
  const srcTop = b.y - b.h - 4;
  if (srcTop < 0) { await img.toFile(outPng); return { cleaned: false, reason: 'frame too small' }; }
  const strip = await sharp(inPng).extract({ left: b.x, top: srcTop, width: b.w, height: b.h }).toBuffer();
  const { channels } = await sharp(strip).stats();
  const spread = Math.max(...channels.slice(0, 3).map((c) => c.stdev));
  if (spread > FLAT_STDEV) { await img.toFile(outPng); return { cleaned: false, reason: `background above the mark is not flat (stdev ${spread.toFixed(1)})` }; }
  const mask = await sharp({ create: { width: b.w, height: b.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg width="${b.w}" height="${b.h}"><rect x="6" y="3" width="${b.w - 12}" height="${b.h - 6}" rx="6" fill="#fff"/></svg>`) }]).blur(3).png().toBuffer();
  const feathered = await sharp(strip).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  await sharp(inPng).composite([{ input: feathered, left: b.x, top: b.y }]).png().toFile(outPng);
  return { cleaned: true };
}

/**
 * Where the trailing splash card starts, from a run of equally spaced frame samples ({mean, std} of a small gray
 * frame, 0-255). The card is bright and flat; it counts only if it runs unbroken to the end. Returns an index or -1.
 */
export function endCardIndex(frames) {
  let i = frames.length;
  while (i > 0 && frames[i - 1].mean >= 240 && frames[i - 1].std <= 12) i--;
  return i === frames.length ? -1 : i;
}

function probe(mp4) {
  const o = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', mp4], { encoding: 'utf8' });
  const j = JSON.parse(o);
  return { W: j.streams[0].width, H: j.streams[0].height, dur: parseFloat(j.format.duration) };
}

/** Seconds at which to cut the video so the splash card never shows; the full duration when there is none. */
export function contentEnd(mp4, dur, { tail = 8, fps = 12 } = {}) {
  const from = Math.max(0, dur - tail);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-i', mp4, '-vf', `fps=${fps},scale=32:18,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const n = Math.floor(raw.length / 576), frames = [];
  for (let f = 0; f < n; f++) {
    let s = 0, q = 0;
    for (let p = 0; p < 576; p++) { const v = raw[f * 576 + p]; s += v; q += v * v; }
    const mean = s / 576;
    frames.push({ mean, std: Math.sqrt(Math.max(0, q / 576 - mean * mean)) });
  }
  const i = endCardIndex(frames);
  return i < 0 ? dur : Math.max(0, from + i / fps - 1 / fps);
}

/** Video: delogo every frame, cut the splash card, fade the audio tail. Returns {cleaned, durationSec}. */
export function cleanVideo(inMp4, outMp4) {
  const { W, H, dur } = probe(inMp4);
  const b = markBox(VIDEO_MARK, W, H), end = contentEnd(inMp4, dur);
  const args = ['-v', 'error', '-y', '-i', inMp4, '-vf', `delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}`, '-t', end.toFixed(3),
    '-af', `afade=t=out:st=${Math.max(0, end - 0.25).toFixed(3)}:d=0.25`, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outMp4];
  execFileSync('ffmpeg', args, { stdio: 'pipe' });
  return { cleaned: true, durationSec: probe(outMp4).dur, trimmedSec: +(dur - end).toFixed(2) };
}
