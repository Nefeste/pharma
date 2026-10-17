This is «Фармзавод» (working title), a pharmaceutical plant management simulator for PC (Steam):
warehouse, production, quality control, packaging lines, maintenance, staff, planning, market and
money, built on a deterministic model of a real plant (a "digital twin" under the game). It is the
second PC game of the «Горница» studio, after `Nefeste/bolnitsa`. The project is at **stage 0 —
concept**: there is no code yet; see `STATUS.md`.

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
- `docs/08-game-design.md` — the game as it should ship in 1.0; **all game-design numbers live
  only there**.
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

None yet: the repository holds documents only. Part 0 of the prototype brings the build, tests and
`.github/workflows/pr.yml` from Bolnitsa, and this section with them.
