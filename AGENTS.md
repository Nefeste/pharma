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
npm run build                      # content + page and its two workers (esbuild) → dist/ (not in git)
npm run e2e                        # after build: the game in headless Chromium; tools/app/out/e2e*.png and contact.png
npm run bench:headless             # after build: the scene bench in headless Chromium (software WebGL: not a GPU number)
npm run electron                   # build + the game window
npm run dist:win                   # build + Windows x64 zips → release/ (from Linux, no wine): full and app.asar update
bun tools/test/make-save-fixture.ts  # only when SCHEMA changes: a new save sample (old ones stay)
npm run bench                      # engine without a window: a year of scn.proto (--days, --step, --seed; --plan — also a plan run); compare before/after engine changes
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
  the lab, work points, posts of roles and distances along the plan's routes), `stock.ts` (lots, containers, pallets,
  slots, the lot status table), `supply.ts` (purchase orders; the supply colleague — at 09:00 on a workday, every material
  below its reorder point: plan use over the longest lead time, incoming control and safety stock, one order per approved
  supplier, at most half the quarantine zone in pallets), `planner.ts` (the planning colleague — at 07:00 on a workday, a
  batch order for the same weekday two weeks on, for the SKU that runs out first by FG and work in progress against
  demand seen in customer orders; SKUs in turn until demand is seen; campaigns — the product of the last batch order goes
  on while its SKUs need a batch and no SKU of the other product is urgent), `wms.ts` (truck, its check at the dock
  before unloading, unloading, receiving, putaway), `quality.ts` (true lot properties, the lab result, spec limits),
  `lab.ts` (sampling,
  lab tests by the spec revision in force when the sample was taken, the lot decision, a lot raised by the player),
  `docs.ts` (regulatory documents — specs, test methods, recipes, packaging instructions: revisions of one code, the one
  in force on a plant day, draft, in force or archived), `infer.ts` (the inference — a copy of Anamnez's: noisy-OR
  findings, the posterior over candidates, entropy and the expected gain of a step), `investigation.ts` (the scenario's
  incident — root and size by the seed, its traces in parameters, the mill screen and the lab test; an out-of-spec
  dissolution opens a deviation and an investigation, the lot waits; steps as tasks of their roles or lab tests — the
  retest of the same sample by another analyst; findings read from the plant's state; the conclusion — cause and fate,
  release only with a proven lab error; the quality colleague — lab first, then gain per hour — while the player does
  not hold the quality post; the debrief after the decision — `debrief`), `mes.ts` (batch orders on the recipe revision
  in force at their not-before, FEFO reservation with potency, kitting through the airlock, stages in rooms with
  equipment and people, cleaning, process parameters, true batch
  quality with causes, IPC, the bulk lot; the packing job and its packaging kit; a stage stopped by a part failure and
  resumed after the repair; a new not-before time of a batch order from the player — `shift`; room readiness, nominal
  stage time and cleaning time shared with the schedule run; new part budgets of a running stage for the plan run's
  twin — `stageRedraw`), `plan/schedule.ts` (the schedule run — a pure function: running tasks to their end, then
  kitting, stages and cleaning by the engine's rules and its own functions, with the player's draft changes; bars and
  the reasons why not earlier), `plan/twin.ts` (the plan run's twin: on a copy, forget what the plant does not know —
  true lot and batch properties, causes, part budgets, unrecorded jams, results before review, the incident not yet
  seen, marks no step has looked for — and redraw it from what was measured, the root of an open investigation from its
  versions; branches anew from the run seed), `plan/run.ts` (the plan run — a pure function: per seed a copy, the
  twin, the variant's commands, the horizon, the outcome — orders, batches, cash, OEE, load, general cleanings and line
  changeovers with their hours; per variant — lowest, median and highest over seeds), `line.ts` (the packaging line as
  flow between events: machines, buffers, micro-stops, camera rejects by count, codes in cases, FG pallets, changeover
  and line clearance, the crew, the end of a batch with
  reconciliation, machine times for OEE, a machine part failing at a flow boundary, jams of the cartoner; the flow at a
  moment between events without writing the state — `flowAt`, for the slice; new part budgets for the twin —
  `lineRedraw`), `qa.ts` (QA check of finished goods with
  retention samples, the qualified person's decision — «hold» blocks the FG and puts it on the racks, FG shelf life),
  `market.ts` (customers and their orders, FG into circulation after the regulator publishes the batch, FEFO allocation
  with the residual shelf life, whole pallets and case picking, the customer's truck at 15:00, shipments with codes; with
  no free staging place, the docked truck is loaded straight from the racks; orders at risk — one rule for the meeting
  and the hourly alert, `orderRisks`), `cash.ts` (kopecks and ledger entries, dues by
  date, suppliers, wages twice a month, contributions, energy, VAT by quarter, the credit line), `maint.ts` (machine
  parts, wear by work done, failure by the hazard table of wear, repairs and planned replacement by the mechanic with a
  spare from the workshop, spares replenished by level, the maintenance policy, `maintain`), `lean.ts` (losses per day
  by kind and department: waiting tasks by cause, a truck waiting for the dock, transport and walking, defects, room
  cleanings — general and minor — and line changeovers with their work; a line's
  day — machine times, rated output over loading and working time, good tablets — and `oee()`; a batch's time by state;
  the line master's shift task and the rhythm coefficient), `tasks.ts` (tasks and the dispatcher: people,
  vehicles, instruments; why a task waits; a person walking to a post is free and measured from where they are; only a
  person admitted to everything the work and the vehicle need takes it, otherwise the task waits «нет допуска» with the
  document), `quals.ts` (admissions: the training matrix — the roles of each procedure and test method, the same for all
  revisions of a code; what a work needs to know — procedures of its task kind and of any work, the equipment and IPC
  methods of a stage, the machines of a line, the method of a test, a vehicle's procedure; a person knows a document on a
  day — a record on the revision in force or newer, not expired; which revision to learn and when — `ahead` days before a
  new revision or the end of a record), `train.ts` (training: start records spread by a hash of person and code up to
  `spread` days back; at midnight — a notice for an admission lost and a task to study at the person's post; the
  knowledge check by the QA specialist or the QC head, never the trainee; the record with the check's day), `staff.ts`
  (shifts; whether a person of a shift may take a task at a moment — shared with the schedule run; a free
  person walks to the post of their role, and to the exit 15 minutes before the end of the shift; where they are on the
  way; off-shift people leave through the entrance), `seats.ts` (the player's places — the director and four posts:
  whose each command is, the `seat` command, the log of places; a player's command of another's post is refused),
  `batchno.ts` (the batch number `PPNNNMMYY`: the short `PPNNN` when the batch record is issued, month and year when the
  first mixing starts; a count per product code from 1 January and after 999 again from 001, skipping numbers still held,
  so a full number never repeats; one integer in the slice), `alerts.ts` (the hourly alerts — a supplier truck still not
  unloaded 2 hours after arrival, a batch order still waiting for material at its not-before time and a packing job short
  of it at once, a new customer order at risk by the meeting's rule; one notice per thing in the hour its threshold
  falls, no state of their own), `invariants.ts`.
- **Golden fingerprint** (`tools/test/golden.test.ts`): any change of engine behaviour changes it. If the change is
  intended, record the new fingerprint and say in the commit what changed in the plant's life.
- `src/sim/` — the calculation thread: protocol, host (`createSim`; a `tick` carries the notice kinds of the player's
  autopauses, and the thread stops right after such an event — the plant's clock on its minute, the rest of the game
  clock dropped), packed slice (`pack.ts`, format 6: rooms, trucks
  with their open body, changed pallets, tasks in progress, people with their walk to a post, vehicles, lines with their
  machines, equipment; no truth fields — not the next micro-stop, not a part's budget), views for panels — the warehouse
  and the card of a thing with what a pallet holds, built here on request and sent with the slice only when they changed,
  without truth fields (`views.ts`); the plant reference — how it should be by master data and how it is: products and
  SKUs, recipes with stages by plan and by the stage records, equipment and the line, instruments and methods, roles and
  shifts, suppliers and customers, materials with their OKEI unit codes and the spec in force, every document revision
  with its status by the plant date, without the model's hidden parameters, start moments of running work as numbers
  (`ref.ts`); what is going on now — running work by department, one row per work, with the plant's norm and never the
  engine's drawn duration (`now.ts`); the 08:00 meeting — the player's places over their tenure, yesterday by calendar
  day with its cleanings and changeovers, events of the 24 hours before it, what waits now — the cash panel and the
  top-bar cash with the player's places (`report.ts`); the lab queue and the X–Rm control chart of the in-process average
  tablet mass with its limits and special-cause signs, a lot under investigation and its steps' tests (`lab.ts`); the
  investigation board — what happened, participants, steps, findings, versions from the findings only, whether release
  is proven, the debrief only once concluded (`inv.ts`); people and admissions — a person's admission today and what
  they are losing within the warning period, training rows of the card, the training matrix of the reference with how
  many people of a role are admitted, the meeting's summary — records are the plant's knowledge, not truth
  (`people.ts`); the schedule — the Gantt of the past, the running and
  the schedule run with the player's draft, the old bars of what the draft moves, and the ghost of a dragged batch order
  (`plan.ts`), Web Worker (`worker.ts`) and its client in the window (`client.ts`; how far the window's clock ran ahead
  of the last slice; at most one `tick` in flight); the plan run's own thread — a second Web Worker over the same engine
  (`planHost.ts`, `planWorker.ts` → `dist/plan.js`) and its client in the window (`planClient.ts`; a stop terminates
  the thread). The window never runs the engine. Saves cross the thread boundary as a string: the window never parses
  the state with the true lot properties — the plan run gets the same string.
- `src/app/` — the game in the window: content, stage, clock and speeds with live time 1:1, input, panels (`game.ts`,
  `main.tsx`); what the slice puts on the floor — pallets, trucks, rooms, pallets on forks (`scene.ts`); where people
  and vehicles are now — a pure function of the tasks in the slice and the clock, on the plan's routes and with the
  engine's travel times, free people on their way to a post too, and the work icon of each busy person (`movers.ts`);
  the start preset — the frame measured on medium at first run, low if slower than 33 ms, the result and the player's
  choice kept in the window (`preset.ts`); the autopauses — which notices stop the world, whose post each is, the ones
  switched off kept in the window, where a click on a notice leads (`pauses.ts`); which «Сейчас» row is the work of a
  thing in the card (`watch.ts`); trucks in the yard — backing in, waiting,
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
  outline of the selected thing (`select.ts`), the work icons — paths shared by SVG and canvas (`taskicons.ts`) and the
  icons above heads, one instanced draw call (`badges.ts`), people
  — Bolnitsa's crowd on the GPU (`bake.ts`, `people.ts`, copies) with looks and clothes by role (`cast.ts`), the
  composition (`stage.ts`).
- `src/ui/` — panels (React) and their store: the top bar with «До утра», «До события» and the latest notice — the one
  the world stopped on marked «❚❚», a click leads to its place (`App.tsx`), the autopause menu (`Pauses.tsx`), the
  warehouse (`Stock.tsx`), the card of a
  thing — what it is, state, why, what can be done, history (`Card.tsx`), the plant reference with its tabs, sortable columns and search (`Ref.tsx`,
  F1), quality attribute and process parameter values in words (`units.ts`), what is going on now with «Смотреть»
  (`Now.tsx`, N), the 08:00 meeting (`Morning.tsx`), the cash
  panel (`Cash.tsx`), the lab queue and control chart (`Lab.tsx`), the schedule window with dragging, the draft, «Прогнать
  план» and the run's outcome per variant (`Gantt.tsx`), the draft's pure rules — a row per batch order, gone once kitting
  starts, `shift` commands on approval (`draft.ts`), the «Кем вы будете» screen of places (`Seats.tsx`), the
  investigation board — steps, findings in words with numbers from the records, version bars, the decision, the
  debrief (`Inv.tsx`), status and work icons
  (`icons.tsx`), the content base for names (`db.ts`); `src/i18n/` — every player-facing string, Russian
  and English, and number, quantity, money, duration and date formats.
- `src/content/` — content types and the built bundle loader; `content/` — the game database in YAML (with part 4 —
  `investigations/`: the investigation model — candidates, findings, steps; with Б3б — `sops/`: procedures with the
  document header, the works they are needed for, the roles that learn them, hours to study and the term in months);
  `tools/content/` — its build and validator (schema, ids from paths, references, source keys from `docs/10-domain.md`;
  material codes by kind and document headers — unique, revisions of a code on different days, in force at the start;
  the training matrix — every role the engine gives a work is in the row of each document the work needs, revisions of a
  code share roles and works, start records younger than the shortest term; plan rules in `plan.ts`: doors on walls, docks on outer walls, class D only through airlocks, reachability, posts on
  walkable floor; models in
  code — parts inside the footprint, round cylinders, upright hoppers, items only on belts: `modelErrors` in `load.ts`).
- `electron/` — the main process (window, `app://`, no network) and preload; `app/index.html` — the page.
- `assets/` — CC0 people models (copies of Bolnitsa's, byte for byte) and `LICENSES.md` (sources, licenses, SHA-256);
  never add a model without its line there and in `assets/models/sources.json`.
- `tools/app/` — page build (the page, the calculation thread and the plan run's thread), local server, browser scenario
  with the contact sheet, the headless scene bench (`bench.mjs`), the release update archive — one `resources/app.asar`
  (`update-zip.mjs`); `tools/test/` — Bun tests and save samples; engine
  mechanics tests run on the scenario as it was before Б2в (`legacy.ts`), the golden run — on the game's scenario;
  `tools/bench/` — the engine bench, with `--plan` also the plan run.
