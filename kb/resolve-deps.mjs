// resolve-deps.mjs — portable resolver for the Cognitum KB scripts.
//
// Resolves the two runtime deps the KB needs in a machine-independent order:
//
//   @ruvector/rvf        -> RvfDatabase (the .rvf vector store)
//   @xenova/transformers -> the MiniLM embedder
//
// Resolution order (first hit wins) for EACH dep:
//   1. The project's own node_modules (so `cd kb && npm i` or a root install just works).
//   2. An explicit env override   (RVF_MODULE_PATH / XENOVA_PATH).
//   3. The author's Mac npm-global / AppealArmor paths (LAST resort, so local dev still runs).
//
// This file ships INSIDE the zips, so it must not assume anything beyond Node 18+ and the
// two npm deps being installable via `npm i @ruvector/rvf @xenova/transformers`.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const KB_DIR = path.dirname(__filename);

// require() rooted at THIS file — node walks up node_modules from kb/ to the project root,
// so it finds deps installed either in kb/node_modules or the project root node_modules.
const localRequire = createRequire(__filename);

// LAST-RESORT author paths (kept so Stuart's local box still works with zero install).
const MAC_RVF_GLOBAL = '/Users/stuartkerr/.npm-global/lib/node_modules/@ruvector/rvf';
const MAC_XENOVA = 'file:///Users/stuartkerr/Code/AppealArmor/node_modules/@xenova/transformers/src/transformers.js';
const MAC_MODEL_CACHE = '/Users/stuartkerr/Code/PowerPlatePulse/scripts/models-cache';

function existsModuleDir(p) {
  // p may be a package root dir OR a file path; treat presence as resolvable.
  try { return fs.existsSync(p); } catch { return false; }
}

/**
 * Resolve and return the @ruvector/rvf module ({ RvfDatabase, ... }).
 * Order: project node_modules -> RVF_MODULE_PATH env -> Mac npm-global.
 */
export function loadRvf() {
  // 1. project node_modules (kb/ or root)
  try {
    return { mod: localRequire('@ruvector/rvf'), via: 'project node_modules' };
  } catch { /* fall through */ }

  // 2. explicit env override (dir of the package, or a path createRequire can resolve from)
  const envPath = process.env.RVF_MODULE_PATH;
  if (envPath && existsModuleDir(envPath)) {
    // If env points at a node_modules root, require @ruvector/rvf from there; else require it directly.
    const base = envPath.endsWith('@ruvector/rvf') || envPath.endsWith('@ruvector/rvf/')
      ? envPath
      : path.join(envPath, '@ruvector/rvf');
    try {
      const req = createRequire(path.join(envPath, 'noop.js'));
      return { mod: req('@ruvector/rvf'), via: `RVF_MODULE_PATH (${envPath})` };
    } catch {
      try { return { mod: localRequire(base), via: `RVF_MODULE_PATH dir (${base})` }; } catch { /* fall through */ }
    }
  }

  // 3. Mac npm-global (last resort)
  if (existsModuleDir(MAC_RVF_GLOBAL)) {
    return { mod: localRequire(MAC_RVF_GLOBAL), via: 'Mac npm-global (last resort)' };
  }

  throw new Error(
    "Cannot resolve '@ruvector/rvf'. Run `cd kb && npm i` (or `npm i @ruvector/rvf` at the "
    + 'project root), or set RVF_MODULE_PATH to a node_modules dir that contains it.'
  );
}

/**
 * Resolve and dynamically import @xenova/transformers.
 * Order: project node_modules -> XENOVA_PATH env -> Mac AppealArmor build.
 * Returns { T, modelCache, via } where T is the imported module namespace.
 */
export async function loadTransformers() {
  // 1. project node_modules — resolve the package entry, import via file:// URL.
  try {
    const resolved = localRequire.resolve('@xenova/transformers');
    const T = await import('file://' + resolved);
    return { T, modelCache: chooseModelCache(), via: 'project node_modules' };
  } catch { /* fall through */ }

  // 2. explicit env override — may be a transformers.js file path or a package dir.
  const envPath = process.env.XENOVA_PATH;
  if (envPath) {
    const url = envPath.startsWith('file://') ? envPath
      : envPath.endsWith('.js') ? 'file://' + path.resolve(envPath)
      : 'file://' + path.join(path.resolve(envPath), 'src/transformers.js');
    try {
      const T = await import(url);
      return { T, modelCache: chooseModelCache(), via: `XENOVA_PATH (${envPath})` };
    } catch { /* fall through */ }
  }

  // 3. Mac AppealArmor build (last resort)
  try {
    const T = await import(MAC_XENOVA);
    return { T, modelCache: chooseModelCache(), via: 'Mac AppealArmor build (last resort)' };
  } catch {
    throw new Error(
      "Cannot resolve '@xenova/transformers'. Run `cd kb && npm i` (or `npm i @xenova/transformers` "
      + 'at the project root), or set XENOVA_PATH to the transformers package dir / src/transformers.js.'
    );
  }
}

/**
 * Pick a model cache directory. KB_MODEL_CACHE wins; otherwise a kb-local `models-cache`
 * if it already has the model; otherwise the Mac cache if present; otherwise a kb-local
 * dir (created lazily) into which a remote download will be cached.
 * `modelName` lets the big (bge) variant resolve its cache by its own model, not just MiniLM;
 * defaults to MiniLM-384 so existing small-build callers are unchanged.
 */
export function chooseModelCache(modelName = 'Xenova/all-MiniLM-L6-v2') {
  if (process.env.KB_MODEL_CACHE) return process.env.KB_MODEL_CACHE;
  const kbLocal = path.join(KB_DIR, 'models-cache');
  if (fs.existsSync(path.join(kbLocal, modelName))) return kbLocal;
  if (fs.existsSync(path.join(MAC_MODEL_CACHE, modelName))) return MAC_MODEL_CACHE;
  return kbLocal; // remote download lands here on first run
}

/**
 * Configure a transformers namespace `T` for a given model: point at the cache, and allow
 * remote download ONLY when THAT model isn't already cached (offline-first).
 * `modelName` defaults to the MiniLM-384 embedder so existing callers keep working; the big
 * variant passes `'Xenova/bge-base-en-v1.5'` so its own cache check is correct.
 * Returns { modelCache, haveLocalModel }.
 */
export function configureModel(T, modelCache, modelName = 'Xenova/all-MiniLM-L6-v2') {
  const haveLocalModel = fs.existsSync(path.join(modelCache, modelName));
  T.env.localModelPath = modelCache;
  T.env.allowRemoteModels = !haveLocalModel; // fresh machine -> download from HuggingFace
  return { modelCache, haveLocalModel };
}
