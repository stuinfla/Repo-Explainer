# chalk — orientation primer

## What it is
`chalk` is a small, zero-dependency JavaScript library (Node.js, ESM) that colors and styles
terminal text. `chalk.red('Error!')` returns a string wrapped in ANSI escape codes — the
invisible on/off switches a terminal reads to turn color on before the text and back off after
it. It has no runtime dependencies, is used by roughly 115,000 npm packages, and its current
major version is 5.6.2 (source/index.js + two small vendored helpers: ansi-styles and
supports-color).

## The core concept
Every style (`.red`, `.bold`, `.bgBlue`, `.hex('#fff')`, `.rgb(1,2,3)`) is a lazily-evaluated
getter on a chainable proxy-like function object. Accessing `chalk.red` builds a "styler" — a
tiny record of `{ open, close, parent }` ANSI codes — and links it to whatever styler came
before it in the chain (`chalk.blue.bold` → bold's styler points at blue's). Calling the final
result with a string applies `openAll + string + closeAll`, where `openAll`/`closeAll` are the
full accumulated chain of codes from every parent styler.

## The clever move (why nesting doesn't break)
If you write raw ANSI by hand and nest a highlighted word inside a colored sentence, the inner
word's "reset" code doesn't just end the inner style — a real terminal reads it as "reset
EVERYTHING," so the rest of the outer sentence goes back to plain default color too. chalk's
`applyStyle` (source/index.js) checks whether the string being wrapped already contains escape
codes (i.e. it has a nested chalk call inside it). If so, it walks up the parent chain and
replaces every occurrence of that parent's `close` code already present in the string with that
parent's `open` code instead — so the moment the nested style ends, the outer style is
re-asserted rather than left reset. That single repair (`stringReplaceAll`, source/utilities.js)
is the entire trick; there is no stack machine or state you manage yourself.

## Color-support detection
`supports-color` (vendored, source/source/vendor/supports-color) sniffs environment variables
(`TERM`, `COLORTERM`, CI flags, `FORCE_COLOR`) and stream TTY-ness to decide a `level` 0–3: 0 =
no color, 1 = 16 colors (ansi), 2 = 256 colors, 3 = 16 million colors (truecolor). `chalk.level`
picks the right ANSI code family (`ansiStyles.color[name].ansi / ansi256 / ansi16m`) automatically
so the same `chalk.hex('#DEADED')` call degrades gracefully on an old terminal instead of printing
garbage codes.

## Maturity & scope
Actively maintained by Sindre Sorhus + community; MIT licensed; no runtime dependencies; ships
TypeScript types; test suite via `xo` (lint) + `ava` (tests) + `tsd` (type tests); a `matcha`
micro-benchmark (`benchmark.js`). Chalk 5 is ESM-only — CommonJS/TypeScript-bundler users are
pointed at Chalk 4.

## How to use it end-to-end
```sh
npm install chalk
```
```js
import chalk from 'chalk';
console.log(chalk.blue('Hello world!'));
console.log(chalk.green('All systems ' + chalk.blue.bold('nominal') + ' — still green.'));
```
Chain styles in any order (`chalk.red.bold.underline(...)`), nest them freely, or use
`chalk.hex()` / `chalk.rgb()` for exact colors. `chalk.level` can be forced per-instance via
`new Chalk({level: 0-3})` for library authors who must not mutate the global default.

## Where the docs are
`readme.md` (usage, full API, style list, FAQ) · `source/index.d.ts` (types) ·
`examples/` (rainbow.js, screenshot.js) · `source/vendor/ansi-styles` and
`source/vendor/supports-color` (the two small internal helpers, vendored to keep dependency
count at zero).
