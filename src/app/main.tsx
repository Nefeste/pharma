// Страница игры (docs/02-architecture.md, §10): панели React и 3D-вид. Параметры адреса — для проверок:
//   ?q=low|medium|high — пресет качества; ?lang=en — язык; ?bench=1 (&secs=15&warm=3&qualities=low,high&shots=0) —
//   авто-бенч сцены (docs/specs/2026-10-view.md, 2г), &layer=load — со слоем «Загрузка и OEE» (Б1и), bottle и andon —
//   «Узкие места» и «Проблемы» (Б1к); ?art=code — машины кодом, без моделей из Blender (#109). В Electron — те же ключи:
//   --q low, --bench, --secs 15, --layer load, --art code.
import { createRoot } from 'react-dom/client';
import { setLang, systemLang, T, type Lang } from '../i18n';
import type { Quality } from '../render/view';
import { App } from '../ui/App';
import { type Actions, Store } from '../ui/store';
import { Game, PLANT, SCENARIO } from './game';
import { kept, medianFrame, PRESET, pickPreset, keep as remember, windowKeep } from './preset';

declare const __VERSION__: string;

const q = new URLSearchParams(location.search);
const lang: Lang = q.get('lang') === 'en' || q.get('lang') === 'ru' ? (q.get('lang') as Lang) : systemLang();
setLang(lang);
document.documentElement.lang = lang;
document.title = T.app.title;

const store = new Store();
store.set({ lang, version: __VERSION__ });
let game: Game | undefined;
const later = <K extends keyof Actions>(k: K) => ((...a: unknown[]) => (game?.actions[k] as (...x: unknown[]) => void)?.(...a)) as Actions[K];
const actions: Actions = {
  setSpeed: later('setSpeed'),
  untilMorning: later('untilMorning'),
  untilEvent: later('untilEvent'),
  togglePauses: later('togglePauses'),
  setPause: later('setPause'),
  go: later('go'),
  setQuality: later('setQuality'),
  pickQuality: later('pickQuality'),
  setWalls: later('setWalls'),
  setArt: later('setArt'),
  toggleDebug: later('toggleDebug'),
  bench: later('bench'),
  toggleStock: later('toggleStock'),
  setStock: later('setStock'),
  select: later('select'),
  showUnit: later('showUnit'),
  show: later('show'),
  release: later('release'),
  assess: later('assess'),
  setpoint: later('setpoint'),
  urgent: later('urgent'),
  toggleFlows: later('toggleFlows'),
  setLayer: later('setLayer'),
  nextLayer: later('nextLayer'),
  setFloorWin: later('setFloorWin'),
  understood: later('understood'),
  openMorning: later('openMorning'),
  closeMorning: later('closeMorning'),
  toggleCash: later('toggleCash'),
  setCashPage: later('setCashPage'),
  toggleLab: later('toggleLab'),
  toggleNow: later('toggleNow'),
  toggleJournal: later('toggleJournal'),
  openJournal: later('openJournal'),
  setJournal: later('setJournal'),
  watch: later('watch'),
  unwatch: later('unwatch'),
  setLabTab: later('setLabTab'),
  rush: later('rush'),
  overtime: later('overtime'),
  waste: later('waste'),
  answer: later('answer'),
  setMode: later('setMode'),
  maintain: later('maintain'),
  roster: later('roster'),
  vacancy: later('vacancy'),
  closeVacancy: later('closeVacancy'),
  hire: later('hire'),
  dismiss: later('dismiss'),
  leaveAdd: later('leaveAdd'),
  leaveMove: later('leaveMove'),
  leaveDrop: later('leaveDrop'),
  leaveDeputy: later('leaveDeputy'),
  also: later('also'),
  toggleGantt: later('toggleGantt'),
  setGanttDays: later('setGanttDays'),
  moveGantt: later('moveGantt'),
  drag: later('drag'),
  drop: later('drop'),
  cancelDrag: later('cancelDrag'),
  approveDraft: later('approveDraft'),
  resetDraft: later('resetDraft'),
  runPlan: later('runPlan'),
  stopPlan: later('stopPlan'),
  toggleInv: later('toggleInv'),
  toggleRef: later('toggleRef'),
  setRefTab: later('setRefTab'),
  toggleKpi: later('toggleKpi'),
  setKpiTab: later('setKpiTab'),
  kpiWhy: later('kpiWhy'),
  setKpiMonth: later('setKpiMonth'),
  openKpi: later('openKpi'),
  openInv: later('openInv'),
  openDossier: later('openDossier'),
  closeDossier: later('closeDossier'),
  investigate: later('investigate'),
  conclude: later('conclude'),
  openSeats: later('openSeats'),
  pickSeat: later('pickSeat'),
  takeSeats: later('takeSeats'),
  closeSeats: later('closeSeats'),
};
createRoot(document.getElementById('ui')!).render(<App store={store} actions={actions} plant={PLANT} scenario={SCENARIO} />);

const asked = (['low', 'medium', 'high'] as Quality[]).find(x => x === q.get('q'));
// пресет: из адреса (проверки) — как есть; иначе запомненный; первый запуск — средний, замер решит (preset.ts)
const quality = asked ?? kept(windowKeep()) ?? 'medium';

/** Промежутки между кадрами за `ms` мс; окно скрывали — `undefined`: замер не в счёт. */
function frameIntervals(ms: number): Promise<number[] | undefined> {
  return new Promise(done => {
    const out: number[] = [];
    let last = 0;
    let first = 0;
    let hid = false;
    const hide = () => {
      if (document.visibilityState !== 'visible') hid = true;
    };
    document.addEventListener('visibilitychange', hide);
    const step = (ts: number) => {
      if (last) out.push(ts - last);
      else first = ts;
      last = ts;
      if (ts - first < ms) requestAnimationFrame(step);
      else {
        document.removeEventListener('visibilitychange', hide);
        done(hid ? undefined : out);
      }
    };
    requestAnimationFrame(step);
  });
}

/** Первый запуск: кадр на среднем пресете дольше 33 мс — низкий; итог запоминается. Игрок успел выбрать сам — его выбор. */
async function firstPreset(g: Game) {
  await new Promise(r => setTimeout(r, PRESET.warm));
  if (document.visibilityState !== 'visible') return;
  const iv = await frameIntervals(PRESET.measure);
  const pick = iv && pickPreset(iv);
  if (!iv || !pick || kept(windowKeep())) return;
  window.__preset = { from: g.stage.quality, frames: iv.length, median: Math.round(medianFrame(iv) ?? 0), to: pick };
  if (pick !== g.stage.quality) g.actions.setQuality(pick);
  remember(windowKeep(), pick);
}

// модели: из Blender (#109) или кодом — `?art=code`; у Electron — `--art code` (после запуска, тем же переключателем)
Game.create(document.getElementById('view')!, store, quality, q.get('art') === 'code' ? 'code' : 'blender')
  .then(async g => {
    game = g;
    window.__game = g;
    const args = window.shell ? await window.shell.args() : [];
    const has = (k: string) => q.get(k) === '1' || args.includes(`--${k}`);
    const val = (k: string) => q.get(k) ?? (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : null);
    if (val('art') === 'code' && g.store.get().art !== 'code') g.actions.setArt('code');
    if (has('bench')) {
      // бенч сцены — директором: экран «Кем вы будете» не заслоняет снимки
      g.actions.pickSeat('director');
      g.actions.takeSeats();
      const { BENCH_LAYERS, runBench } = await import('./bench');
      const num = (k: string) => (val(k) ? Number(val(k)) : undefined);
      const qs = val('qualities')?.split(',') as Quality[] | undefined;
      await runBench(g, { secs: num('secs'), warm: num('warm'), qualities: qs, shots: val('shots') !== '0', ...(BENCH_LAYERS.some(l => l === val('layer')) ? { layer: val('layer') as (typeof BENCH_LAYERS)[number] } : {}) });
    } else if (!asked && !kept(windowKeep())) void firstPreset(g);
  })
  .catch(e => {
    store.set({ error: String(e) });
    console.error(e);
  });
