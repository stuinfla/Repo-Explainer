#!/usr/bin/env node
// check-site.mjs — run the pre-publish integrity checks on a site dir. `node tools/check-site.mjs <site-dir>`
// Prints PASS / WARN / FAIL lines; exits 1 only on a blocking failure. deploy.mjs runs the same checks.
import { checkSite, formatResults, blockingFailures } from '../src/site-check.mjs';
const dir = process.argv[2];
if (!dir) { console.error('usage: check-site.mjs <site-dir>'); process.exit(2); }
const r = checkSite(dir);
console.log(formatResults(r));
process.exit(blockingFailures(r).length ? 1 : 0);
