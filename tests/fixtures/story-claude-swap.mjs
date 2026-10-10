// Reference models: claude-swap (realiti4/claude-swap), from its README and src/claude_swap/autoswitch.py + settings.py, 2026-10-10.
// These are the two graphics the owner signed off as "the level and style I want", expressed as data.
export const SYSTEM_MAP = {
  title: 'What claude-swap plugs into',
  subtitle: 'Built from the README and source: one engine, three ways to drive it, and what it works with.',
  inputs: {
    label: 'YOUR ACCOUNTS',
    items: [
      { name: 'Account 1', sub: 'saved login, with its usage' },
      { name: 'Account 2', sub: 'saved login, with its usage' },
      { name: 'Account 3', sub: 'saved login, with its usage' },
    ],
    note: 'macOS: the Keychain\nWindows, Linux/WSL: files',
  },
  engine: {
    name: 'Auto-switch engine', sub: 'one engine, no screen of its own',
    steps: [
      { title: 'Poll usage', sub: '5h and 7d windows, every 60s' },
      { title: 'Decide', sub: '90% line, 10-pt margin, 5m cooldown' },
      { title: 'Swap', sub: 'refresh the token, hold a lock, switch' },
    ],
  },
  outputs: {
    label: 'THREE WAYS TO DRIVE IT', streamLabel: 'one event stream',
    items: [
      { name: 'Command line', cmd: 'cswap auto', sub: 'readable lines, or JSON for scripts' },
      { name: 'Terminal dashboard', cmd: 'cswap', sub: 'live usage bars for every account' },
      { name: 'Menu bar', cmd: 'cswap menubar', sub: 'macOS only, optional, click to switch' },
    ],
  },
  worksWith: {
    items: [
      { name: 'Claude Code CLI', status: 'yes', file: 'README.md', quote: 'Works with both the Claude Code CLI and the VS Code extension' },
      { name: 'VS Code extension', status: 'yes', file: 'README.md', quote: 'Works with both the Claude Code CLI and the VS Code extension' },
      { name: 'Codex', status: 'no', terms: ['codex'] },
    ],
    noNote: 'not mentioned anywhere in the README or source',
    runsOn: ['macOS', 'Windows', 'Linux / WSL'],
  },
};

export const DECISION = {
  title: 'The moment claude-swap switches you',
  subtitle: "Illustrative numbers. Each tank shows an account's busiest window (5h or 7d).",
  threshold: { value: 90, label: 'switch point' },
  qualify: { value: 83, label: 'to qualify' },
  candidates: [
    { name: 'work', value: 93, status: 'active', note: 'over the line' },
    { name: 'team', value: 85, status: 'skipped', note: 'not 10 pts better' },
    { name: 'personal', value: 34, status: 'picked', note: 'most headroom' },
    { name: 'side', value: 62, status: 'eligible', note: 'room, but less' },
  ],
  steps: [
    { title: 'Active account crosses 90%', sub: 'default threshold, busiest of 5h/7d' },
    { title: 'Needs 10 pts more room than work', sub: 'so near-equal accounts never flap' },
    { title: 'Pick the most headroom', sub: 'here: personal, 34% used' },
    { title: 'Swap before the old one runs dry', sub: 'a running Claude Code picks it up' },
  ],
  rule: { file: 'src/claude_swap/autoswitch.py', quote: 'if h - active_headroom < settings.hysteresis_pct:' },
  caption: "Before the swap it refreshes the pick's token if that expires within 10 minutes, then switches while holding a lock.",
};

