# chalk — Human Primer

## 1. What is chalk

Chalk is an npm package for styling strings in the terminal. Its own tagline is "Terminal string styling done right." It is MIT-licensed, authored under the chalk GitHub organization (primary maintainer: Sindre Sorhus), and published as a pure ES module (`"type": "module"`).

---

## 2. What can it do for you

Chalk lets you apply colors, background colors, and text modifiers to strings you print to the terminal. Concretely:

- **Colors and backgrounds** — named colors, 256-color palette, and full Truecolor (16 million colors) via `chalk.hex()`, `chalk.rgb()`, and their `bg` variants.
- **Modifiers** — `bold`, `dim`, `italic`, `underline`, `overline`, `inverse`, `hidden`, `strikethrough`, and `visible`.
- **Chainable, composable API** — styles chain with dots: `chalk.blue.bgRed.bold('Hello world!')`.
- **Nesting** — styled segments can be nested inside each other: `chalk.red('Hello', chalk.underline.bgBlue('world'))`.
- **Automatic color detection** — Chalk detects what the terminal supports and downsamples automatically (e.g., a Truecolor hex value is reduced to the nearest ANSI code at lower levels).

---

## 3. What is it made of (the components)

The knowledge base identifies **two components**, both named `chalk`, with **42 public symbols** total. Internally the source is organized as:

- **`source/index.js`** — the main entry point, which wires together style application logic using three internal symbols (`GENERATOR`, `STYLER`, `IS_EMPTY`) and a `levelMapping` array that maps color-support levels to ANSI format names (`ansi`, `ansi256`, `ansi16m`).
- **`source/utilities.js`** — helper functions including `stringReplaceAll` and `stringEncaseCRLFWithFirstIndex`, used to handle edge cases in string processing.
- **Vendored dependencies** — `ansi-styles` and `supports-color` are bundled as vendors under `source/vendor/`, imported via package import maps (`#ansi-styles`, `#supports-color`). There are no declared external runtime dependencies in the package.

---

## 4. How it works

1. **Color level detection** — On load, Chalk reads `supportsColor.stdout` and `supportsColor.stderr` to determine the terminal's color capability (level 0–3).
2. **Level mapping** — The detected level is mapped to an ANSI format string: level 0 disables color, level 1 uses basic 16-color ANSI, level 2 uses 256-color ANSI, level 3 uses 16-million-color ANSI (Truecolor).
3. **Downsampling** — When you specify a color the terminal can't render at its current level (e.g., an RGB value on a level-1 terminal), Chalk automatically downsamples it to the closest supported ANSI code.
4. **Chainable proxy** — Each style property returns a new Chalk instance with the style queued, so chains like `.blue.bgRed.bold` accumulate styles before being applied to the string argument.
5. **CRLF safety** — The utility `stringEncaseCRLFWithFirstIndex` ensures that ANSI reset/re-apply sequences wrap correctly around carriage-return/line-feed characters, avoiding broken styling across line endings.

---

## 5. How do I install and use it

**Install:**

```bash
npm install chalk
```

**Basic usage:**

```js
import chalk from 'chalk';

console.log(chalk.blue('Hello world!'));
```

**Chaining styles:**

```js
console.log(chalk.blue.bgRed.bold('Hello world!'));
```

**Nesting:**

```js
console.log(chalk.red('Hello', chalk.underline.bgBlue('world')));
```

**256-color / Truecolor:**

```js
chalk.hex('#DEADED').underline('Hello, world!');
chalk.rgb(15, 100, 204).inverse('Hello!');
```

**Overriding color level (use a custom instance to avoid global side effects):**

```js
import {Chalk} from 'chalk';
const customChalk = new Chalk({level: 0}); // colors disabled
```

**Run tests or benchmarks:**

```bash
npm run test
npm run bench
```

---

## 6. Honest scope and limits

- **Terminal output only.** Chalk styles strings for ANSI-compatible terminals. It does not target browsers, HTML, or any other rendering surface directly.
- **Some modifiers are not widely supported.** The docs explicitly flag `italic`, `underline`, `overline`, and `strikethrough` as having limited terminal support.
- **Global level setting has side effects.** Setting `chalk.level` directly affects all Chalk consumers in the process. For library/module use, always create a `new Chalk({level})` instance instead.
- **ES module only.** The package is published as `"type": "module"` with `"main"` and `"exports"` both pointing to `./source/index.js`. CommonJS consumers need a compatibility layer.
- **No external runtime dependencies.** `ansi-styles` and `supports-color` are vendored in, so there is nothing extra to install — but it also means those vendored copies are not independently updated.
- **Tagged template literals require a companion package.** For template-literal syntax, the docs point to the separate `chalk-template` package; it is not built in.
- **Security issues** go through Tidelift, not GitHub issues directly.
