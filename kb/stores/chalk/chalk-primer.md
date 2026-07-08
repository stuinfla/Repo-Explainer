# chalk Primer

## 1. What is chalk?

chalk is a Node.js library for styling terminal output — adding colors, bold text, underlines, and other formatting to strings you print to the console. Instead of memorizing obscure ANSI escape sequences (raw byte strings that terminals interpret as "turn on red" or "make bold"), chalk gives you a clean, chainable JavaScript API: chalk.red.bold("error!").

It is used by over 115,000 npm packages as of July 2024. Tools you already depend on — ESLint, Jest, create-react-app, Vite, and thousands of CLI tools — rely on chalk to make their output readable and human-friendly.

## 2. What can chalk do for you?

- Named colors: chalk.red(), chalk.blue(), chalk.green() — 16 standard foreground and background colors
- 256-color mode: chalk.ansi256(194)() — for terminals supporting the extended 256-color palette
- Truecolor (16 million colors): chalk.hex("#DEADED")() and chalk.rgb(123, 45, 67)() — any CSS hex or RGB value
- Text modifiers: bold, italic, underline, strikethrough, dim, inverse, hidden, visible
- Style chaining: combine any styles — chalk.bold.red.bgWhite("text")
- Style nesting: nest chalk calls inside each other — chalk.red("Hello", chalk.blue.underline("world"))
- Theme creation: save chalk.bold.red to a variable and reuse it as const error = chalk.bold.red
- Auto-detection: automatically detects the terminal color capability level and degrades gracefully
- Separate stderr instance: chalkStderr configured for the stderr stream

## 3. What is chalk made of?

chalk v5 is a focused, zero-runtime-dependency ESM package. Its source is in source/:

- source/index.js — the core: Chalk class, chalkFactory, createBuilder, createStyler, and applyStyle (~200 lines)
- source/utilities.js — two helpers: stringReplaceAll and stringEncaseCRLFWithFirstIndex
- source/vendor/ansi-styles/ — vendored copy providing every ANSI open/close escape code pair for each style name
- source/vendor/supports-color/ — vendored copy detecting the terminal color level (0-3) via environment signals

## 4. How the chainable API works step by step

chalk uses a lazy prototype chain. Here is the mental model:

Step 1 — Creating the chalk object: chalk (the default export) is a function whose prototype is createChalk.prototype, which has all 60+ styles defined as lazy getter properties.

Step 2 — Accessing a style: Writing chalk.blue fires a getter that calls createBuilder(this, createStyler(blueOpen, blueClose, this[STYLER]), this[IS_EMPTY]). This creates a new builder function whose prototype is also createChalk.prototype (so it has all style getters too), plus three private symbols carrying the generator, styler chain, and isEmpty flag.

Step 3 — Chaining more styles: Each additional .bold or .underline on the builder fires another getter, creating another builder with a new styler node whose parent is the previous styler. openAll accumulates all open codes; closeAll accumulates close codes in reverse.

Step 4 — Calling the builder: chalk.blue.bold("Hello") calls applyStyle(builder, "Hello"), which: checks level (returns unstyled if 0), handles nested ANSI codes (replaces close sequences with close+open to ensure nested styles resume correctly), applies the macOS line-break fix (closes before each newline and reopens after), then returns openAll + string + closeAll.

Color model downsampling: When you call chalk.hex("#FF0000") on a terminal supporting only 16 colors, chalk automatically downsamples the hex value to the nearest 16-color ANSI code.

## 5. Is it production-ready?

chalk v5.6.2 is extremely mature — among the most downloaded npm packages in the world (billions of downloads). Its scope is intentionally narrow: styling strings for terminal output only.

It does NOT style HTML, parse/strip ANSI codes, animate text, or act as a logger.

Important: chalk v5 is ESM-only (import, not require). Use chalk v4 for CommonJS projects.

## 6. Where do I read more?

- README (readme.md) — all style names, API, color levels, 256/Truecolor details, browser support, FAQ
- Source (source/index.js) — the full implementation, short and readable
- Tests (test/) — Ava test suite showing expected behavior and edge cases

## 7. How do I install and use it end-to-end?

Install: npm install chalk

Requires Node.js 12.17+, 14.13+, or 16+. For CommonJS: npm install chalk@4

Basic usage:
import chalk from "chalk";
console.log(chalk.blue("Hello world!"));

Chain styles:
console.log(chalk.bold.red.bgWhite("Error!"));

Create reusable themes:
const error = chalk.bold.red;
const warning = chalk.hex("#FFA500");
console.log(error("Something failed"));
console.log(warning("Check this"));

Truecolor:
console.log(chalk.rgb(123, 45, 67).underline("Reddish color"));
console.log(chalk.hex("#DEADED").bold("Gray-lavender"));

Force disable for CI: FORCE_COLOR=0 node yourscript.js

What you see: styled text appears immediately in the console. No build step, no config file. If the terminal does not support colors (like when piped to a file), chalk automatically falls back to unstyled text.
