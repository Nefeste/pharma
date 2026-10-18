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
- `docs/13-art.md` — picture, sound and interface: art direction, camera and light, people and machines, the
  feedback language (what the player sees and hears, and what the window cannot know), accessibility, sources of
  graphics and sound, what the art director checks before a merge. Numbers stay in `08-game-design.md`.
- `docs/10-domain.md` — facts about real pharmaceutical manufacturing that mechanics rely on,
  each with a source key; regulations change — check the date before relying on a fact.
- `docs/02-architecture.md` — engine modules, time and flow, determinism, window and 3D, plan
  runs, content, tests.
- `docs/04-data-model.md` — content records, engine entities, statuses, traceability.
- `docs/specs/2026-10-prototype.md` — what the prototype must answer.
- `docs/07-roadmap.md` — stages and the owner's decisions.
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
- **Open questions and forks live only in Issues** (owner's decision of 17.10.2026): a question only the owner can
  answer — label `владелец`, in the charter template (`docs/04-process.md`, «Вопрос владельцу»); a fork the work
  itself will settle — label `развилка`. Documents link to the Issue and keep no lists of open questions; an answered
  question goes into `docs/07-roadmap.md`, «Решения владельца», and the Issue is closed.
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
npm run e2e                        # after build: the game in headless Chromium; tools/app/out/e2e*.png and contact.png
npm run bench:headless             # after build: the scene bench in headless Chromium (software WebGL: not a GPU number)
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
  notices, `SCHEMA`), `engine.ts` (`newPlant`, `apply`, `catchUp`, events), `random.ts` (named branches in the state,
  the integer normal draw), `save.ts` (snapshot and migrations), `nav.ts` (the plan's 1 m grid: walls, doors and
  footprints, where people may walk and vehicles may drive, access cells, distance fields cached per plan, route length
  and the route polyline shared with the window, a point along it in whole centimetres), `plant.ts` (slots, docks, rooms,
  the lab, work points, posts of roles and distances along the plan's routes), `stock.ts` (lots, containers, pallets, slots, the lot status table), `supply.ts` (purchase
  orders), `wms.ts` (truck, its check at the dock before unloading, unloading, receiving, putaway), `quality.ts` (true lot properties, the lab result, spec
  limits), `lab.ts` (sampling, lab tests, the lot decision), `mes.ts` (batch orders, FEFO reservation with potency,
  kitting through the airlock, stages in rooms with equipment and people, cleaning, process parameters, true batch
  quality with causes, IPC, the bulk lot; the packing job and its packaging kit; a stage stopped by a part failure and
  resumed after the repair), `line.ts` (the packaging line as flow between events: machines, buffers, micro-stops,
  camera rejects by count, codes in cases, FG pallets, changeover and line clearance, the crew, the end of a batch with
  reconciliation, machine times for OEE, a machine part failing at a flow boundary, jams of the cartoner; the flow at a
  moment between events without writing the state — `flowAt`, for the slice), `qa.ts` (QA check of finished goods with
  retention samples, the qualified person's decision, FG shelf life), `market.ts` (customers and their orders, FG into
  circulation after the regulator publishes the batch, FEFO allocation with the residual shelf life, whole pallets and
  case picking, the customer's truck at 15:00, shipments with codes), `cash.ts` (kopecks and ledger entries, dues by
  date, suppliers, wages twice a month, contributions, energy, VAT by quarter, the credit line), `maint.ts` (machine
  parts, wear by work done, failure by the hazard table of wear, repairs and planned replacement by the mechanic with a
  spare from the workshop, spares replenished by level, the maintenance policy, `maintain`), `lean.ts` (losses per day
  by kind and department: waiting tasks by cause, a truck waiting for the dock, transport and walking, defects; a batch's
  time by state; the line master's shift task and the rhythm coefficient), `tasks.ts` (tasks and the dispatcher: people,
  vehicles, instruments; why a task waits; a person walking to a post is free and measured from where they are),
  `staff.ts` (shifts; a free person walks to the post of their role, and to the exit 15 minutes before the end of the
  shift; where they are on the way; off-shift people leave through the entrance), `invariants.ts`.
- **Golden fingerprint** (`tools/test/golden.test.ts`): any change of engine behaviour changes it. If the change is
  intended, record the new fingerprint and say in the commit what changed in the plant's life.
- `src/sim/` — the calculation thread: protocol, host (`createSim`), packed slice (`pack.ts`, format 5: rooms, trucks
  with their open body, changed pallets, tasks in progress, people with their walk to a post, vehicles, lines with their
  machines, equipment; no truth fields — not the next micro-stop, not a part's budget), views for panels — the warehouse
  and the card of a thing, built here on request and sent with the slice only when they changed, without truth fields
  (`views.ts`), Web Worker (`worker.ts`) and its client in the window (`client.ts`; how far the window's clock ran ahead
  of the last slice; at most one `tick` in flight). The window never runs the engine. Saves cross the thread boundary as a
  string: the window never parses the state with the true lot properties.
- `src/app/` — the game in the window: content, stage, clock and speeds with live time 1:1, input, panels (`game.ts`,
  `main.tsx`); what the slice puts on the floor — pallets, trucks, rooms, pallets on forks (`scene.ts`); where people
  and vehicles are now — a pure function of the tasks in the slice and the clock, on the plan's routes and with the
  engine's travel times, free people on their way to a post too (`movers.ts`); trucks in the yard — backing in, waiting,
  driving off, a picture only (`yard.ts`); what is under the cursor — people by their point on screen, pallets, machines
  and trucks by the camera ray, the room by the floor (`pick.ts`); pallet moves between zones seen from the slice, their
  rates, arrows and the fill of warehouse places (`flows.ts`); the scene bench, a copy of Bolnitsa's (`bench.ts`,
  `stats.ts`).
- `src/render/` — the 3D view: renderer, light, camera, post-processing and GPU timer (copies of Bolnitsa); the plant
  from the plan (`layout.ts` — rooms, walls, doors and spots from `planOf`), floors, zone markings, ground and yard,
  walls with the cut and openings (`world.ts`), doors, lamps and floor textures (`doors.ts`, `lamps.ts`, `textures.ts` —
  copies of Bolnitsa, adapted), racks and pallet loads by instancing (`loads.ts`), trucks — closed body before the check and when leaving (`trucks.ts`), room
  status signs (`signs.ts`), equipment and line machines as models in code from their records' `model` parts, with
  status lamps and icons, rotors, covers, belts and buffers (`machines.ts`; the lamp of each state, belt speed and
  buffer fill — pure functions in `flow.ts`), the pallet truck and the reach truck in code (`vehicles.ts`), the detail
  level by speed and camera height with its soft change (`detail.ts`), the site layer — arrows above the walls and the
  fill of places (`overlay.ts`), colour checks — colour-blindness simulation, ΔE and icon contrast (`color.ts`), the
  outline of the selected thing (`select.ts`), people
  — Bolnitsa's crowd on the GPU (`bake.ts`, `people.ts`, copies) with looks and clothes by role (`cast.ts`), the
  composition (`stage.ts`).
- `src/ui/` — panels (React) and their store: the top bar (`App.tsx`), the warehouse (`Stock.tsx`), the card of a thing —
  what it is, state, why, what can be done, history (`Card.tsx`), status icons (`icons.tsx`), the content base for names
  (`db.ts`); `src/i18n/` — every player-facing string, Russian and English, and number, quantity and date formats.
- `src/content/` — content types and the built bundle loader; `content/` — the game database in YAML;
  `tools/content/` — its build and validator (schema, ids from paths, references, source keys from `docs/10-domain.md`;
  plan rules in `plan.ts`: doors on walls, docks on outer walls, class D only through airlocks, reachability, posts on
  walkable floor; models in
  code — parts inside the footprint, round cylinders, upright hoppers, items only on belts: `modelErrors` in `load.ts`).
- `electron/` — the main process (window, `app://`, no network) and preload; `app/index.html` — the page.
- `assets/` — CC0 people models (copies of Bolnitsa's, byte for byte) and `LICENSES.md` (sources, licenses, SHA-256);
  never add a model without its line there and in `assets/models/sources.json`.
- `tools/app/` — page build, local server, browser scenario with the contact sheet, the headless scene bench
  (`bench.mjs`); `tools/test/` — Bun tests and save samples.
