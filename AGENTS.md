This is «Фармзавод» (working title), a pharmaceutical plant management simulator for PC (Steam):
warehouse, production, quality control, packaging lines, maintenance, staff, planning, market and
money, built on a deterministic model of a real plant (a "digital twin" under the game). It is the
second PC game of the «Горница» studio, after `Nefeste/bolnitsa`. The project is at **stage A —
prototype**: see `STATUS.md` and `docs/specs/2026-10-prototype.md`.

## Studio charter — read first

This project belongs to the «Горница» studio. Studio-wide rules live only in the public
charter repository `Nefeste/gornitsa` (https://github.com/Nefeste/gornitsa); this repository
keeps only what is specific to the project. Before changing anything — and after a context
reset — read the charter's `AGENTS.md`, then `docs/05-rules.md` (hard rules for every game)
and `docs/04-process.md` (how work is done). Raw files:
`https://raw.githubusercontent.com/Nefeste/gornitsa/main/<path>`.

Current state of this project: `STATUS.md` (it is not repeated here).

Precedence: the owner's recorded decision → the charter → this project's documents. A project
rule may narrow a charter rule, never weaken it. If a document here restates or contradicts
the charter, replace it with a link or report the contradiction to the owner.

Where the charter speaks of phones, RuStore, APK or Expo, `docs/adr/0001-studio-adrs.md` says
what applies here, what does not, and which charter decisions this project departs from.

## Read `docs/` before changing anything

The project documents itself in [`docs/`](docs/README.md), in Russian. Start there:

- `docs/README.md` — index and reading order.
- `docs/01-product.md` — what the game is, its pillars, for whom, what is deliberately absent,
  vocabulary (UI and code terms must match it).
- `docs/08-game-design.md` — the game as it should ship in 1.0; **game-design numbers live there or in the
  content records it points to — each number in one place**.
- `docs/10-domain.md` — facts about real pharmaceutical manufacturing that mechanics rely on,
  each with a source key; regulations change — check the date before relying on a fact.
- `docs/02-architecture.md` — engine modules, time and flow, determinism, window and 3D, plan
  runs, content, tests.
- `docs/04-data-model.md` — content records, engine entities, statuses, traceability.
- `docs/specs/2026-10-prototype.md` — what the prototype must answer.
- `docs/07-roadmap.md` — stages and owner questions.
- `docs/adr/` — decisions that are expensive to reverse; read the relevant one *before*
  proposing the opposite.

## Sister project: Bolnitsa

The platform comes from `Nefeste/bolnitsa` **by copying** with a source line on top of each file
(studio ADR 0002): `// из bolnitsa: src/sim/pack.ts @ <commit>`. That is the engine core (seeded
branches, event queue, integer math), building by mouse, staff, the calculation thread and packed
slice, the Electron shell without network, the 3D base and crowd, the content build, the browser
scenario and benches (`docs/02-architecture.md`, §2). A fix in a copied file is a task to carry it
to the other side as well. Bolnitsa's documents are the reference for how those parts work; they
are not restated here. Its medical model is not used.

## Hard rules

Studio-wide rules are in the charter's `docs/05-rules.md`. In addition here:

- **Manufacturing facts come from named sources** (`docs/10-domain.md`): stages, equipment,
  tests, limits, regulations. Never from memory and never from other games (Big Pharma, Production
  Line or any other — not even "to compare"). Every content record with facts carries `source` and
  `review: draft`; only a human sets `checked`.
- **Real substances by INN, fictional everything else**: no real companies, plants, distributors,
  equipment makers, trade names or logos. No controlled (narcotic, psychotropic, potent) substances.
  No doses or advice on use.
- **No cheating mechanics**: no forging records, adjusting results or hiding defects. Risk in the
  game is only lawful risk (`docs/01-product.md`, «Чего нет сознательно»).
- **The engine is pure TypeScript**: no UI, no `Date`, no `Math.random`, no `Math.exp`/`Math.log`/
  `Math.sin` in state-changing code, seeded named branches, integer units, `apply(db, state,
  command)` and `advance` (charter ADR 0004, `docs/02-architecture.md`, §4).
- **The window never sees the truth**: true quality values and causes stay in the calculation
  thread; the window gets only what the plant could measure (`docs/02-architecture.md`, §9).
- **No network.** The game works fully offline and sends nothing anywhere (charter ADR 0008, 0014).
- **Generators for graphics only, by studio ADR 0020**: every generated file goes into the project's
  generation log or it does not ship; equipment is preferably modelled in code from data.
- Never press «Merge»; merging follows charter ADR 0018.

## Commands

The game is Electron + Three.js + React (ADR 0002), built with esbuild; tests run in Bun (CI: Bun 1.3.11, like
Bolnitsa). Run `content`, `typecheck`, `test`, the page build and the browser scenario before every push — `pr.yml`
runs the first four on every PR.

```bash
npm ci                             # dependencies, Electron included (ELECTRON_SKIP_BINARY_DOWNLOAD=1 for checks only)
npm run content                    # build and validate content/ → src/content/generated/bundle.json (not in git)
npm run typecheck                  # content + tsc --noEmit (src incl. .tsx, tools)
npm test                           # content + bun test tools/test
npm run build                      # content + page and worker (esbuild) → dist/ (not in git)
npm run e2e                        # after build: the game in headless Chromium — clock, ×4, pause, «Until morning»; tools/app/out/e2e.png
npm run electron                   # build + the game window
npm run dist:win                   # build + Windows x64 zip → release/ (from Linux, no wine) — the release file
bun tools/test/make-save-fixture.ts  # only when SCHEMA changes: a new save sample (old ones stay)
npm run bench                      # engine without a window: a year of scn.proto (--days, --step, --seed); compare before/after engine changes
```

The browser scenario needs Chromium: `PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`) or `CHROMIUM_PATH`.
Software WebGL numbers say nothing about a player's GPU — the owner's PC is the reference.

Never write Three.js, Electron, React or esbuild code from memory: read the docs of the pinned versions (`package.json`)
first, or copy the working code of Bolnitsa on the same versions.

## Project map

- `src/engine/` — the engine (pure TypeScript; see «Hard rules»): `core/` (seeded branches, hashes, own `log2` — copies;
  the event agenda as a heap in plain arrays and the calendar without `Date` — ours), `types.ts` (state, commands,
  notices, `SCHEMA`), `engine.ts` (`newPlant`, `apply`, `catchUp`, events), `random.ts` (named branches in the state),
  `save.ts` (snapshot and migrations), `plant.ts` (slots, docks, rooms and distances from the plant record),
  `stock.ts` (lots, containers, pallets, slots, the lot status table), `supply.ts` (purchase orders), `wms.ts` (truck,
  unloading, receiving, putaway), `tasks.ts` (tasks and the dispatcher), `staff.ts` (shifts), `invariants.ts`.
- **Golden fingerprint** (`tools/test/golden.test.ts`): any change of engine behaviour changes it. If the change is
  intended, record the new fingerprint and say in the commit what changed in the plant's life.
- `src/sim/` — the calculation thread: protocol, host (`createSim`), packed slice (`pack.ts`), Web Worker (`worker.ts`)
  and its client in the window (`client.ts`). The window never runs the engine.
- `src/app/` — the game in the window: content, stage, clock and speeds, input, panels (`game.ts`, `main.tsx`).
- `src/render/` — the 3D view: renderer, light, camera, post-processing and GPU timer (copies of Bolnitsa), the floor,
  racks and pallet loads by instancing (`stage.ts`, `loads.ts`), the demo warehouse of part 0 (`demo.ts`).
- `src/ui/` — panels (React) and their store; `src/i18n/` — every player-facing string, Russian and English.
- `src/content/` — content types and the built bundle loader; `content/` — the game database in YAML;
  `tools/content/` — its build and validator (schema, ids from paths, references, source keys from `docs/10-domain.md`).
- `electron/` — the main process (window, `app://`, no network) and preload; `app/index.html` — the page.
- `tools/app/` — page build, local server, browser scenario; `tools/test/` — Bun tests and save samples.
