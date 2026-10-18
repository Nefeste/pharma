// Страница игры (docs/02-architecture.md, §10): панели React и 3D-вид. Параметры адреса — для проверок:
//   ?q=low|medium|high — пресет качества; ?lang=en — язык; ?bench=1 (&secs=15&warm=3&qualities=low,high&shots=0) —
//   авто-бенч сцены (docs/specs/2026-10-view.md, 2г). В Electron — те же ключи: --q low, --bench, --secs 15.
import { createRoot } from 'react-dom/client';
import { setLang, systemLang, T, type Lang } from '../i18n';
import type { Quality } from '../render/view';
import { App } from '../ui/App';
import { type Actions, Store } from '../ui/store';
import { Game, PLANT } from './game';

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
};
createRoot(document.getElementById('ui')!).render(<App store={store} actions={actions} plant={PLANT} />);

const quality = (['low', 'medium', 'high'] as Quality[]).find(x => x === q.get('q')) ?? 'medium';

Game.create(document.getElementById('view')!, store, quality)
  .then(async g => {
    game = g;
    window.__game = g;
    const args = window.shell ? await window.shell.args() : [];
    const has = (k: string) => q.get(k) === '1' || args.includes(`--${k}`);
    const val = (k: string) => q.get(k) ?? (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : null);
    if (has('bench')) {
      const { runBench } = await import('./bench');
      const num = (k: string) => (val(k) ? Number(val(k)) : undefined);
      const qs = val('qualities')?.split(',') as Quality[] | undefined;
      await runBench(g, { secs: num('secs'), warm: num('warm'), qualities: qs, shots: val('shots') !== '0' });
    }
  })
  .catch(e => {
    store.set({ error: String(e) });
    console.error(e);
  });
