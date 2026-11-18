// Портфель для окна (Б7д; docs/specs/2026-10-vertical-slice.md, «Б7д»; геймдизайн, §13): продукты базы, которые завод
// не производит, и их проекты — этап, с какого мгновения, чего ждёт; на «готовности» — чего нет заводу; серии проекта —
// пробная и валидации с номером и состоянием; досье — подача и день решения. Блок планёрки «Проекты» — те же строки.
// Только записи завода: план, записи активов и пар, задачи, серии, партии и их статусы; истины тут нет
// (docs/02-architecture.md, §9). Слова — в окне.
import type { ContentDb, Id } from '../content/types';
import { batchNo } from '../engine/batchno';
import { momentOf } from '../engine/core/calendar';
import { type Gap, gapsOf, isProject, projectDocs, rampOf } from '../engine/project';
import type { PlantState, ProjectStage } from '../engine/types';

export interface PortfolioQuery {
  view: 'portfolio';
}

/** Серия проекта: номер, если выдан, — ПП-номер; где она — в процессе, балк ждёт решения, прошла или не прошла. */
export interface ProjectBatch {
  batch: string;
  code?: string;
  role: 'trial' | 'validation';
  state: 'process' | 'testing' | 'pass' | 'fail';
}

/** Проект: этап и с какого мгновения, сколько работ этапа осталось, серии, досье и разгон спроса после ввода. */
export interface ProjectRow {
  id: string;
  product: Id;
  stage: ProjectStage;
  started: number;
  since: number;
  /** продавать ли серии валидации после отчёта — решение протокола; не решено — `undefined` */
  sell?: boolean;
  /** решение протокола ещё можно поменять: до первой серии валидации */
  open: boolean;
  /** работы этапа у людей: осталось задач по полдня */
  left: number;
  passed: number;
  need: number;
  restarts: number;
  batches: ProjectBatch[];
  /** документы и обучение: день, с которого карта — в силе */
  until?: number;
  dossier?: { filed: number; decide: number };
  /** продукт введён: день и спрос позиции сейчас, % */
  live?: { day: number; ramp: number };
}

/** Продукт портфеля: проект — текущий (не остановленный), чего нет заводу; документы-проекты по группам — сколько. */
export interface PortfolioRow {
  product: Id;
  /** продукт ещё проект: проект можно начать */
  draft: boolean;
  project?: ProjectRow;
  /** проекты продукта, которые остановили */
  stopped: number;
  gaps: Gap[];
  docs: { materials: number; methods: number; docs: number; launch: number };
}

export interface PortfolioView {
  view: 'portfolio';
  today: number;
  /** сценарий с проектами: числа этапов */
  terms?: { method: number; clean: number; protocol: number; report: number; batches: number; ramp: { from: number; months: number } };
  rows: PortfolioRow[];
}

const OPEN_STAGES: readonly ProjectStage[] = ['ready', 'methods', 'docs', 'clean', 'trial', 'protocol'];

function batchOf(s: PlantState, ok: readonly string[], id: string, role: 'trial' | 'validation'): ProjectBatch {
  const b = s.batches[id];
  const lot = b?.bulk ? s.lots[b.bulk] : undefined;
  const state: ProjectBatch['state'] = ok.includes(id) ? 'pass' : !b || b.status === 'rejected' || b.status === 'cancelled' || lot?.status === 'rejected' ? 'fail' : lot ? 'testing' : 'process';
  return { batch: id, ...(b && b.code.n > 0 ? { code: batchNo(b.code) } : {}), role, state };
}

/** Строка проекта для окна и планёрки. */
export function projectRow(db: ContentDb, s: PlantState, id: string): ProjectRow | undefined {
  const p = s.portfolio?.projects[id];
  const sc = db.scenarios[s.scenario].project;
  if (!p) return undefined;
  const sku = Object.values(db.skus).find(k => k.product === p.product)?.id;
  return {
    id: p.id,
    product: p.product,
    stage: p.stage,
    started: p.started,
    since: p.since,
    ...(p.sell !== undefined ? { sell: p.sell } : {}),
    open: OPEN_STAGES.includes(p.stage),
    left: Object.values(s.tasks).filter(t => t.project === p.id).length,
    passed: p.passed,
    need: sc?.batches ?? 0,
    restarts: p.restarts,
    batches: [...(p.trial ? [batchOf(s, p.ok ?? [], p.trial, 'trial')] : []), ...p.batches.map(b => batchOf(s, p.ok ?? [], b, 'validation'))],
    ...(p.until !== undefined ? { until: p.until } : {}),
    ...(p.dossier ? { dossier: p.dossier } : {}),
    ...(p.live !== undefined && sku ? { live: { day: p.live, ramp: rampOf(db, s, sku) } } : {}),
  };
}

export function portfolioView(db: ContentDb, s: PlantState): PortfolioView {
  const projects = Object.values(s.portfolio?.projects ?? {});
  const products = Object.keys(db.products).filter(id => isProject(db, s, id) || projects.some(p => p.product === id));
  const sc = db.scenarios[s.scenario].project;
  const rows = products.map((product): PortfolioRow => {
    const mine = projects.filter(p => p.product === product);
    const cur = mine.find(p => p.stage !== 'stopped');
    const ds = projectDocs(db, product);
    const draft = isProject(db, s, product);
    return {
      product,
      draft,
      ...(cur ? { project: projectRow(db, s, cur.id) } : {}),
      stopped: mine.filter(p => p.stage === 'stopped').length,
      gaps: draft && (!cur || cur.stage === 'ready') ? gapsOf(db, s, product) : [],
      docs: { materials: ds.materials.length, methods: ds.methods.length, docs: ds.docs.length, launch: ds.launch.length },
    };
  });
  return {
    view: 'portfolio',
    today: momentOf(s.start, s.t).day,
    ...(sc ? { terms: { method: sc.method, clean: sc.clean, protocol: sc.protocol, report: sc.report, batches: sc.batches, ramp: sc.ramp } } : {}),
    rows,
  };
}
