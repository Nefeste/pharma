// Страница игры (docs/02-architecture.md, §10): панели React и 3D-вид. Параметры адреса — для проверок:
//   ?q=low|medium|high — пресет качества; ?lang=en — язык; ?bench=1 (&secs=15&warm=3&qualities=low,high&shots=0) —
//   авто-бенч сцены (docs/specs/2026-10-view.md, 2г). В Electron — те же ключи: --q low, --bench, --secs 15.
import { createRoot } from 'react-dom/client';
import { setLang, systemLang, T, type Lang } from '../i18n';
import type { Quality } from '../render/view';
import { App } from '../ui/App';
import { type Actions, Store } from '../ui/store';
import { Game, PLANT, SCENARIO } from './game';
import { kept, PRESET, pickPreset, keep as remember, windowKeep } from './preset';

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
  setQuality: later('setQuality'),
  pickQuality: later('pickQuality'),
  setWalls: later('setWalls'),
  toggleDebug: later('toggleDebug'),
  bench: later('bench'),
  toggleStock: later('toggleStock'),
  setStock: later('setStock'),
  select: later('select'),
  showUnit: later('showUnit'),
  show: later('show'),
  openMorning: later('openMorning'),
  closeMorning: later('closeMorning'),
  setMorningPause: later('setMorningPause'),
  toggleCash: later('toggleCash'),
  setCashPage: later('setCashPage'),
  toggleLab: later('toggleLab'),
  setLabTab: later('setLabTab'),
  rush: later('rush'),
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
  openInv: later('openInv'),
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
  if (!pick || kept(windowKeep())) return;
  if (pick !== g.stage.quality) g.actions.setQuality(pick);
  remember(windowKeep(), pick);
}

Game.create(document.getElementById('view')!, store, quality)
  .then(async g => {
    game = g;
    window.__game = g;
    const args = window.shell ? await window.shell.args() : [];
    const has = (k: string) => q.get(k) === '1' || args.includes(`--${k}`);
    const val = (k: string) => q.get(k) ?? (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : null);
    if (has('bench')) {
      // бенч сцены — директором: экран «Кем вы будете» не заслоняет снимки
      g.actions.pickSeat('director');
      g.actions.takeSeats();
      const { runBench } = await import('./bench');
      const num = (k: string) => (val(k) ? Number(val(k)) : undefined);
      const qs = val('qualities')?.split(',') as Quality[] | undefined;
      await runBench(g, { secs: num('secs'), warm: num('warm'), qualities: qs, shots: val('shots') !== '0' });
    } else if (!asked && !kept(windowKeep())) void firstPreset(g);
  })
  .catch(e => {
    store.set({ error: String(e) });
    console.error(e);
  });
