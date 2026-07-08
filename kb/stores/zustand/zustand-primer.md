# Zustand — Human Primer

## 1. What is zustand

Zustand is a small, fast, and scalable bearbones state management solution for React. It provides a hooks-first API that is neither boilerplatey nor opinionated, but has enough convention to be explicit and flux-like. It is published to npm and lives in the `pmndrs` organization.

The library was built specifically to handle common React state pitfalls: the zombie child problem, React concurrency issues, and context loss between mixed renderers.

## 2. What can it do for you

- **Create a store with a single hook** — no providers required, no app-wrapping boilerplate.
- **Subscribe with selectors** — manually apply render optimizations by passing selector functions to your hook calls.
- **Work without React** — a vanilla (framework-free) build is available alongside the React-specific one.
- **Layer in middleware** — built-in middleware includes `devtools`, `persist`, `immer`, and `combine`, all usable from `zustand/middleware`.
- **Compose state with slices** — large stores can be split into typed slice creators and merged together.
- **Stay safe under React concurrency** — the library was designed with concurrent rendering in mind.

Compared to Redux, it does not require your app to be wrapped in context providers. Compared to Valtio, it uses an immutable state model. Compared to Jotai and Recoil, render optimization is manual via selectors rather than automatic via atom dependency tracking.

## 3. What is it made of (the components)

The repo contains three components:

| Component | Role |
|-----------|------|
| **zustand** | The core library — the thing you install and ship. |
| **demo** | A demo application; depends on the core `zustand` component. Also pulls in `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `three`, `meshline`, and related packages. |
| **starter** | A starter application; also depends on the core `zustand` component. |

The demo and starter components are internal development/showcase tools. Only `zustand` itself is the published package.

The core library is built in several discrete sub-targets: `base`, `vanilla`, `react`, `middleware`, `middleware/immer`, `shallow`, `vanilla/shallow`, `react/shallow`, and `traditional` — each with its own build command.

## 4. How it works

You define a store by calling `create` with an initializer function that receives `set` (and optionally `get`). The initializer returns the initial state and any actions:

```ts
import { create } from 'zustand'

interface BearState {
  bears: number
  increase: (by: number) => void
}

const useBearStore = create<BearState>()((set) => ({
  bears: 0,
  increase: (by) => set((state) => ({ bears: state.bears + by })),
}))
```

Components subscribe by calling the hook with a selector. Only the selected slice of state triggers a re-render:

```ts
const increasePopulation = useBear((state) => state.increasePopulation)
```

State updates are immutable — you return a new partial state from `set`, not a mutation. Middleware wraps the initializer and can extend or transform the store. For TypeScript users, the pattern is `create<T>()(...)` — the extra parentheses matter for correct contextual inference. The `combine` middleware can infer state types automatically if you prefer not to annotate explicitly.

The knowledge base indexes 41 public symbols across the library's entrypoints.

## 5. How to install and use it

**Install:**

```bash
npm install zustand
```

**Minimal example:**

```ts
import { create } from 'zustand'

const useBearStore = create((set) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
}))
```

**With middleware (TypeScript):**

```ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

const useBearStore = create<BearState>()(
  devtools(persist((set) => ({ bears: 0, increase: (by) => set((state) => ({ bears: state.bears + by })) }), { name: 'bearStore' }))
)
```

**For contributors building from source**, the repo uses `pnpm`. Key commands:

- `npm run build` — full build
- `npm run test` — runs format, type, lint, and spec checks
- `npm run fix` — formats and lints code and docs
- `npm run dev` — starts the dev server (demo or starter)

Documentation lives at `zustand.docs.pmnd.rs` and is based on `pmndrs/docs`.

## 6. Honest scope and limits

- **Manual render optimization** — unlike Jotai or Recoil, Zustand does not automatically track dependencies. You are responsible for writing selectors to avoid unnecessary re-renders.
- **Immutable model only** — if you want proxy-based mutable state (like Valtio), Zustand is not that; you must return new state objects from `set`.
- **TypeScript ceremony** — the `create<T>()()` double-call pattern is required for correct type inference; the single-call form exists but loses type safety in certain middleware scenarios.
- **`get` is unsafe at init time** — calling `get` inside the initializer before state is created returns `undefined` at runtime despite what the types suggest; the docs flag this explicitly.
- **No built-in atom dependency graph** — cross-slice reactivity requires you to wire it manually, typically via the slices pattern with `StateCreator`.
- **React is optional but the ecosystem assumes it** — the demo component depends heavily on `@react-three/fiber` and related 3D libraries, which signals the library's primary audience is React developers.
