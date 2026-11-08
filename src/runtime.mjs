// src/runtime.mjs — the few constants every orchestrator module shares: the package root, ANSI colours,
// and the stderr logger. No logic lives here.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' };
export const log = (s = '') => process.stderr.write(s + '\n');
export const step = (n, total, label, kind) => log(`\n${C.bold}${C.cyan}[${n}/${total}] ${label}${C.reset} ${C.dim}(${kind})${C.reset}`);
