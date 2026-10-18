// Страница игры (docs/02-architecture.md, §10): панели React и 3D-вид. Параметры адреса — для проверок:
//   ?q=low|medium|high — пресет качества; ?lang=en — язык. В Electron — те же ключи: --q low.
import { createRoot } from 'react-dom/client';
import { setLang, systemLang, T, type Lang } from '../i18n';
import type { Quality } from '../render/view';
import { App } from '../ui/App';
import { type Actions, Store } from '../ui/store';
import { Game } from './game';

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
};
createRoot(document.getElementById('ui')!).render(<App store={store} actions={actions} />);

const quality = (['low', 'medium', 'high'] as Quality[]).find(x => x === q.get('q')) ?? 'medium';

Game.create(document.getElementById('view')!, store, quality)
  .then(g => {
    game = g;
    window.__game = g;
  })
  .catch(e => {
    store.set({ error: String(e) });
    console.error(e);
  });
