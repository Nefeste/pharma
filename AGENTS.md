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
  the event agenda as a heap in plain arrays and the calendar without `Date` with the production calendar — holidays,
  transfers, short days, the month's norm — ours), `types.ts` (state, commands,
  notices, `SCHEMA`), `engine.ts` (`newPlant`, `apply`, `catchUp`, events), `random.ts` (named branches in the state,
  the integer normal draw), `save.ts` (snapshot and migrations), `nav.ts` (the plan's 1 m grid: walls, doors and
  footprints, where people may walk and vehicles may drive, access cells, distance fields cached per plan, route length
  and the route polyline shared with the window, a point along it in whole centimetres), `plant.ts` (slots, docks, rooms,
  the lab, work points, posts of roles and distances along the plan's routes), `stock.ts` (lots, containers, pallets,
  slots, the lot status table), `supply.ts` (purchase orders; the supply colleague — at 09:00 on a workday, every material
  below its reorder point: plan use over the longest lead time, incoming control and safety stock, through the first
  approved supplier–maker pair, one order per
  supplier, at most half the quarantine zone in pallets), `planner.ts` (the planning colleague — at 07:00 on a workday, a
  batch order for the workday two working weeks on, for the SKU that runs out first by FG and work in progress against
  demand per working day seen in customer orders, over five-day weeks ahead; SKUs in turn until demand is seen;
  campaigns — the product of the last batch order goes
  on while its SKUs need a batch and no SKU of the other product is urgent), `wms.ts` (truck, its check at the dock
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
  in force at their not-before, FEFO reservation with potency — tried without writing by `kitPlan`, shared with the
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
  failure and resumed after the repair; a new not-before time of a batch order from the player — `shift`; room
  readiness, nominal stage time and cleaning time shared with the schedule run; new part budgets of a running stage for
  the plan run's twin — `stageRedraw`), `plan/schedule.ts` (the schedule run — a pure function: running tasks to their
  end, then kitting, stages and cleaning by the engine's rules and its own functions, with the player's draft changes
  and the draft's new batch orders as the `order` commands would place them; bars and the reasons why not earlier),
  `plan/twin.ts` (the plan run's twin: on a copy, forget what the plant does not know —
  true lot and batch properties, causes, part budgets, unrecorded jams, results before review, the incident not yet
  seen, marks no step has looked for — and redraw it from what was measured, the root of an open investigation from its
  versions; branches anew from the run seed), `plan/run.ts` (the plan run — a pure function: per seed a copy, the
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
  colleague by the same rule, release only with assessed deviations),
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
  shift task), `modes.ts`
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
  next personnel number, training at once, the trial; dismissal — by agreement today with a payment, a failed trial in
  three days and only within the trial, by own wish two weeks after the application, «let go earlier»; turnover; the
  person leaves after the last shift, the vacation parts after the last day dropped and the parts they deputized for
  given to the next deputy; the colleague of a post the player does not hold opens a vacancy for each
  application and hires the first fit candidate — an agency at once for a role no ad finds, the price within the
  market's for the skill), `leave.ts` (vacations, with Б4г: the law's numbers in the profile, the scenario's rule of the
  draft; a year's vacation schedule — the draft by HR on the first workday of December at 09:00 by the rule
  (`placeDraft`, shared with the content build): parts from a Monday, the first in summer, people of one role apart, a
  person and their deputy apart, at most so many of a department at once, a part on the week of its window where it
  hinders nobody and the fewest days of others' parts fall; edits by the department's post or the director, the
  approval on 17 December or the last workday before it, then a move by agreement no closer than two weeks; the notice
  two weeks ahead; away and back at midnight; a deputy — the first by personnel number with the related profession of
  the absent's role, of the same shift if any; who covers whom on a day; days earned and used, the compensation days;
  the `leave` command), `journal.ts` (with Б5а, the decision journal: a record for each decision a rule makes for a
  department head — the head by position, what was decided about which thing, the reason with the plant's numbers and
  never the truth; the player's command of the same kinds — «you» with the place it came from; a colleague's command —
  the record of its head; a scenario's or a refused command — none; no rule reads it; records older than the term go
  at midnight; the plan run's copy starts without it), `seats.ts` (the player's places — the director and four posts:
  whose each command is — a
  transfer, a vacancy, a hire, a dismissal, a vacation part or a related profession is the post of the role's
  department —, the `seat` command, the log of places; a player's command of another's post is refused),
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
  only in a zone whose regime fits and whose sensor is fit; what holds a stage or a line), `partners.ts` (makers and
  suppliers — the maker itself or a distributor; approved supplier–maker pairs from the material spec in force; pair
  approvals with a term, start records by a hash, not before the pair entered a spec; the quality colleague books an
  evaluation at 09:00 on a workday — an audit at the maker by a third-party auditor, the bill with the report, or a
  documents review — and the QA specialist reviews it; a pair whose approval lapsed is suspended, nothing is ordered
  through it; the quality agreement in force; framework contracts — the contract price up to the promised volume, the
  list price beyond, at the end a clawback for a pair bought below the promised share by value, and a new contract;
  supply contracts of customers extended), `invariants.ts`.
- **Golden fingerprint** (`tools/test/golden.test.ts`): any change of engine behaviour changes it. If the change is
  intended, record the new fingerprint and say in the commit what changed in the plant's life.
- `src/sim/` — the calculation thread: protocol, host (`createSim`; a `tick` carries the notice kinds of the player's
  autopauses, and the thread stops right after such an event — the plant's clock on its minute, the rest of the game
  clock dropped), packed slice (`pack.ts`, format 7: rooms, trucks with their open body, changed pallets, tasks in
  progress, people with their walk to a post, vehicles, lines with their machines, equipment, and whether a machine or
  equipment is in calibration or qualification; no truth fields — not the next micro-stop, not a part's budget), views
  for panels — the warehouse and the card of a thing with what a pallet holds, with Б1е a room's cleanliness — clean
  for which product and until when, or dirty after which product and which cleaning it needs — and a line machine's job
  waiting for the room's cleaning, with Б1ж the blister machine's speed — rated, the job's and each SKU's setpoint —,
  built here on request and sent with the slice only when they changed, without truth
  fields (`views.ts`); the deviation card, the batch decision at release and
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
  waits now, with Б1ж the setpoints off target and since when — the cash panel and the top-bar cash with the player's
  places (`report.ts`); the places and assets — the
  «Места» tab, an asset in a card, the meeting's calibration and qualification, which batch waits for which asset —
  records and visits are the plant's knowledge (`places.ts`); the partners — makers, pairs with their approval and
  evaluation, agreements and contracts in force for the «Контрагенты» tab, the meeting's suppliers, a lot's maker and
  contract (`partners.ts`); the lab queue and the X–Rm control chart of the in-process
  average tablet mass with its limits and special-cause signs, a lot under investigation and its steps' tests
  (`lab.ts`); the investigation board — what happened, participants, steps, findings, versions from the findings only,
  whether release is proven, the debrief only once concluded (`inv.ts`); working time — the month's time sheet of a
  person's card with its totals and the year, «ОТ» on vacation days, the accounting period of a person on a cyclic
  schedule, the calendar of
  twelve months, the schedules of this and the next month — by schedule and by role, department policies, the meeting's
  «Рабочее время» with transfers soon in force and the crews' extra days off — records are the plant's knowledge
  (`hours.ts`); people and admissions — a person's admission
  today and what they are losing within the warning period, training rows of the card, the training matrix of the
  reference with how many people of a role are admitted, and of other roles by the related profession, the meeting's
  summary — records are the plant's knowledge, not truth (`people.ts`); hiring — the staff by the scenario and now,
  vacancies with their candidates and the days of a hire today, the hired before their first day, the former, the
  meeting's «Люди» — candidates as they came, records of the plant (`hire.ts`); vacations — the schedule of this and the
  next year by people and weeks with what hinders it, a person's days earned, used and left, the parts with their
  deputies and whom one may choose, whom a person covers, the meeting's away, leaving soon and back — records of the
  plant (`leave.ts`); with Б5а, the decision journal — pages newest first, filters by post and author, the numbers
  and codes of a record's things, «Кто решил» of the cards and the batch record, the meeting's decisions of the day by
  head — records of the plant (`journal.ts`); with Б1и, the floor — rooms and line machines over today, yesterday or
  seven days, the key machine and OEE by the meeting's `lineSum`, the plan-vs-actual board of the shift by hours, the
  batch a held room leads to — records of the plant (`floor.ts`); the schedule — the Gantt of the past, the running and
  the schedule run
  with the player's draft —
  new not-before times and new urgent batch orders, the old bars of what the draft moves, and the ghost of a dragged
  batch order (`plan.ts`), Web Worker (`worker.ts`) and its client in the window (`client.ts`; how far the window's
  clock ran ahead of the last slice; at most one `tick` in flight); the plan run's own thread — a second Web Worker over
  the same engine (`planHost.ts`, `planWorker.ts` → `dist/plan.js`) and its client in the window (`planClient.ts`; a
  stop terminates the thread). The window never runs the engine. Saves cross the thread boundary as a string: the window
  never parses the state with the true lot properties — the plan run gets the same string.
- `src/app/` — the game in the window: content, stage, clock and speeds with live time 1:1, input, panels (`game.ts`,
  `main.tsx`); what the slice puts on the floor — pallets, trucks, rooms, pallets on forks (`scene.ts`); where people
  and vehicles are now — a pure function of the tasks in the slice and the clock, on the plan's routes and with the
  engine's travel times, free people on their way to a post too, and the work icon of each busy person (`movers.ts`);
  the start preset — the frame measured on medium at first run, low if slower than 33 ms, the result and the player's
  choice kept in the window (`preset.ts`); the autopauses — which notices stop the world, whose post each is, the ones
  switched off kept in the window, where a click on a notice leads (`pauses.ts`); which «Сейчас» row is the work of a
  thing in the card (`watch.ts`); the levers of meeting rows — decisions, whose post, «будет в …» (`levers.ts`); the
  first-event explanations understood, kept in the window (`firsts.ts`); trucks in the yard — backing in, waiting,
  driving off, a picture only (`yard.ts`); what is under the cursor — people by their point on screen, pallets, machines
  and trucks by the camera ray, the room by the floor (`pick.ts`); pallet moves between zones seen from the slice, their
  rates, arrows and the fill of warehouse places, people moving between rooms for the «Потоки — люди» layer
  (`flows.ts`); with Б1и the layers on the left and L, where the load columns and the boards stand, part heights as
  shares of the window, the number over each column, the board rows, the palette (`floor.ts`); the scene bench, a copy
  of Bolnitsa's, with `--layer load` also with the layer on (`bench.ts`,
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
  icons above heads, one instanced draw call (`badges.ts`), the «Загрузка и OEE» layer — column parts, full-height
  frames, numbers and plan-vs-actual boards in four draw calls (`floor.ts`), people
  — Bolnitsa's crowd on the GPU (`bake.ts`, `people.ts`, copies) with looks and clothes by role (`cast.ts`), the
  composition (`stage.ts`).
- `src/ui/` — panels (React) and their store: the top bar with «До утра», «До события» and the latest notice — the one
  the world stopped on marked «❚❚», a click leads to its place (`App.tsx`), the autopause menu (`Pauses.tsx`), the
  warehouse (`Stock.tsx`), a guard around each panel and the top bar — an error stays in its place
  (`Guard.tsx`), the card of a
  thing — what it is, state, why, what can be done, history; a person's dismissal (`Card.tsx`), the plant reference with
  its tabs, sortable columns and search, hiring in «Люди» (`Ref.tsx`, F1), the vacation schedule in «Люди» and the
  vacation block of a person's card — parts, deputies, the related profession (`Leave.tsx`), the decision journal —
  the right panel, J, a row with its reason in words, filters and pages, and the «Кто решил» rows with «Почему?»
  (`Journal.tsx`), the layers menu on the left with the window and the legend, the column tooltip and the card's
  «Загрузка» block (`Layers.tsx`), quality attribute and
  process parameter
  values in words (`units.ts`), what is going on now with «Смотреть»
  (`Now.tsx`, N), the 08:00 meeting (`Morning.tsx`), the cash
  panel (`Cash.tsx`), the lab queue and control chart (`Lab.tsx`), the schedule window with dragging, the draft, «Прогнать
  план» and the run's outcome per variant (`Gantt.tsx`), the draft's pure rules — a row per batch order, gone once kitting
  starts, `shift` commands on approval (`draft.ts`), the «Кем вы будете» screen of places (`Seats.tsx`), the
  investigation board — steps, findings in words with numbers from the records, version bars, the decision, the
  debrief (`Inv.tsx`), the batch record over the other windows — opened from a card, «Сейчас», the meeting and a click
  on a batch bar of the schedule (`Dossier.tsx`), the levers of a row (`Levers.tsx`), the deviation card, the batch
  decision, stage parameters, with Б1ж the setpoints with «−» and «+» and a blister machine's speed, and
  the first-event explanation in the card (`Decide.tsx`), status and work icons (`icons.tsx`), asset words — class and
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
  IPC scatter, a line machine's rated speed and the blister machine's speed factors (`fast`), a SKU's blister speed);
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
  only from a parameter, a SKU's blister speed within the machine's rated one; plan rules in
  `plan.ts`: doors on walls, docks on outer walls, class D only through
  airlocks, reachability, posts on
  walkable floor; models in
  code — parts inside the footprint, round cylinders, upright hoppers, items only on belts: `modelErrors` in `load.ts`;
  places — codes by format and unique, a room in one area, a thing on a work center of its kind in its room's area, one
  verified sensor per storage zone, an IPC instrument for each stage test in the stage room, a zone for every material by
  its regime, contractor works within his day, the warning period shorter than the shortest interval: `placeErrors`;
  pairs — every revision of a starting or packaging material spec has a pair its supplier sells from that maker, every
  pair of the start has a quality agreement in force: `pairErrors`).
- `electron/` — the main process (window, `app://`, no network) and preload; `app/index.html` — the page.
- `assets/` — CC0 people models (copies of Bolnitsa's, byte for byte) and `LICENSES.md` (sources, licenses, SHA-256);
  never add a model without its line there and in `assets/models/sources.json`.
- `tools/app/` — page build (the page, the calculation thread and the plan run's thread), local server, browser scenario
  with the contact sheet, the headless scene bench (`bench.mjs`), the release update archive — one `resources/app.asar`
  (`update-zip.mjs`); `tools/test/` — Bun tests and save samples; engine
  mechanics tests run on the scenario as it was before Б2в (`legacy.ts`), the golden run — on the game's scenario;
  `tools/bench/` — the engine bench, with `--plan` also the plan run.
