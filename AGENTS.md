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
npm run e2e                        # after build: the game in headless Chromium; tools/app/out/e2e*.png and contact.png;
                                   # then the first week of a newcomer (e2e-week.mjs, week.png), then memos and
                                   # questions (e2e-memo.mjs, memo.png), then a CAPA and its check three months on
                                   # (e2e-capa.mjs, capa.png), then batch orders from the production post (e2e-jobs.mjs,
                                   # jobs.png), then the launch plan and the daily lists (e2e-launch.mjs, launch.png),
                                   # then the forecast to the meeting of 1 November (e2e-forecast.mjs, forecast.png),
                                   # then the S&OP meeting of 3 September (e2e-sop.mjs, sop.png), then the materials of
                                   # 2 September (e2e-mrp.mjs, mrp.png), then the plan edits — a commerce event at the
                                   # meeting, a priced edit in the frozen horizon, the horizon policy (e2e-edits.mjs,
                                   # edits.png), then the sources — a pair approval to its trial lot, the offers of a
                                   # planned order (e2e-sources.mjs, sources.png; `--long 1` — on to the dossier filing);
                                   # `-- --only main|week|memo|capa|jobs|launch|forecast|sop|mrp|edits|sources` for one
npm run bench:headless             # after build: the scene bench in headless Chromium (software WebGL: not a GPU number)
npm run electron                   # build + the game window
npm run dist:win                   # build + Windows x64 zips → release/ (from Linux, no wine): full and app.asar update
bun tools/test/make-save-fixture.ts  # only when SCHEMA changes: a new save sample (old ones stay)
npm run models                     # Blender 5.2.3 in the background (BLENDER or PATH; blender/README.md): models
                                   # → assets/models with their passport; `-- --check` — twice, same SHA-256
node tools/app/blender-sheet.mjs   # after build: the «code — Blender» sheet → tools/app/out/blender-sheet.png
npm run bench                      # engine without a window: a year of scn.proto (--days, --step, --seed; --plan — also a plan run); compare before/after engine changes
```

The browser scenario needs Chromium: `PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`) or `CHROMIUM_PATH`.
Software WebGL numbers say nothing about a player's GPU — the owner's PC is the reference.

Never write Three.js, Electron, React or esbuild code from memory: read the docs of the pinned versions (`package.json`)
first, or copy the working code of Bolnitsa on the same versions.

## Project map

- `src/engine/` — the engine (pure TypeScript; see «Hard rules»): `core/` (seeded branches, hashes, own `log2` — copies;
  the event agenda as a heap in plain arrays and the calendar without `Date` with the production calendar — holidays,
  transfers, short days, the month's norm — ours), `types.ts` (state, commands,
  notices, `SCHEMA`), `engine.ts` (`newPlant`, `apply`, `catchUp`, events), `random.ts` (named branches in the state,
  the integer normal draw), `save.ts` (snapshot and migrations), `nav.ts` (the plan's 1 m grid: walls, doors and
  footprints, where people may walk and vehicles may drive, access cells, distance fields cached per plan, route length
  and the route polyline shared with the window, a point along it in whole centimetres), `plant.ts` (slots, docks, rooms,
  the lab, work points, posts of roles and distances along the plan's routes), `stock.ts` (lots, containers, pallets,
  slots, the lot status table; with 0.0.57 the places of quarantine and the cold room held for pallets at sampling —
  a putaway from receiving takes only those above them, `heldForSampled`), `supply.ts` (purchase orders; the supply
  colleague — at 09:00 on a workday, every material below its reorder point: plan use over the longest lead time,
  incoming control and safety stock, through the first
  approved supplier–maker pair, one order per
  supplier, at most half the quarantine zone in pallets; with Б5б the rule without writing — `supplyPlan` — and an order
  quoted without writing — lines up to whole containers, cost, VAT and prepayment, or the refusal with the line's
  material — `quotePo`, shared with the «Заказ поставщику» window; with Б6д the rule by need — the planned orders whose
  order date came, the same quarantine limit — `needPlan`, either rule by the supply head's policy «как заказывать» —
  `supplyOrders`; a PO in transit expedited — the arrival at 09:00 of the workday a week on, no later than its own, the
  surcharge with VAT paid at once — or cancelled before arrival — the fee from the prepayment, the rest refunded, the
  contract's volume free again —, the quotes without writing — `fastQuote`, `cancelQuote`; with Б6ж a supplier is late
  by its own branch — a share of orders by so many days of its record (`lateOf`), the plant knows the promised arrival
  (`eta`) and only the engine the real one (`truth`, `arriveAt`), a PO not come by the end of the promised day's arrival
  window late — the alert, an expedited PO no longer late, the twin's redraw by the run seed (`redrawLate`); the trial
  lot of a pair approval ordered through its candidate pair, neither its PO nor its lot supply for the plan until the
  dossier decision releases it (`trialPo`, `trialLot`), its PO not to be cancelled; either rule's supplier by the policy
  «кому заказывать»), `planner.ts` (the planning
  colleague — at 07:00 on a
  workday, a batch order for the workday two working weeks on, for the SKU that runs out first by FG and work in
  progress against demand per working day seen in customer orders, over five-day weeks ahead; SKUs in turn until demand
  is seen; campaigns — the product of the last batch order goes on while its SKUs need a batch and no SKU of the other
  product is urgent; with Б6а the due of a stock order — the truck hour of the workday the SKU runs out by the same
  position, `stockDue` — and a cancelled stock order holding its SKU until its not-before, `heldOf`; with Б6б the same
  choice shared with the launch plan — `choose` — and the launch plan without writing, with the schedule draft —
  `launchPlan`; with Б6в the demand of the rule from the planning forecast by the policy «спрос», named in the reason;
  with Б6е the batch order on the workday at the edge of the frozen horizon by the planning head's policy, `frozenOf`,
  and the demand window over its calendar days, `frozenDays`),
  `forecast.ts` (with Б6в, the sales forecast: the season of a product group in customer demand — `seasonSec`; demand
  history for 24 months before the start by the same rule on its own branch, then cases ordered by the order's month;
  at 00:00 on the 1st, after the month's indicators, 18 months by five methods on the rate per calendar day — same as
  last year, moving average, smoothing, damped Holt, the group's season by a 2 × 12 decomposition; the planning
  forecast by the method policy or «best» by a rolling-origin backtest over 12 months, with edits by hand — `replan`,
  at once on a policy change; the sales department — smoothing and the scenario's optimism, a journal record of the
  sales head; accuracy at a lag of one month — WAPE and bias, `lagError`; the `forecast` command; the rule's demand
  ahead — `forecastAhead`), `sop.ts` (with Б6г, the S&OP meeting: on the third workday at 10:00, after the hour's
  customer orders and batch orders, the best plan; a player at the director or production seat — the meeting opens and
  waits for the `sop` command, otherwise the colleague approves the best plan with the planning head's journal record;
  the rule's cover of a product from the latest approved plan for the month of the order's day — `sopCover`),
  `plan/sop.ts` (with Б6г, the S&OP projection, pure functions: the pack margin, a batch's load of key resources and
  role hours by norms, capacity by the people's shifts of the month, the planning head's rule day by day on the planning
  forecast for six months and a month of sales, the plan goal — margin less the cost of money in stock — on three demand
  variants, the best plan within the capacity reserve, the cash for three months and the FG shelf-life risk),
  `plan/mrp.ts` (with Б6д, the material requirements, a pure function: the S&OP projection for 12 months and the batch
  orders already placed — gross by the recipe in force and the SKU's packaging, availability through incoming control,
  the safety stock by the policy's days, net by months, the material due released by the arrival deadline — a day of the
  previous month and incoming control, passed or 0 — the batch day; planned orders — the shortage and the policy's days
  of use more, whole containers, no less than the smallest lot — beyond the horizon of a new order with the upper lead
  time to a workday, the order date the last workday whose order still makes it; messages «заказать до», «опаздывает»,
  «опоздает», «лишний» — `mrpPlan`; with Б6ж the arrival of a PO in transit — the promised one, a PO past it «не
  пришёл» and available no earlier than today with incoming control, a planned order's supplier by the policy
  «кому заказывать» with why it is not the main one, the stock of a recipe line's analog — the main's availability by
  the factor, no planned order for an analog),
  `plan/price.ts` (with Б6е, the price of a plan edit, a pure function: the schedule run over the price horizon with
  the edit and without it — general and minor room cleanings with their hours, line format changes by the order of the
  batches' last stage ends from the line's format now, batch orders that end later and by how much; the edge of the
  frozen horizon — the policy's workday from today — and whether an edit is inside it — `frozenEdge`, `editInFrozen`;
  the player's order, shift or cancel inside it — a journal record with its price, the colleagues never edit inside),
  `commerce.ts` (with Б6е, commerce events between S&OP meetings: one to four a month on random workdays at 12:00 by
  their own branch — a big order of a customer, a SKU's batch ± a share, with its due, or a demand cut the market
  takes from the customer's next orders of the SKU (`cutOrder`); the sales head's journal record and the notice),
  `daily.ts` (with Б6б, the daily dispatch lists: at 08:00 each department's rows for the
  day — stages and kits by the schedule run cut at the day's end, packing by the line master's norm in the shifts of the
  line's people, the lab by the finite capacity of analysts on shift and instruments, shipments, supplier trucks,
  repairs, visits, the qualified person's decisions and deviation assessments due; every hour when a row started and, an
  hour late, what it waited for; at the next 08:00 the result — on time, later, not done; no rule reads them; kept 31
  days; the plan run's copy has none; which department a row waited for — `waitedFor`), `wms.ts` (truck,
  its check at the dock
  before unloading, unloading, receiving, putaway), `quality.ts` (true lot properties, the lab result, spec limits),
  `lab.ts` (sampling,
  lab tests by the spec revision in force when the sample was taken, the lot decision — a lot rejected without an
  investigation settles its deviation, a lot raised by the player),
  `docs.ts` (regulatory documents — specs, test methods, recipes, packaging instructions: revisions of one code, the one
  in force on a plant day, draft, in force or archived), `infer.ts` (the inference — a copy of Anamnez's: noisy-OR
  findings, the posterior over candidates, entropy and the expected gain of a step), `investigation.ts` (the scenario's
  incident — root and size by the seed, its traces in parameters, the mill screen and the lab test; an out-of-spec
  dissolution opens a deviation and an investigation, the lot waits; steps as tasks of their roles or lab tests — the
  retest of the same sample by another analyst; findings read from the plant's state; the conclusion — cause and fate,
  release only with a proven lab error; the quality colleague — lab first, then gain per hour — while the player does
  not hold the quality post; the debrief after the decision — `debrief`), `mes.ts` (batch orders on the recipe revision
  in force at their not-before, FEFO reservation with potency — tried without writing by `kitPlan`, with Б6ж a line with
  an analog taken whole from the analog by its factor when the main falls short for the line, shared with the
  schedule run, kitting through the airlock, stages in rooms with equipment and people, cleaning in two works — the
  equipment washed by those who work on it, operators, and with Б1е the machines of a line that touch tablets by the
  line's crew (`washRoles`), then the room by a cleaner by its floor area —, a room for a batch's work — a stage or,
  with Б1е, the packing — clean for its product, otherwise into cleaning (`roomFor`), process parameters — with Б1ж
  at the setpoints a stage takes when its batch takes the room, the fact at the setpoint with the operator's spread, the
  stage time and part wear by the turret speed —, true batch quality with causes, IPC, the bulk lot; with Б1д — the
  components of a stage loaded by the recipe and the
  mass at a stage's input, the batch mass less what later stages load (`stageMass`, shared with the schedule run,
  «Сейчас» and the reference); the packing job and its packaging kit — a container of it already
  in the line room is in place, whatever pallet it lies on; a stage stopped by a part
  failure and resumed after the repair; with Б1з a rejected bulk carried out of the bulk room by the storekeeper, as
  a kit's rest, and on to the rejected zone (`bulkOut`); a new not-before time of a batch order from the player —
  `shift`; with Б6а a batch order's due and purpose — the SKU's stock or a customer order — and its cancel before
  kitting, the reserve back to free stock (`cancelOrder`); room
  readiness, nominal stage time and cleaning time shared with the schedule run; new part budgets of a running stage for
  the plan run's twin — `stageRedraw`), `plan/schedule.ts` (the schedule run — a pure function: running tasks to their
  end, then kitting, stages and cleaning by the engine's rules and its own functions, with the player's draft changes
  and the draft's new batch orders as the `order` commands would place them, with Б6а without the draft's cancels; bars
  and the reasons why not earlier),
  `plan/twin.ts` (the plan run's twin: on a copy, forget what the plant does not know —
  true lot and batch properties, causes, part budgets, unrecorded jams, results before review, the incident not yet
  seen, marks no step has looked for — and redraw it from what was measured, the root of an open investigation from its
  versions; with Б6ж the real arrival of POs in transit and the dossier days not yet come; branches anew from the run
  seed), `plan/run.ts` (the plan run — a pure function: per seed a copy, the
  twin, the variant's commands, the horizon, the outcome — orders, batches, cash, OEE, load, general cleanings and line
  changeovers with their hours; per variant — lowest, median and highest over seeds), `line.ts` (the packaging line as
  flow between events: machines, buffers, micro-stops, camera rejects by count, codes in cases, FG pallets, changeover
  and line clearance — with Б1е before every job, the first too, and again after a cleaning of the line's room; a free
  line takes a job at once, the changeover goes on while its room is cleaned, the clearance waits for a room clean for
  the job's product (`roomReady`), the job holds the room from the first tablet and leaves it dirty with its product —,
  the crew, the end of a batch with
  reconciliation, the packing record — the people of its works and the line clearance before it, who cleared and who
  checked (with Б1д), the materials a job used by machine count at a moment — `usedByCount`, machine times for OEE —
  with Б1ж the blister machine runs at the speed the line took with the job, and OEE measures speed against the rated
  one —, a machine part failing at a flow boundary, jams of the cartoner; the flow at a
  moment between events without writing the state — `flowAt`, for the slice; new part budgets for the twin —
  `lineRedraw`), `qa.ts` (QA check of finished goods with
  retention samples, the qualified person's decision — «hold» blocks the FG and puts it on the racks, FG shelf life;
  the deviation impact assessment — tests linked by the cause records, `assess` by the quality post, the quality
  colleague by the same rule, release only with assessed deviations; with Б5е the probable cause named at the
  assessment — the player's from the causes with a sign or the rule's first, none — «не установлена»), `devclass.ts`
  (with Б5е, a deviation's class and repeat: the class at opening by kind — a low yield minor, the rest major; «без
  влияния» minor; a repeat within 12 months raises minor to major and never higher, «critical» only by the player, a
  class the player set the rule leaves; the same deviation — the same cause when both have one recorded, otherwise the
  same signature: kind, stage, parameter or test method, material; the probable cause — a cause of the base whose sign
  is in the plant's records: a stage parameter out of the recipe's range up to the deviation's stage, a part's wear at
  the stage at the procedure's threshold or above; the term by class — `dueOf`), `capa.ts` (with Б5е, CAPA: the
  catalog's actions that fit a deviation by its cause or kind and their thing — the worn part, the documents of the
  stage and the people who worked on it, the IPC or lab instrument, the supplier–maker pair of the lot —, their price
  from the records they touch (`capaOptions`); the `capa`, `classify` and `capaRun` commands; the QA head's rule in
  the head's hour — after an investigation's conclusion, after an assessment when the deviation repeated as many times
  as the QA policy says, after a failed check the next action of the chain, waiting while an action of the chain is
  unchecked; the executor — the head of the action's department in the first hour someone may decide, a held post's
  department — a proposal, a refusal kept with the engine's reason; «заменять раньше» lowers the part's replacement
  threshold to the procedure's sign threshold, at or below it by a step; the effectiveness check the procedure's days
  after it was done — «эффективна» or the first repeat after it; the late deviation's notice once),
  `market.ts` (customers and their orders, FG into circulation after the regulator publishes the batch, FEFO allocation
  with the residual shelf life, the FG stock at the start — `seedFg`, whole pallets and case picking, the customer's
  truck at 15:00, shipments with codes; with
  no free staging place, the docked truck is loaded straight from the racks; orders at risk — one rule for the meeting
  and the hourly alert, `orderRisks`), `cash.ts` (kopecks and ledger entries, dues by
  date, suppliers, wages twice a month by the time sheet — salary halves, night hours, overtime and work on a day off,
  the overtime of a cyclic shift's accounting period with the second half of its last month, a share of the salary by
  hours in the month of hiring, leaving or a vacation, the deputy's cover pay —, the settlement on the last day with the
  payment by agreement, the wages accrued but not yet paid and the compensation for unused vacation days, with Б4г —
  vacation pay at the bank hour three days before a part, the average daily earnings over twelve months × its days
  (`avgDaily`), contributions, energy, VAT by quarter, the credit line), `maint.ts` (machine
  parts, wear by work done — with Б1ж more per tablet for a stage parameter above its target (`stress`) —, failure by
  the hazard table of wear, repairs and planned replacement by the mechanic with a
  spare from the workshop, spares replenished by level, the maintenance policy, `maintain`), `lean.ts` (losses per day
  by kind and department: waiting tasks by cause, a truck waiting for the dock, transport and walking, defects, room
  cleanings — general and minor — and line changeovers with their work; a line's
  day — machine times, rated output over loading and working time, good tablets — and `oee()`; a batch's time by state;
  the line master's shift task — opened and closed with the crew's shifts — and the rhythm coefficient; with Б1и the
  room accounting — seconds a day of each production and packaging room working, cleaned and set up, held by a batch
  without work, dirty and free, spans closed every hour, a full day 86 400 s — and the good packs of each hour of a
  shift task; with Б1к a batch's time by state at its place — the room of its stage or line, the lab, the QA room where
  the qualified person's post is, the warehouse; its own «не раньше» has no place — by days, spans closed every hour,
  `placeOf`), `modes.ts`
  (with Б1ж, setpoints: of a stage parameter by the recipe code, stage and parameter, of the blister machine speed by
  the packaging instruction code; within the range of the revision in force and a whole number of steps from the target,
  otherwise the `setpoint` command is refused; none — the target; the turret speed scales the recipe's rate
  (`unitsPerHour`), a line machine's run speed (`machineSpeed`), micro-stops and camera rejects by speed
  (`fastFactor`); the quality colleague holds the targets — the player left the quality post, the setpoints are gone),
  `tasks.ts`
  (tasks and the dispatcher: people,
  vehicles, instruments; why a task waits; a person walking to a post is free and measured from where they are; only a
  person admitted to everything the work and the vehicle need takes it, otherwise the task waits «нет допуска» with the
  document; a person takes it only if, with the walk and its norm (a stage with its largest spread), it fits the rest
  of the shift and the overtime still allowed, otherwise «нет часов»; a deputy takes the work of the absent's role in
  their own shifts, and with nobody of a role on shift because of a vacation the task waits «в отпуске»), `hours.ts`
  (working time by law: the time sheet by days from the person's shifts, a night shift split at midnight — work, night,
  overtime at two rates, work on a day
  off or a holiday; overtime limits per shift and per calendar year; the
  fit rule shared with the schedule run; the department policy «Сверхурочные», `overtime`; the notice when the year's
  overtime runs low), `workdays.ts` (the production calendar of the scenario's profile; five-day shifts live by it, a
  short day ends an hour earlier), `shifts.ts` (schedules: with Б4б, cyclic ones — a pattern of day, night and off days
  from a start day with a crew offset, a night ending the next day; a pattern's checks — no two shifts in a row, 42
  hours of weekly rest; a person's shift on a day, one for the dispatcher, the schedule run, the line, the time sheet
  and the pay, none on the days of a vacation part (`graphSpan` — by the schedule alone) — transfers from the 1st of a
  month at least a month ahead, the first shift of a new schedule dropped if
  it starts no later than the old one ends, extra days off so a cyclic schedule plans no overtime — by the end of each
  month its hours without holiday hours within the norm since the start of the accounting period, whole shifts spread
  over the month; the `roster` command; at midnight of a period's first day — its overtime, worked minus the norm less
  the schedule's hours that fell on a vacation, into the pay of the second half of its last month, the rest back to the
  year's overtime), `quals.ts` (admissions: the
  training matrix — the roles of each procedure and test
  method, the same for all
  revisions of a code; what a work needs to know — procedures of its task kind and of any work, the equipment and IPC
  methods of a stage, the machines of a line, the method of a test, a vehicle's procedure; what a person learns — the
  rows of their role and of their related professions (`rowsOf`); a person knows a document on a day — a record on the
  revision in force or newer, not expired; which revision to learn and when — `ahead` days before a
  new revision or the end of a record), `train.ts` (training: start records spread by a hash of person and code up to
  `spread` days back; at midnight — a notice for an admission lost and a task to study at the person's post; the
  knowledge check by the QA specialist or the QC head, never the trainee; the record with the check's day; a related
  profession, with Б4г — the `also` command: tasks to study what the row of its role needs and the person lacks; off —
  the records stay to their term, the tasks go), `staff.ts`
  (whether a person may take a task at a moment and when their shift ends — by the person's shift (`shifts.ts`), shared
  with the schedule run; a free
  person walks to the post of their role, and to the exit 15 minutes before the end of the shift; where they are on the
  way; off-shift people leave through the entrance), `hire.ts` (hiring and dismissal, with Б4в: the scenario's labor
  market by role; a vacancy by an ad — candidates on Monday at 09:00, the ad paid by the week — or through an agency —
  an experienced candidate after its days, the fee on hiring; a candidate looks for work only so many days; hiring — the
  medical exam on workdays at the plant's cost, the first day — the first shift of the vacancy's schedule after it, the
  next personnel number, training at once, the trial; with 0.0.65 a vacancy in place of a leaver is their place — the
  hire takes the leaver's related professions and learns their rows from the first day; dismissal — by agreement today
  with a payment, a failed trial in three days and only within the trial, by own wish two weeks after the application,
  «let go earlier»; turnover; the
  person leaves after the last shift, the vacation parts after the last day dropped and the parts they deputized for
  given to the next deputy; the colleague of a post the player does not hold opens a vacancy for each
  application and hires the first fit candidate — an agency at once for a role no ad finds, the price within the
  market's for the skill; with Б5в, relocation for a role no ad finds — a candidate after its days, the arrival after
  the notice at the old job and the road, the move paid on hiring), `leave.ts` (vacations, with Б4г: the law's numbers
  in the profile, the scenario's rule of the draft; a year's vacation schedule — the draft by HR on the first workday
  of December at 09:00 by the rule
  (`placeDraft`, shared with the content build): parts from a Monday, the first in summer, people of one role apart, a
  person and their deputy apart, at most so many of a department at once, a part on the week of its window where it
  hinders nobody and the fewest days of others' parts fall; edits by the department's post or the director, the
  approval on 17 December or the last workday before it, then a move by agreement no closer than two weeks; the notice
  two weeks ahead; away and back at midnight; a deputy — the first by personnel number with the related profession of
  the absent's role, of the same shift if any; with 0.0.65, once a role gains someone with its related profession,
  the parts of its people without a deputy get one by the same rule from the next day (`deputyCame`); who covers whom on
  a day; days earned and used, the compensation days;
  the `leave` command), `journal.ts` (with Б5а, the decision journal: a record for each decision a rule makes for a
  department head — the head by position, what was decided about which thing, the reason with the plant's numbers and
  never the truth; the player's command of the same kinds — «you» with the place it came from; a colleague's command —
  the record of its head; a scenario's or a refused command — none; no rule reads it; records older than the term go
  at midnight; the plan run's copy starts without it; with Б5б a proposal is a record with its command and its answer),
  `heads.ts` (with Б5б, the department modes: a head with choices «сам», «советует» or «вручную»; by default the
  departments of a held post advise, the director's and all without places — «сам»; the player's choice is remembered; a
  proposal — a journal record with the same rule's reason and command, one open per thing: a new one makes the old
  «устарело», a rule no longer firing — «не нужно», a declined command not again until midnight; «Принять» — the command
  from the player's place, checked anew, its decision in the proposal's record; «Отклонить» — no command; a post
  released or a mode changed — open proposals stale; the QC head's, the qualified person's, repairs and dated
  decisions — by rule in any mode; the `mode`, `accept` and `decline` commands), `bosses.ts` (with Б5в, the heads as
  people: the head of a department is the first working person of its role by personnel number; decides in their own
  shift, away or vacant — the deputy «и. о.» in their shift with their skill, the qualified person only by another;
  nobody — the rules wait and «Некому решить» once; a rule of a head's hour runs once a workday from that hour when
  someone may decide (`dueRule`); skill 4–5 the whole rule, lower — the limits of §8.5 (`coverBy`, `thresholdBy`,
  `replacesBy`, `hireMinBy`); the six new heads paid with the overheads (`PAID_LATER`); a scenario without `heads` keeps
  heads as positions; the `deputy` command), `memos.ts` (with Б5д, service memos: a command of another department's
  post — the `memo` command to the head of the command's department, a journal record «you» with the place; the
  answer in the head's hour — an hour later if the memo came in their working time, otherwise an hour after it starts;
  the commands run as the head's own through the same engine — passed, the head's record «по записке»; refused, the
  engine's reason in the answer; no memos about the decisions of QA and the qualified person, policies and modes;
  `withdraw` before the answer), `forks.ts` (with Б5д, «Просят решить»: a visit holds a batch, a part replacement
  before a machine's work, who leads an OOS investigation — asked by whoever decides for the head now, to the fork's
  post or the director, with each answer's price from the plant's norms and records; no answer in two hours or the
  fork settled itself — «as now»; the `answer` command — the head's command from the player's place, checked anew;
  after every event, but the batches are scanned for a machine's next work only when one work could bring the part to
  the threshold — a bound from the recipes),
  `kpi.ts` (with Б5ж, the heads'
  indicators: 52 definitions with Б6ж — the head, unit, direction, month or rolling 12 months, source keys, the
  counterweight —,
  each a pure function of plant
  records over a period and never of truth; the midnight snapshot of what records do not keep — stock at lot price, FG
  packs, receivables and payables, taken places, people without full admission — summed per month; at 00:00 on the 1st
  the month's results written into the state and never changed, the month's kWh taken before cash resets the meter;
  the same functions for the window, the meeting and the post's summary — `kpiValues`, `kpiPick`, `sincePeriod`),
  `policies.ts` (with Б5г, the heads' policies — the numbers and rules a head decides by in his hour: in the plant's
  state the player's values by the policy's key, of a part or a spare for a policy «of each», and the history of
  changes; no key — the scenario's record; kinds, ranges and steps in `content/policies/`; the `policy` command of the
  head's department post or the director — out of range, off a step or the same value refused, a journal record «you»
  with the previous value, the head's open proposals stale; rules read it in their hour, a reason names it),
  `waste.ts` (with Б1з, the removal of rejected material: the
  `waste` command of the «Снабжение и склад» post — the contractor on the next workday at the start of his hours; by the
  warehouse head's mode (Б5б), the warehouse colleague at 09:00 on a workday when two thirds of the zone's places
  are taken or a pallet waits longer than the term; one removal at a time; the contractor's truck docks at the out dock
  like a customer's, a busy dock — it waits in the yard to the end of his hours and comes again the next workday; all
  that lies in the zone when it docks is loaded, the QC head signs the handover; the bill — the trip and the pallets,
  VAT to deduct; the waste log; containers and pallets leave the stock, the lot stays), `seats.ts` (the player's
  places — the director and four posts: whose each command is — a
  transfer, a vacancy, a hire, a dismissal, a vacation part or a related profession is the post of the role's
  department —, with Б5б a mode is the post of its head's department and an answer the post of the proposal's or the
  director —, the `seat` command, the log of places; a player's command of another's post is refused),
  `batchno.ts` (the batch number `PPNNNMMYY`: the short `PPNNN` when the batch record is issued, month and year when the
  first mixing starts; a count per product code from 1 January and after 999 again from 001, skipping numbers still held,
  so a full number never repeats; one integer in the slice), `alerts.ts` (the hourly alerts — a supplier truck still not
  unloaded 2 hours after arrival, a batch order still waiting for material at its not-before time and a packing job short
  of it at once, a new customer order at risk by the meeting's rule; one notice per thing in the hour its threshold
  falls, no state of their own), `places.ts` (the places of the plan by ISA-95 — site, areas, work centers of their kinds
  and place codes; what stands where; the storage zone of a room and its sensor; whether a zone's regime lies inside a
  material's; racks or the cold room for a material), `assets.ts` (physical assets — inventory numbers by place order,
  qualification and calibration records with the acceptance day and the last day in force, start records by a hash
  within the interval less the warning period; why an asset takes no new work — no record in force or a contractor visit;
  the techservice colleague books a visit at 09:00 on a workday for the next workday; the contractor starts in his hours
  once the asset is free, the bill on the visit day, the acceptance by the QC head or the QA specialist; a pallet stored
  only in a zone whose regime fits and whose sensor is fit; what holds a stage or a line; with Б5г «Перенести визит» —
  the `visit` command: a workday from tomorrow to the last day of the record in force, a running visit refused; with
  Б6б the visits without writing — booked ones and the techservice colleague's rule — `visitPlan`),
  `partners.ts` (makers and
  suppliers — the maker itself or a distributor; approved supplier–maker pairs from the material spec in force; pair
  approvals with a term, start records by a hash, not before the pair entered a spec; the quality colleague books an
  evaluation at 09:00 on a workday — an audit at the maker by a third-party auditor, the bill with the report, or a
  documents review — and the QA specialist reviews it; a pair whose approval lapsed is suspended, nothing is ordered
  through it; the quality agreement in force; framework contracts — the contract price up to the promised volume, the
  list price beyond, at the end a clawback for a pair bought below the promised share by value, and a new contract;
  supply contracts of customers extended; with Б6ж a candidate pair of an API spec — the second maker not in the
  dossier — and the `pairApprove` command of the quality post or the director: the documents review by the QA
  specialist, the trial lot — the smallest lot through the candidate pair, released by QC and blocked until the dossier
  decision —, the maker audit, the type II dossier variation filed on the review day with its expert request, answer and
  decision by the scenario's terms on its own branch, the pair in the spec from the decision day (`livePairs`), the
  trial lot released; no framework contract with it — the list price; the on-time share of a pair by its POs over 12
  months (`onTimeOf`), the offers of the approved suppliers with their weighted score (`offersFor`) and the supplier
  of an order by the policy «кому заказывать» — the main, faster when the main would be late, or by the offers
  (`choosePair`)), `invariants.ts`.
- **Golden fingerprint** (`tools/test/golden.test.ts`): any change of engine behaviour changes it. If the change is
  intended, record the new fingerprint and say in the commit what changed in the plant's life.
- `src/sim/` — the calculation thread: protocol, host (`createSim`; a `tick` carries the notice kinds of the player's
  autopauses, and the thread stops right after such an event — the plant's clock on its minute, the rest of the game
  clock dropped), packed slice (`pack.ts`, format 7: rooms, trucks with their open body, changed pallets, tasks in
  progress, people with their walk to a post, vehicles, lines with their machines, equipment, and whether a machine or
  equipment is in calibration or qualification; no truth fields — not the next micro-stop, not a part's budget), views
  for panels — the warehouse and the card of a thing with what a pallet holds, with Б1е a room's cleanliness — clean
  for which product and until when, or dirty after which product and which cleaning it needs, only for a room of a
  stage or a line — and a line machine's job
  waiting for the room's cleaning, with Б1ж the blister machine's speed — rated, the job's and each SKU's setpoint —,
  built here on request and sent with the slice only when they changed, without truth
  fields (`views.ts`); the deviation card — with Б5е its class, the probable cause, the causes with a sign, its CAPA
  with their check and the catalog's actions with their thing, executor and price (`capaRow`) —, the batch decision at
  release and
  the stage parameters of a room or equipment card with their setpoints, and with Б1ж the setpoints for the next stage
  of each recipe in force whose stages run there — `knobsAt` (`devs.ts`); with Б1д, the batch record — what was
  weighed by lots, who weighed and who checked, what each stage loaded, mass in and out, with Б1ж each parameter's
  setpoint and fact, the packing with the line's people, the
  clearance and the reconciliation, deviations and decisions —, what is inside equipment now and a line machine's
  materials, records of the plant without truth (`dossier.ts`);
  the plant reference — how it should be by master data
  and how it is: products and SKUs — with Б1ж a SKU's blister speed —, recipes with stages by plan and by the stage
  records — with Б1ж the setpoints next to the targets and the stage time at them —, equipment and the line,
  instruments and methods, roles and shifts, suppliers and customers, materials with their OKEI unit codes and the spec
  in force, every document revision with its status by the plant date, without the model's hidden parameters, start
  moments of running work as numbers (`ref.ts`); what is going on now — running work by department, one row per work,
  with the plant's norm and never the engine's drawn duration, a deputy's work with «за» and the absent's role, a kit
  trip with its material and lot, with Б1ж a compression's turret speed with the norm at it and at the recipe target
  and a packing job's blister speed (`now.ts`); the 08:00 meeting — the player's places over
  their tenure, yesterday by calendar day with its cleanings and changeovers, events of the 24 hours before it, what
  waits now, with Б1ж the setpoints off target and since when, from a day of play on — what the plant did this session
  («За эту игру»), with Б5е the deviations' class and «срок прошёл» and the «CAPA» block — open, of the day, checks of
  the day and of the week — the cash panel and the top-bar cash with the player's places (`report.ts`); the places and
  assets — the «Места» tab, an asset in a card, the meeting's calibration and qualification, which batch waits for
  which asset —
  records and visits are the plant's knowledge (`places.ts`); the partners — makers, pairs with their approval and
  evaluation, agreements and contracts in force for the «Контрагенты» tab, the meeting's suppliers, a lot's maker and
  contract, with Б6ж candidate pairs with their approval step and the days come, a pair's on-time share (`partners.ts`);
  the lab queue and the X–Rm control chart of the in-process
  average tablet mass with its limits and special-cause signs, a lot under investigation and its steps' tests
  (`lab.ts`); the investigation board — what happened, participants, steps, findings, versions from the findings only,
  whether release is proven, the debrief only once concluded, with Б5е the CAPA of its deviation (`inv.ts`); working
  time — the month's time sheet of a person's card with its totals and the year, «ОТ» on vacation days, the accounting
  period of a person on a cyclic
  schedule, the calendar of
  twelve months, the schedules of this and the next month — by schedule and by role, department policies, the meeting's
  «Рабочее время» with transfers soon in force and the crews' extra days off — records are the plant's knowledge
  (`hours.ts`); with Б6а, the batch orders — a row per order with its purpose, due, state in words, the expected
  release by the schedule run and the median tail of batches released in 90 days, lateness by due, and the customer
  orders the FG will not cover by their due — free FG and what the orders bring into circulation — for the «Задания»
  tab and the meeting (`jobs.ts`); with Б6б, the launch plan — SKUs by days for 31 days: batch orders by their
  not-before with the draft, the planning head's rule, contractor visits to stage equipment and line machines and the
  days off, only while its tab is open (`launch.ts`), and the daily lists — rows with the names of their things, a
  department's result and whom it waited for longest for the meeting, the marks of schedule bars and today's rows of a
  room, equipment or line machine card, «после суток» from the plant's records (`daily.ts`); with Б6в, the forecast —
  the grid of SKUs by 18 months with the planning and sales forecasts and an edit with what the method gave, «прогноз
  против факта» of a SKU, a product or all — ordered cases and lag forecasts back, forecasts ahead —, the error of
  planning, sales and each method, only while its tab is open, and the meeting's block on the first day after a month
  close (`forecast.ts`); with Б6г, the S&OP window — the shown plan, the best plan and «до лучшего плана», demand,
  capacity with the reserve line and the bottleneck, stock days by SKU with their flags, the cash for three months,
  people under the plan — and the meeting's block, the projection on the plant's records (`sop.ts`), a costly view not
  rebuilt on the same moment (`VIEW_SLOW` of `views.ts`); with Б6д, the materials — the «Материалы» tab: the
  requirements as they are, the POs in transit by arrival with what «Ускорить» and «Отменить» would give or why not, and
  the meeting's block — planned orders due today or earlier and POs in transit that will be late; a costly view too
  (`mrp.ts`); with Б6е, the plan edits — the meeting's «Правки плана»: commerce events and the edits in the frozen
  horizon of the 24 hours before it with their price — records of the plant (`edits.ts`); people and admissions — a
  person's admission
  today and what they are losing within the warning period, training rows of the card, the training matrix of the
  reference with how many people of a role are admitted, and of other roles by the related profession, the meeting's
  summary — records are the plant's knowledge, not truth (`people.ts`); hiring — the staff by the scenario and now,
  vacancies with their candidates and the days of a hire today, the hired before their first day, the former, the
  meeting's «Люди» — candidates as they came, records of the plant (`hire.ts`); vacations — the schedule of this and the
  next year by people and weeks with what hinders it, a person's days earned, used and left, the parts with their
  deputies and whom one may choose, whom a person covers, the meeting's away, leaving soon and back — records of the
  plant (`leave.ts`); with Б5а, the decision journal — pages newest first, filters by post and author, the numbers
  and codes of a record's things, «Кто решил» of the cards and the batch record, the meeting's decisions of the day by
  head, with Б5б «Ждут вашего решения» — open proposals with their reason and whether the player may answer — and the
  mode bar of the held posts, with Б5д the «Записки» — when the head answers and the answer —, questions with each
  answer's price, memos and forks in «Кто решил» and the meeting's «Записки и вопросы» — records of the plant
  (`journal.ts`); with Б5б, the «Заказ поставщику» window — suppliers
  with an approved pair, their materials with the smallest lot, the container and the contract or list price, the
  plant's answer to the draft and the supply rule's orders for «Предложить» (`po.ts`); with Б5ж, the indicators — tabs
  of the places, held ones first, the heads' rows of the current or a chosen closed month with last month, 12 closed
  months, better or worse by direction — a sum of the month per day —, «Почему?» — the records behind a number with
  their links, and the meeting's «Итоги месяца» on the first meeting after a close, with Б5г a head's policy changes at
  the bars of their months and of the window's month (`kpi.ts`); with Б5г, the policies — tabs of the heads, held posts
  first, a policy's value, range and step, who set it and when, how many journal decisions of 30 days read it, the
  departments' overtime (`policies.ts`); with Б5в, the heads — who decides today, the deputy and whom to appoint, what
  the skill limits, for «Люди», a person's card and the meeting's «Руководители» (`bosses.ts`); with Б1и, the floor —
  rooms and line machines over today, yesterday or
  seven days, the key machine and OEE by the meeting's `lineSum`, the plan-vs-actual board of the shift by hours, the
  batch a held room leads to — records of the plant, and with Б1к the hours batches waited at each place over the
  window with its main word, the batches waiting now and «держит линию» (`floor.ts`); with Б1к, the andon — what is
  not working now by thing: a failed part, an asset without a record in force or with the contractor, a cleaning a batch
  waits for with the stage operators on shift and no cleaners, a task waiting for an admission, hours or the end of a
  leave, a supplier truck not unloaded for 2 hours, a batch without material at its not-before, an order at risk — with
  the weight of its notice, one icon per thing (`andon.ts`); with Б1з, the rejected — the zone's places and the
  lots on them, pallets waiting for a place, the removal and the waste log for the meeting, the rejected room's card and
  the batch record — records of the plant (`waste.ts`); the schedule — the Gantt of the past, the running and
  the schedule run
  with the player's draft —
  new not-before times and new urgent batch orders, the old bars of what the draft moves, and the ghost of a dragged
  batch order, with Б6е the edge of the frozen horizon and the draft's price (`plan.ts`), Web Worker (`worker.ts`) and
  its client in the window (`client.ts`; how far the window's
  clock ran ahead of the last slice; at most one `tick` in flight); the plan run's own thread — a second Web Worker over
  the same engine (`planHost.ts`, `planWorker.ts` → `dist/plan.js`; with Б5г the progress after each seed) and its
  client in the window (`planClient.ts`; a stop terminates the thread). The window never runs the engine. Saves cross
  the thread boundary as a string: the window never parses the state with the true lot properties — the plan run gets
  the same string.
- `src/app/` — the game in the window: content, stage, clock and speeds with live time 1:1, input, panels (`game.ts`,
  `main.tsx`); what the slice puts on the floor — pallets, trucks, rooms, pallets on forks (`scene.ts`); where people
  and vehicles are now — a pure function of the tasks in the slice and the clock, on the plan's routes and with the
  engine's travel times, free people on their way to a post too, and the work icon of each busy person (`movers.ts`);
  the start preset — the frame measured on medium at first run, low if slower than 33 ms, the result and the player's
  choice kept in the window (`preset.ts`); the autopauses — which notices stop the world, whose post each is, the ones
  switched off kept in the window, where a click on a notice leads, with Б5б a head's proposal before the meeting
  waiting for it (`pauses.ts`); which «Сейчас» row is the work of a thing in the card (`watch.ts`); the levers of
  meeting rows — decisions, whose post, «будет в …» (`levers.ts`); the
  first-event explanations understood, kept in the window (`firsts.ts`); the models from Blender — one file of all the
  machines loaded once before the stage, a machine its node — and the «Модели» switch of the debug panel (`art.ts`);
  trucks in the yard — backing in, waiting, driving off, a picture only (`yard.ts`); what is under the cursor — people
  by their point on screen, pallets, machines and trucks by the camera ray, the room by the floor (`pick.ts`); pallet
  moves between zones seen from the slice, their rates, arrows and the fill of warehouse places, people moving between
  rooms for the «Потоки — люди» layer (`flows.ts`); with Б1и the layers on the left and L, where the load columns and
  the boards stand, part heights as shares of the window, the number over each column, the board rows, the palette,
  and with Б1к the bottleneck plates over the three places and the machine that holds the line, the point over a room,
  the andon icons over things and the boxes of all these marks for clicks (`floor.ts`); the scene bench, a copy of
  Bolnitsa's, with `--layer load` also with the layer on (`bench.ts`,
  `stats.ts`).
- `src/render/` — the 3D view: renderer, light, camera, post-processing and GPU timer (copies of Bolnitsa); the plant
  from the plan (`layout.ts` — rooms, walls, doors and spots from `planOf`), floors, zone markings, ground and yard,
  walls with the cut and openings (`world.ts`), doors, lamps and floor textures (`doors.ts`, `lamps.ts`, `textures.ts` —
  copies of Bolnitsa, adapted), racks and pallet loads by instancing (`loads.ts`), trucks — closed body before the check and when leaving (`trucks.ts`), room
  status signs (`signs.ts`), equipment and line machines as models in code from their records' `model` parts, with
  status lamps and icons, rotors, covers, belts and buffers (`machines.ts`; the lamp of each state, belt speed and
  buffer fill — pure functions in `flow.ts`; with #109 a record type with a model from Blender takes its node in the
  shared .glb and in it the node of each named part, rotor, cover and reels in their pivots, the lamp on a pole —
  `lampAt`), what `assets/models/index.json` lists from Blender and a node's name as in the file (`nodeName`) — shared
  with the scene for Blender and the tests; room light is not baked, by the owner's decision #112 (`blender.ts`), the
  pallet truck and the reach truck in code (`vehicles.ts`), the detail
  level by speed and camera height with its soft change (`detail.ts`), the site layer — arrows above the walls and the
  fill of places (`overlay.ts`), colour checks — colour-blindness simulation, ΔE and icon contrast (`color.ts`), the
  outline of the selected thing (`select.ts`), the work icons — paths shared by SVG and canvas (`taskicons.ts`) and the
  icons above heads, one instanced draw call (`badges.ts`), the «Загрузка и OEE» layer — column parts, full-height
  frames, numbers and plan-vs-actual boards in four draw calls (`floor.ts`), the «Узкие места» plates in one draw call
  (`plates.ts`), the andon — icons and words in two draw calls (`andon.ts`) with the pictograms and weight colours
  shared by SVG and canvas (`andonicons.ts`), people
  — Bolnitsa's crowd on the GPU (`bake.ts`, `people.ts`, copies) with looks and clothes by role (`cast.ts`), the
  composition (`stage.ts`).
- `src/ui/` — panels (React) and their store: the top bar with «До утра», «До события» and the latest notice — the one
  the world stopped on marked «❚❚», a click leads to its place (`App.tsx`), the autopause menu (`Pauses.tsx`), the
  warehouse (`Stock.tsx`), a guard around each panel and the top bar — an error stays in its place
  (`Guard.tsx`), the card of a
  thing — what it is, state, why, what can be done, history; a person's dismissal (`Card.tsx`), the plant reference with
  its tabs, sortable columns and search, hiring in «Люди», with Б6ж «Одобрить пару» of a candidate pair in «Контрагенты»
  and a recipe line's analog (`Ref.tsx`, F1), the vacation schedule in «Люди» and the
  vacation block of a person's card — parts, deputies, the related profession (`Leave.tsx`), the decision journal —
  the right panel, J, a row with its reason in words, filters and pages, and the «Кто решил» rows with «Почему?», with
  Б5б the proposals with «Принять» and «Отклонить» — in the journal, the meeting and the card — and the mode bar
  (`Journal.tsx`), the «Заказ поставщику» window from the warehouse panel — supplier, lines, «Предложить», «Отправить»
  (`Po.tsx`), the indicators window — K, tabs, tiles with 12 bars, the formula and source on hover, «Почему?», the
  month arrows, with Б5г the dashed day of a policy change (`Kpi.tsx`), the «Политики» window — P, tabs of the heads,
  rows with «−» and «+» or options, the draft, «Прогнать» on 13 weeks and 5 seeds with the progress by seeds and
  «Стоп», «Применить», «Сбросить» (`Policies.tsx`), with Б5в the head's block of the card — the skill limit in words,
  who decides today, the deputy with «Назначить» and «Снять», the department's indicators — and the meeting's
  «Руководители» (`Bosses.tsx`) and its pure rules — a value in words, the next one by a step, the
  draft's commands (`policy.ts`), the layers menu on the left with the window and the legend, the column tooltip and the
  card's «Загрузка» block (`Layers.tsx`), quality attribute and
  process parameter
  values in words (`units.ts`), what is going on now with «Смотреть»
  (`Now.tsx`, N), the 08:00 meeting (`Morning.tsx`), the cash
  panel (`Cash.tsx`), the lab queue and control chart (`Lab.tsx`), the schedule window with dragging, the draft, «Прогнать
  план» and the run's outcome per variant, with Б6е the frozen band, its edge and the draft's price (`Gantt.tsx`), with
  Б6а its «Задания» tab — filters, rows, «Отменить» into
  the draft, «Полосы», the uncovered orders with «Срочное задание под заказ» (`Jobs.tsx`), with Б6б its «План запуска»
  tab — the grid of SKUs by days, the dashed rule, a cell's contents, «Поставить сейчас», with Б6е the frozen days
  (`Launch.tsx`), with Б6в its
  «Прогноз» tab — the method and demand policies, the grid, a cell's edit and its removal, «прогноз против факта» with
  the error table and «Таблицей» (`Forecast.tsx`) and the chart's pure rules — colours, ticks, places (`fcchart.ts`),
  with Б6г the S&OP window — O, the plan grid with a choice per cell, «Утвердить», «Сбросить», demand, capacity, stock,
  cash and people under the plan (`Sop.tsx`), with Б6д its «Материалы» tab — the grid of materials by kind and 12
  months with the net in red, a cell's tooltip, planned orders by supplier with «Заказать» — the «Заказ поставщику»
  window with the lines due within a week —, POs in transit with their messages, «Ускорить» and «Отменить», with Б6ж a
  planned order's «Предложения» with «Заказать», «не пришёл» and why a supplier was picked
  (`Materials.tsx`), with Б6е an edit's price in words — cleanings with hours, changeovers, batch orders later
  (`price.ts`), the meeting's
  «Сменно-суточные задания» block and a card's rows of the day (`Daily.tsx`), the draft's pure rules — a row per batch
  order, gone once kitting starts, `shift` commands on approval, with Б6а the cancels, with Б6б an urgent order on a
  day (`draft.ts`), the
  «Кем вы будете» screen of places (`Seats.tsx`), the investigation board — steps, findings in words with numbers
  from the records, version bars, the decision, the debrief, with Б5е the CAPA after the conclusion (`Inv.tsx`), the
  batch record over the other windows — opened from a
  card, «Сейчас», the meeting and a click
  on a batch bar of the schedule (`Dossier.tsx`), the rejected room's block of the card — the zone's places, the
  removal, the waste log (`Waste.tsx`), the levers of a row (`Levers.tsx`), the deviation card, the batch
  decision, stage parameters, with Б1ж the setpoints with «−» and «+» and a blister machine's speed, and
  the first-event explanation in the card, with Б5е the class with «Сменить класс», the cause, the signs and the cause
  chosen at the assessment, the CAPA rows with «Выполнить» for a held post's department and the catalog's actions with
  «Назначить CAPA» (`Decide.tsx`), CAPA and deviation words — class, cause, action, its thing and price (`capa.ts`),
  with Б5д a button of another's post — «Записка: …» with whom and when, or dimmed with why (`memo.ts`), status and
  work icons (`icons.tsx`), asset words — class and
  inventory number, the work's name, «until» and why it does not work
  (`assets.ts`), the content base for names (`db.ts`); `src/i18n/` — every player-facing string, Russian
  and English, and number, quantity, money, duration and date formats.
- `src/content/` — content types and the built bundle loader; `content/` — the game database in YAML (with part 4 —
  `investigations/`: the investigation model — candidates, findings, steps; with Б3б — `sops/`: procedures with the
  document header, the works they are needed for, the roles that learn them, hours to study and the term in months;
  with Б3в — `regimes/`: storage regimes of the pharmacopoeia, a temperature range and the highest humidity; with Б3г —
  `makers/`: fictional makers in real countries, and `agreements/`: quality agreements `QAG-` with the document header;
  with Б4б — cyclic schedules in `shifts/` and the scenario's accounting period in months; with Б4в — the scenario's
  labor market `labor`, the terms of the labor law in the profile and the plan's cleaning seconds per m² by grade; with
  Б4г — the vacation numbers of the law in the profile, the scenario's rule of the draft `leave`, related professions
  `also` of the staff rows and `same` of a role only another person of it replaces; with Б1д — the stage that loads each
  line of a recipe's composition; with Б1е — the minor and general cleaning of a line machine that touches tablets; with
  Б1ж — a parameter's setpoint step, the turret speed of compression, a part's load by a parameter (`stress`), a cause's
  IPC scatter, a line machine's rated speed and the blister machine's speed factors (`fast`), a SKU's blister speed;
  with Б1з — the scenario's contractor `waste`: his hours, the minutes of the handover signature and the prices; with
  Б5г — `policies/`: the heads' policies — the head by the id, the kind, range and step, «off», of each part or spare;
  with Б5е — `capa/`: the CAPA catalog — what an action does, its executor's head (training — the head of those taught),
  the cause classes and deviation kinds it fits, its place in the QA head's rule — and the scenario's `deviations`: the
  terms by class, the sign threshold of wear, the check's days and the repeats before a CAPA; with Б6в — `seasons/`: a
  product group's index of each month, and the scenario's `forecast` — the sales department's optimism; with Б6г — the
  planning head's policy «резерв мощности» and the scenario's `plan.reserve`; with Б6д — the supply head's policies
  «срок завоза» and «как заказывать» and the scenario's `supply.arrive` and `supply.how`; with Б6е — the planning
  head's policy «замороженный горизонт», the scenario's `plan.frozen`, the price horizon `plan.price` and the commerce
  events `commerce`; with Б6ж — a supplier's lateness `late`, a spec's candidate pairs `candidates`, a recipe line's
  analog `alt`, the second makers of the APIs with their suppliers and agreements, maize starch, the supply head's
  policy «кому заказывать» and the scenario's `supply.who`, the offer weights `supply.rfq` and the dossier variation
  terms `partners.variation`);
  `tools/content/` — its build and validator (schema, ids from paths, references, source keys from `docs/10-domain.md`;
  material codes by kind and document headers — unique, revisions of a code on different days, in force at the start;
  the training matrix — every role the engine gives a work is in the row of each document the work needs, revisions of a
  code share roles and works, start records younger than the shortest term; a cyclic pattern without two shifts in a row
  and with 42 hours of weekly rest, the accounting period a divisor of the year, a study or a stage no longer than the
  shortest shift of any schedule; a labor market row for every role of the staff, shares adding up to a whole, the
  trial within the profile's limit, cleaning seconds for the grade of every room with equipment; the vacation rule —
  dates of the year, parts adding up to the year's days with one no shorter than the law's, the approval no later than
  the law's term before the year; a related profession — a role of the base, not one's own and not a `same` one; the
  draft of the start staff fits whole (`leaveErrors`); every line of a composition loaded on a stage of its recipe after
  dispensing, the API and another component on the first mixing; with Б1ж a parameter's target inside its range and a
  whole number of steps from both edges, a part's load by a parameter of a stage run on its equipment, a cause's scatter
  only from a parameter, a SKU's blister speed within the machine's rated one; with Б1з the contractor's hours within
  the day and his prices above zero; plan rules in
  `plan.ts`: doors on walls, docks on outer walls, class D only through
  airlocks, reachability, posts on
  walkable floor; models in
  code — parts inside the footprint, round cylinders, upright hoppers, items only on belts: `modelErrors` in `load.ts`;
  places — codes by format and unique, a room in one area, a thing on a work center of its kind in its room's area, one
  verified sensor per storage zone, an IPC instrument for each stage test in the stage room, a zone for every material by
  its regime, contractor works within his day, the warning period shorter than the shortest interval: `placeErrors`;
  pairs — every revision of a starting or packaging material spec has a pair its supplier sells from that maker, every
  pair of the start has a quality agreement in force: `pairErrors`; with Б5е the CAPA catalog — one action per work
  the engine does, a head for all but training, the QA head's rule order unique among the actions of one cause class;
  with Б6е the price horizon no shorter than the largest frozen horizon in calendar days, the commerce ranges' «from»
  no more than «to»; with Б6ж a lateness share of 0–100 % and its «from» no more than «to», an analog — an excipient
  of the same unit, not the main itself and not another line, none on a potency or «до массы» line, a candidate pair
  only of an API, sold by its supplier from its maker, not an approved pair, with a quality agreement in force at the
  start, the offer weights adding up to 100).
- `blender/` — Python scripts for Blender in the background (#109; by the owner's decision #112 — a mix: silhouettes
  of every class in code, a detailed model from Blender for the machines seen up close, AO only on static parts, room
  light not baked): `lib.py` (scene, axes of the window, finishes shared by all machines, parts with bevels in one
  order, the guard at a machine's wall, the lamp's pole, Cycles bakes, PNG by own code, node names of the .glb),
  `machines.py` (all machines in one run — one .glb, shared materials, one AO atlas, AO on the static parts),
  `press.py`, `blister.py`, `cartoner.py` (the tablet press, the blister machine and the cartoner from their records —
  objects named by their parts; the line in the «balcony» look of the makers' photos, `pack-photos`), `README.md` (the
  pinned version, how to run, repeatability); `tools/blender/` — the scene for them from the game's own content, the
  finishes of `machines.ts` and the lamp's place, the passport's hashes and the check of .glb nodes against the record's
  parts (`scene.ts`), `npm run models` (`run.ts`).
- `electron/` — the main process (window, `app://`, no network) and preload; `app/index.html` — the page.
- `assets/` — CC0 people models (copies of Bolnitsa's, byte for byte), with #109 and #112 the machines from Blender in
  one file (`models/machines.glb`), and `LICENSES.md` (sources, licenses, SHA-256); never add a model without its line
  there and in `assets/models/sources.json`.
- `tools/app/` — page build (the page, the calculation thread and the plan run's thread), local server, browser scenario
  with the contact sheet and the first week of a newcomer in a clean window (`e2e-week.mjs`), memos and questions in two
  clean windows (`e2e-memo.mjs`), a CAPA from the quality post to its effectiveness check (`e2e-capa.mjs`), batch orders
  from the production post — uncovered orders, an urgent order for one, a cancel (`e2e-jobs.mjs`), the launch plan and
  the daily lists — the meeting's «ждали …», «Поставить сейчас» and «Утвердить», a bar's and a room card's rows of the
  day (`e2e-launch.mjs`), the forecast — the meeting's block on 1 November, the method, a cell's edit and its removal,
  «прогноз против факта» (`e2e-forecast.mjs`), the S&OP meeting — opened by itself on 3 September, a cell's target,
  «Утвердить», the journal and the rule's batch order by the plan (`e2e-sop.mjs`), the materials — the meeting's block
  on 2 September, the «Материалы» tab, «Заказать» and «Отправить», «Ускорить» and the journal (`e2e-mrp.mjs`), the
  plan edits — a commerce event at the meeting, a batch order dragged inside the frozen horizon with its price,
  «Утвердить» and the journal, the horizon policy and its edge (`e2e-edits.mjs`), the sources — candidate pairs and
  «Одобрить пару» to the trial lot with its promised day, the trial PO in the «Материалы» tab, a planned order's
  «Предложения» and «Заказать», with `--long 1` on to the dossier filing (`e2e-sources.mjs`), the
  «code —
  Blender» sheet
  of the press in the compression room and of the packaging line (`blender-sheet.mjs`), the headless scene bench
  (`bench.mjs`, `--art code` — machines in code), the release update archive — one `resources/app.asar`
  (`update-zip.mjs`); `tools/test/` — Bun tests
  and save samples; engine mechanics tests run on the scenario as it was before Б2в (`legacy.ts`), the golden run — on
  the game's scenario;
  `tools/bench/` — the engine bench, with `--plan` also the plan run.
