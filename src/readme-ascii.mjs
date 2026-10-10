// src/readme-ascii.mjs — pure helpers for the readme-enhance station.
//
// JOB: take an owner's README and return a copy that is IDENTICAL to the original plus additions:
//   1. an explainer link/badge right under the first H1;
//   2. every ASCII diagram in a fenced block gets a faithful animated-SVG twin inserted just above it
//      (the original fenced block is left untouched — we add, we never rewrite their words);
//   3. FALLBACK: only when the README has no ASCII diagram, the explainer's own generated
//      architecture + flow SVGs are appended as one delimited block (the pre-0.9.3 behaviour).
//
// The conversion is LOSSLESS by construction: it draws the character grid (box-drawing characters as
// vector strokes, everything else as text pinned to its column). It never "interprets" or invents
// structure, so it cannot misrepresent the owner's diagram. Re-running is idempotent: all of our
// insertions are stripped first, then re-applied to the pristine README.
//
// No I/O here — the station owns the filesystem, git and gh.

const LINK_START = '<!-- explainmyrepo:link:start -->';
const LINK_END = '<!-- explainmyrepo:link:end -->';
const BLOCK_START = '<!-- explainmyrepo:start -->';
const BLOCK_END = '<!-- explainmyrepo:end -->';
const IMG_MARK = (n) => `<!-- explainmyrepo:ascii-${n} -->`;

const MAX_COLS = 120;
const MAX_ROWS = 60;
const TEXT_LANGS = new Set(['', 'text', 'txt', 'ascii', 'plain', 'plaintext', 'diagram', 'art']);

// Box-drawing characters → which cell edges they connect to (l, r, u, d).
const BOX = {};
const def = (chars, c) => { for (const ch of chars) BOX[ch] = c; };
def('─━═', { l: 1, r: 1 });
def('│┃║', { u: 1, d: 1 });
def('┌┏╔╭', { r: 1, d: 1 });
def('┐┓╗╮', { l: 1, d: 1 });
def('└┗╚╰', { r: 1, u: 1 });
def('┘┛╝╯', { l: 1, u: 1 });
def('├┣╠', { r: 1, u: 1, d: 1 });
def('┤┫╣', { l: 1, u: 1, d: 1 });
def('┬┳╦', { l: 1, r: 1, d: 1 });
def('┴┻╩', { l: 1, r: 1, u: 1 });
def('┼╋╬', { l: 1, r: 1, u: 1, d: 1 });

const GLYPH_ARROWS = /[▶▼▲◀→↓←↑►◄]/;
const ASCII_ARROW = /(-->|<--|->|<-|=>|<=)/;
const TREE_LINE = /^[\s│|]*[├└]──\s/;

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── detection ─────────────────────────────────────────────────────────────────────────────────────
/** Find fenced blocks in `md`. Returns [{ open, close, lang, body }] with line indexes of the fences. */
export function findFences(md) {
  const lines = md.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*$/.exec(lines[i]);
    if (!m) continue;
    const fence = m[1];
    let j = i + 1;
    while (j < lines.length) {
      const c = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[j]);
      if (c && c[1][0] === fence[0] && c[1].length >= fence.length) break;
      j++;
    }
    if (j >= lines.length) break; // unterminated fence: leave the rest alone
    out.push({ open: i, close: j, lang: m[2].toLowerCase(), body: lines.slice(i + 1, j).join('\n') });
    i = j;
  }
  return out;
}

/** True when a fenced block is a drawn diagram (boxes/arrows), not code, a tree listing or a shell session. */
export function isAsciiDiagram(lang, body) {
  if (!TEXT_LANGS.has(lang)) return false;
  const lines = body.replace(/\t/g, '    ').split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 3 || lines.length > MAX_ROWS) return false;
  if (Math.max(...lines.map((l) => l.length)) > MAX_COLS) return false;
  const shell = lines.filter((l) => /^\s*[$>#]\s/.test(l)).length;
  if (shell / lines.length > 0.3) return false;
  const tree = lines.filter((l) => TREE_LINE.test(l)).length;
  if (tree / lines.length > 0.4) return false;
  const boxLines = lines.filter((l) => /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╭╮╰╯]/.test(l) || /\+-{2,}\+/.test(l)).length;
  const arrows = lines.reduce((n, l) => n + (l.match(new RegExp(ASCII_ARROW.source + '|' + GLYPH_ARROWS.source, 'g')) || []).length, 0);
  return boxLines >= 2 || arrows >= 2;
}

/** Fenced blocks in `md` that are ASCII diagrams, top to bottom. */
export function findAsciiDiagrams(md) {
  return findFences(md).filter((f) => isAsciiDiagram(f.lang, f.body));
}

// ── ASCII → SVG ───────────────────────────────────────────────────────────────────────────────────
const CELL_W = 9;
const CELL_H = 19;
const PAD = 14;

/** Render a character grid as an accessible, animated SVG. Lossless: text stays text, lines stay lines. */
export function asciiToSvg(text, { title = 'Diagram', desc } = {}) {
  const rows = text.replace(/\t/g, '    ').replace(/\s+$/, '').split('\n');
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const g = rows.map((r) => r.padEnd(cols, ' ').split(''));
  const at = (r, c) => (g[r] && g[r][c]) || ' ';

  const isHBar = (ch) => ch === '-' || ch === '=' || (BOX[ch] && BOX[ch].l && BOX[ch].r && !BOX[ch].u && !BOX[ch].d);
  const isVBar = (ch) => ch === '|' || (BOX[ch] && BOX[ch].u && BOX[ch].d && !BOX[ch].l && !BOX[ch].r);
  const hJoin = (ch) => isHBar(ch) || ch === '+' || (BOX[ch] && (BOX[ch].l || BOX[ch].r));
  const vJoin = (ch) => isVBar(ch) || ch === '+' || (BOX[ch] && (BOX[ch].u || BOX[ch].d));

  // conn[r][c] = {l,r,u,d} for cells drawn as strokes; null for text cells.
  const conn = g.map((row, r) => row.map((ch, c) => {
    if (BOX[ch]) return { l: 0, r: 0, u: 0, d: 0, ...BOX[ch] };
    if (ch === '+') {
      const k = {
        l: hJoin(at(r, c - 1)) ? 1 : 0, r: hJoin(at(r, c + 1)) ? 1 : 0,
        u: vJoin(at(r - 1, c)) ? 1 : 0, d: vJoin(at(r + 1, c)) ? 1 : 0,
      };
      return k.l + k.r + k.u + k.d >= 2 ? k : null;
    }
    if (ch === '-' || ch === '=') {
      return (hJoin(at(r, c - 1)) || hJoin(at(r, c + 1))) && (at(r, c - 1) !== ' ' || at(r, c + 1) !== ' ')
        && (isHBar(at(r, c - 1)) || isHBar(at(r, c + 1)) || at(r, c - 1) === '+' || at(r, c + 1) === '+' || BOX[at(r, c - 1)] || BOX[at(r, c + 1)])
        ? { l: 1, r: 1, u: 0, d: 0 } : null;
    }
    if (ch === '|') {
      return vJoin(at(r - 1, c)) || vJoin(at(r + 1, c)) ? { l: 0, r: 0, u: 1, d: 1 } : null;
    }
    return null;
  }));
  const stroke = (r, c) => Boolean(conn[r] && conn[r][c]);

  // Arrowheads: > < v ^ sitting at the end of a drawn stroke.
  const arrow = new Map(); // "r,c" → 'r'|'l'|'d'|'u'
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = g[r][c];
      if (stroke(r, c)) continue;
      if (ch === '>' && stroke(r, c - 1) && isHBar(at(r, c - 1))) arrow.set(`${r},${c}`, 'r');
      else if (ch === '<' && stroke(r, c + 1) && isHBar(at(r, c + 1))) arrow.set(`${r},${c}`, 'l');
      else if ((ch === 'v' || ch === 'V') && stroke(r - 1, c) && isVBar(at(r - 1, c))) arrow.set(`${r},${c}`, 'd');
      else if (ch === '^' && stroke(r + 1, c) && isVBar(at(r + 1, c))) arrow.set(`${r},${c}`, 'u');
      else if ('▶►'.includes(ch)) arrow.set(`${r},${c}`, 'r');
      else if ('◀◄'.includes(ch)) arrow.set(`${r},${c}`, 'l');
      else if (ch === '▼') arrow.set(`${r},${c}`, 'd');
      else if (ch === '▲') arrow.set(`${r},${c}`, 'u');
    }
  }

  const cx = (c) => PAD + (c + 0.5) * CELL_W;
  const cy = (r) => PAD + (r + 0.5) * CELL_H;
  const fmt = (n) => Number(n.toFixed(1));

  // Strokes: half-cell segments from each cell's centre to its connected edges (they meet seamlessly).
  const d = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      const k = conn[r][c];
      if (!k) continue;
      const x = cx(c), y = cy(r);
      if (k.l) d.push(`M${fmt(x - CELL_W / 2)} ${fmt(y)}H${fmt(x)}`);
      if (k.r) d.push(`M${fmt(x)} ${fmt(y)}H${fmt(x + CELL_W / 2)}`);
      if (k.u) d.push(`M${fmt(x)} ${fmt(y - CELL_H / 2)}V${fmt(y)}`);
      if (k.d) d.push(`M${fmt(x)} ${fmt(y)}V${fmt(y + CELL_H / 2)}`);
    }
  }

  // Animated "flow" strokes: the straight run that feeds each arrowhead.
  const flow = [];
  for (const [key, dir] of arrow) {
    const [r0, c0] = key.split(',').map(Number);
    const step = { r: [0, -1], l: [0, 1], d: [-1, 0], u: [1, 0] }[dir];
    let r = r0 + step[0], c = c0 + step[1], n = 0;
    while (stroke(r, c) && conn[r][c] && (dir === 'r' || dir === 'l' ? isHBar(at(r, c)) : isVBar(at(r, c)))) {
      n++; r += step[0]; c += step[1];
    }
    if (n >= 2) {
      const x1 = cx(c0 + step[1]), y1 = cy(r0 + step[0]);
      const x2 = cx(c0 + step[1] * n), y2 = cy(r0 + step[0] * n);
      flow.push(`M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`);
    }
  }

  const heads = [];
  for (const [key, dir] of arrow) {
    const [r, c] = key.split(',').map(Number);
    const x = cx(c), y = cy(r), a = 5.5, b = 4;
    const pts = {
      r: [[x + a, y], [x - a, y - b], [x - a, y + b]],
      l: [[x - a, y], [x + a, y - b], [x + a, y + b]],
      d: [[x, y + a + 2], [x - b, y - a + 2], [x + b, y - a + 2]],
      u: [[x, y - a - 2], [x - b, y + a - 2], [x + b, y + a - 2]],
    }[dir];
    heads.push(`<polygon class="head" points="${pts.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ')}"/>`);
  }

  // Text: runs of non-stroke, non-arrow cells; a gap of 2+ spaces ends a run.
  const texts = [];
  for (let r = 0; r < rows.length; r++) {
    let c = 0;
    while (c < cols) {
      const skip = () => g[r][c] === ' ' || stroke(r, c) || arrow.has(`${r},${c}`);
      if (skip()) { c++; continue; }
      let end = c, buf = '';
      for (let k = c; k < cols; k++) {
        if (stroke(r, k) || arrow.has(`${r},${k}`)) break;
        if (g[r][k] === ' ' && (k + 1 >= cols || g[r][k + 1] === ' ' || stroke(r, k + 1) || arrow.has(`${r},${k + 1}`))) break;
        buf += g[r][k]; end = k;
      }
      texts.push(
        `<text x="${fmt(PAD + c * CELL_W)}" y="${fmt(PAD + r * CELL_H + CELL_H * 0.72)}" textLength="${fmt(buf.length * CELL_W)}" lengthAdjust="spacing">${xmlEscape(buf)}</text>`,
      );
      c = end + 1;
    }
  }

  const W = fmt(PAD * 2 + cols * CELL_W);
  const H = fmt(PAD * 2 + rows.length * CELL_H);
  const label = desc || rows.map((r) => r.trim()).filter(Boolean).join(' / ');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`,
    `<title id="t">${xmlEscape(title)}</title>`,
    `<desc id="d">${xmlEscape(label)}</desc>`,
    '<style>',
    '  :root { --fg: #1f2328; --accent: #0969da; }',
    '  @media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --accent: #58a6ff; } }',
    '  .line { stroke: var(--fg); stroke-width: 1.6; stroke-linecap: round; fill: none; }',
    '  .flow { stroke: var(--accent); stroke-width: 2.2; stroke-linecap: round; stroke-dasharray: 6 9; fill: none; animation: emr-flow 1.2s linear infinite; }',
    '  .head { fill: var(--accent); animation: emr-pulse 2s ease-in-out infinite; }',
    '  text { fill: var(--fg); font: 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }',
    '  @keyframes emr-flow { to { stroke-dashoffset: -30; } }',
    '  @keyframes emr-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }',
    '  @media (prefers-reduced-motion: reduce) { .flow, .head { animation: none; } }',
    '</style>',
    d.length ? `<path class="line" d="${d.join('')}"/>` : '',
    flow.length ? `<path class="flow" d="${flow.join('')}"/>` : '',
    ...heads,
    ...texts,
    '</svg>',
    '',
  ].filter((l) => l !== '').join('\n');
  return { svg, cols, rows: rows.length };
}

// ── README rewrite ────────────────────────────────────────────────────────────────────────────────
/** Remove everything this tool previously inserted, returning the owner's pristine README. */
export function stripEnhancements(md) {
  return md
    .replace(new RegExp(`${LINK_START}[\\s\\S]*?${LINK_END}\\n*`, 'g'), '')
    .replace(new RegExp(`${BLOCK_START}[\\s\\S]*?${BLOCK_END}\\n?`, 'g'), '')
    .replace(/<!-- explainmyrepo:ascii-\d+ -->\n!\[[^\n]*\]\([^)\n]*\)\n\n?/g, '')
    .replace(/\s*$/, '\n');
}

function diagramAlt(body, n) {
  const words = body.split('\n').map((l) => l.replace(/[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╭╮╰╯+|=<>\-▶▼▲◀→↓←↑►◄]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const text = words.join(', ').slice(0, 160);
  return text ? `Diagram ${n}: ${text}` : `Diagram ${n} from the README`;
}

/**
 * @param {string} md            the owner's README as found (may already carry our insertions)
 * @param {object} o
 * @param {string} o.liveUrl     the live explainer URL
 * @param {string} o.repoName
 * @param {string} o.svgDir      repo-relative dir the SVG files will be written to (e.g. docs/explainer)
 * @param {{svgPath:string,alt:string,rel:string}[]} [o.fallback]  generated diagrams used ONLY when no ASCII diagram exists
 * @returns {{ markdown:string, diagrams:{file:string,svg:string,alt:string}[], mode:'ascii'|'fallback'|'link-only' }}
 */
export function rewriteReadme(md, { liveUrl, repoName, svgDir, fallback = [] }) {
  const clean = stripEnhancements(md);
  const base = clean.trim() === '' ? `# ${repoName}\n` : clean;
  const lines = base.split('\n');

  // 1. in-place SVGs (bottom-up so indexes stay valid), numbered top-down.
  const found = findAsciiDiagrams(base);
  const diagrams = [];
  found.forEach((f, i) => {
    const n = i + 1;
    const alt = diagramAlt(f.body, n);
    const file = `diagram-${n}.svg`;
    diagrams.push({ file, alt, svg: asciiToSvg(f.body, { title: alt }).svg });
  });
  for (let i = found.length - 1; i >= 0; i--) {
    const f = found[i];
    const { file, alt } = diagrams[i];
    lines.splice(f.open, 0, IMG_MARK(i + 1), `![${alt.replace(/[\[\]\r\n]+/g, ' ')}](${svgDir}/${file})`, '');
  }

  // 2. explainer link under the first H1 (outside fences), else at the very top.
  const fences = findFences(base);
  const inFence = (idx) => fences.some((f) => idx >= f.open && idx <= f.close);
  const shift = (idx) => idx + found.filter((f) => f.open <= idx).length * 3;
  // H1 position is found on the PRE-insertion lines so inserted image lines cannot skew the fence test.
  const h1 = base.split('\n').findIndex((l, idx) => /^#\s+\S/.test(l) && !inFence(idx));
  const link = [
    LINK_START,
    `[![Explainer — live](https://img.shields.io/badge/Explainer-live-7c3aed?style=flat-square)](${liveUrl})`,
    '',
    `A visual, newcomer-friendly explainer for **${repoName}**: ${liveUrl}`,
    LINK_END,
    '',
  ];
  if (h1 >= 0) lines.splice(shift(h1) + 1, 0, '', ...link);
  else lines.unshift(...link);

  let markdown = lines.join('\n');

  // 3. fallback: generated architecture + flow, only when there was nothing to convert.
  let mode = 'link-only';
  if (found.length > 0) mode = 'ascii';
  else if (fallback.length > 0) {
    mode = 'fallback';
    const block = [BLOCK_START, '## Explainer', ''];
    fallback.forEach((f, i) => {
      block.push(i === 0 ? '### Architecture' : '### How it works', '', f.alt, '', `![${f.alt.replace(/[\r\n]+/g, ' ')}](${f.rel})`, '');
    });
    block.push(BLOCK_END, '');
    // Place right after the intro paragraph (first prose line below the link block) so the graphics are
    // seen first; fall back to the end when the README has no recognisable intro.
    const ml = markdown.split('\n');
    const linkEnd = ml.indexOf(LINK_END);
    let p = -1;
    if (linkEnd >= 0) {
      for (let i = linkEnd + 1; i < ml.length; i++) {
        if (ml[i].trim() === '') continue;
        if (!/^(#|<|```|~~~|\||[-*]\s)/.test(ml[i])) p = i;
        break;
      }
    }
    if (p >= 0) {
      ml.splice(p + 1, 0, '', ...block.slice(0, -1));
      markdown = ml.join('\n');
    } else {
      markdown = `${markdown.replace(/\s*$/, '')}\n\n${block.join('\n')}`;
    }
  }
  return { markdown: markdown.replace(/\s*$/, '\n'), diagrams, mode };
}
