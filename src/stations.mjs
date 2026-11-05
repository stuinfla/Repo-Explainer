// src/stations.mjs — THE station table. The orchestrator, `--help`, `--from/--to/--only` validation and
// the tests all read this one list; nothing else enumerates stations.
//
//   id     the name used by --from/--to/--only and in logs (unique)
//   tool   tools/<tool>.mjs spawned for the station, or null when the station runs in-process
//   kind   'tool' (deterministic) | 'brain' (a Claude call authors a build.json slot)
//   fatal  true: a failure stops the build. false: warn and continue.
//   doors  which doors run it: 'local' (the CLI orchestrator), 'hosted' (agent + runner)
//   entry  optional: a script outside tools/ that the station runs in-process (kb/index-primer.mjs)
//   hostedRef  optional: the name the hosted SKILL/runner uses for it when that is not `tool` (drift test)
//   phase  'pre' setup · 'agent' build + grade · 'ship' delivery · 'post-ship' follow-ups after delivery
//
// Order is execution order on the local door.

import path from 'node:path';

export const STATIONS = [
  { id: 'clone-repo',       tool: 'clone-repo',       kind: 'tool',  fatal: true,  doors: ['local', 'hosted'], phase: 'pre' },
  { id: 'kb:register',      tool: null,               kind: 'brain', fatal: true,  doors: ['local', 'hosted'], hostedRef: 'kb/kb.config.mjs', phase: 'pre' },
  { id: 'build-kb',         tool: 'build-kb',         kind: 'tool',  fatal: true,  doors: ['local', 'hosted'], phase: 'pre' },
  // Tournament first (hosted runs it before the agent): 2+ models draft a concept as text, a judge picks one.
  // Fails open: when it skips, the single-shot `concept` station below authors the concept instead.
  { id: 'concept-tournament', tool: 'concept-tournament', kind: 'tool', fatal: false, doors: ['local', 'hosted'], phase: 'pre' },
  { id: 'primer',           tool: null,               kind: 'brain', fatal: true,  doors: ['local', 'hosted'], phase: 'agent' },
  { id: 'index-primer',     tool: null, entry: 'kb/index-primer.mjs', kind: 'tool', fatal: true, doors: ['local', 'hosted'], phase: 'agent' },   // the orientation layer must be in the KB before anything asks it
  { id: 'concept',          tool: null,               kind: 'brain', fatal: true,  doors: ['local', 'hosted'], phase: 'agent' },   // local fallback / hosted agent judgment
  { id: 'content',          tool: null,               kind: 'brain', fatal: true,  doors: ['local', 'hosted'], phase: 'agent' },
  { id: 'check-claims',     tool: 'check-claims',     kind: 'tool',  fatal: false, doors: ['local', 'hosted'], phase: 'agent' },   // advisory; writes the `claims` slot
  { id: 'visual-brief',     tool: null,               kind: 'brain', fatal: true,  doors: ['local', 'hosted'], hostedRef: 'visuals.hero', phase: 'agent' },
  { id: 'generate-image',   tool: 'generate-image',   kind: 'tool',  fatal: true,  doors: ['local', 'hosted'], phase: 'agent' },
  { id: 'make-favicon',     tool: 'make-favicon',     kind: 'tool',  fatal: true,  doors: ['local', 'hosted'], phase: 'agent' },
  { id: 'make-social-card', tool: 'make-social-card', kind: 'tool',  fatal: true,  doors: ['local', 'hosted'], phase: 'agent' },
  { id: 'make-diagrams',    tool: 'make-diagrams',    kind: 'tool',  fatal: true,  doors: ['local', 'hosted'], phase: 'agent' },
  { id: 'assemble-page',    tool: 'assemble-page',    kind: 'tool',  fatal: true,  doors: ['local', 'hosted'], phase: 'agent' },
  { id: 'make-pack',        tool: 'make-pack',        kind: 'tool',  fatal: true,  doors: ['local', 'hosted'], phase: 'agent' },
  { id: 'make-ask',         tool: 'make-ask',         kind: 'tool',  fatal: false, doors: ['local'],           phase: 'agent' },   // the Ask box is local-door only for now
  { id: 'quality-grade',    tool: 'quality-grade',    kind: 'tool',  fatal: true,  doors: ['local', 'hosted'], phase: 'agent' },
  { id: 'deploy',           tool: 'deploy',           kind: 'tool',  fatal: true,  doors: ['local', 'hosted'], phase: 'ship' },
  { id: 'publish-repo',     tool: 'publish-repo',     kind: 'tool',  fatal: true,  doors: ['local'],           phase: 'ship' },
  { id: 'repo-seo',         tool: 'repo-seo',         kind: 'tool',  fatal: true,  doors: ['local'],           phase: 'ship' },
  { id: 'readme-enhance',   tool: 'readme-enhance',   kind: 'tool',  fatal: false, doors: ['local'],           phase: 'ship' },
  { id: 'notify',           tool: 'notify',           kind: 'tool',  fatal: false, doors: ['local', 'hosted'], phase: 'ship' },
  // Follow-ups: the NotebookLM video + infographic take minutes, so they run after delivery and the page is
  // re-deployed with them. Outreach (readme-enhance) does not wait for them.
  { id: 'make-overview',    tool: 'make-overview',    kind: 'tool',  fatal: false, doors: ['local'],           phase: 'post-ship' },
  { id: 'redeploy',         tool: 'deploy',           kind: 'tool',  fatal: false, doors: ['local'],           phase: 'post-ship' },
  { id: 'republish',        tool: 'publish-repo',     kind: 'tool',  fatal: false, doors: ['local'],           phase: 'post-ship' },
];

// Which --no-* option removes which stations.
export const SKIP_FLAGS = {
  noQuality: ['quality-grade'],
  noDeploy: ['deploy', 'redeploy'],
  noPublish: ['publish-repo', 'repo-seo', 'republish'],
  noNotify: ['notify'],
  noReadmePr: ['readme-enhance'],
};

// Stations a build is not a build without: no --no-* flag may drop them (the share card is a required,
// verified deliverable on both doors). A slice (--from/--to/--only) is an explicit operator choice, not a flag.
export const REQUIRED_STATIONS = ['make-social-card'];

// The name the hosted door's docs/runner use for a station: what the drift test looks for.
export const hostedName = (s) => s.hostedRef || s.tool || (s.entry ? path.basename(s.entry, '.mjs') : s.id);

export const stationIds = (door) => STATIONS.filter((s) => !door || s.doors.includes(door)).map((s) => s.id);

// The `--help` STATIONS block, generated from the table.
export function stationHelpText(door = 'local') {
  const ids = stationIds(door);
  const lines = [];
  for (let i = 0; i < ids.length; i += 6) lines.push('  ' + ids.slice(i, i + 6).join(' · '));
  return lines.join(' ·\n');
}

// The local station list for a set of options: every local-door station minus what the --no-* flags drop.
export function stationsFor(opts = {}) {
  const dropped = new Set(Object.entries(SKIP_FLAGS).filter(([flag]) => opts[flag]).flatMap(([, ids]) => ids).filter((id) => !REQUIRED_STATIONS.includes(id)));
  return STATIONS.filter((s) => s.doors.includes('local') && !dropped.has(s.id));
}

// Apply --only / --from / --to to a list. Unknown ids throw (--only used to silently select nothing); an id
// that exists but was removed by a --no-* flag says so.
export function selectStations(list, { from, to, only } = {}) {
  const known = new Set(stationIds('local'));
  const find = (flag, id) => {
    if (!known.has(id)) throw new Error(`${flag}: unknown station "${id}" (known: ${[...known].join(', ')})`);
    const i = list.findIndex((s) => s.id === id);
    if (i === -1) throw new Error(`${flag}: station "${id}" is switched off by a --no-* option`);
    return i;
  };
  if (only) return [list[find('--only', only)]];
  let out = list;
  if (from) out = out.slice(find('--from', from));
  if (to) {
    find('--to', to);
    const i = out.findIndex((s) => s.id === to);
    if (i === -1) throw new Error(`--to: station "${to}" comes before --from "${from}"`);
    out = out.slice(0, i + 1);
  }
  return out;
}
