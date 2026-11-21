// Окна поверх завода (по игре владельца 20.11.2026): окно — панель `#ui .panel` — встаёт наверх, когда по нему щёлкнули, и
// перетаскивается за свой заголовок (`.phead`, у карточки — `.cardhead`); двойной щелчок по заголовку — на прежнее место.
// Сдвиг окна помнится, пока игра открыта, по его виду (первый класс): закрыли и открыли — оно там же. Сдвиг — свойство
// `translate`, а не `transform`: у окон посередине `transform` уже занят. Чистое правило — сдвиг в пределах экрана —
// проверяют тесты в Bun; остальное — DOM.

/** Прямоугольник на экране, точки. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Сколько точек заголовка остаётся на экране: окно не уводят так, что за него больше не взяться. */
export const GRIP = 48;

/**
 * Сдвиг окна в пределах экрана: `base` — где окно стоит без сдвига, `want` — сдвиг, который просит мышь, `view` — экран,
 * `top` — нижний край верхней полосы. Верх окна — не выше полосы; по бокам и снизу — на экране не меньше `GRIP` точек.
 */
export function clampShift(base: Rect, want: { x: number; y: number }, view: Rect, top: number): { x: number; y: number } {
  const w = base.right - base.left;
  const x = Math.min(view.right - GRIP - base.left, Math.max(view.left + GRIP - w - base.left, want.x));
  const y = Math.min(view.bottom - GRIP - base.top, Math.max(top - base.top, want.y));
  return { x: Math.round(x), y: Math.round(y) };
}

/** Вид окна — ключ его сдвига: первый класс («stock», «letters», «morning»), у панелей справа — с вторым («stock cashp»). */
export const keyOf = (cls: string): string => {
  const c = cls.split(/\s+/).filter(x => x && x !== 'panel' && x !== 'over' && x !== 'beside');
  return c.slice(0, c[0] === 'stock' || c[0] === 'kpi' ? 2 : 1).join(' ');
};

import { uiK } from './scale';

const HANDLE = '.phead, .cardhead';
const NOT_HANDLE = 'button, input, select, textarea, a, label, [contenteditable]';
/** Окна, которые не двигают и не поднимают: верхняя полоса. */
const FIXED = 'top';

/**
 * Подключить окна к слою панелей: поднять по щелчку, тащить за заголовок, помнить сдвиг. Возвращает «все окна — на
 * место» (Б13, шаг 3): второй путь у двойного щелчка по заголовку — кнопка в «Настройках».
 */
export function windows(root: HTMLElement): () => void {
  const shifts = new Map<string, { x: number; y: number }>();
  let z = 20;
  const shiftOf = (el: HTMLElement) => {
    const m = /(-?\d+)px (-?\d+)px/.exec(el.style.translate);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
  };
  const put = (el: HTMLElement, s: { x: number; y: number }) => {
    el.style.translate = s.x === 0 && s.y === 0 ? '' : `${s.x}px ${s.y}px`;
  };
  const topEdge = () => (root.querySelector<HTMLElement>(`.${FIXED}`)?.getBoundingClientRect().bottom ?? 0) + 2;
  const view = (): Rect => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });

  root.addEventListener(
    'pointerdown',
    e => {
      const t = e.target as HTMLElement | null;
      const panel = t?.closest<HTMLElement>('.panel');
      if (!panel || !root.contains(panel) || panel.classList.contains(FIXED)) return;
      panel.style.zIndex = String(++z);
      const handle = t?.closest<HTMLElement>(HANDLE);
      if (!handle || handle.closest('.panel') !== panel || t?.closest(NOT_HANDLE) || e.button !== 0) return;
      const from = { x: e.clientX, y: e.clientY };
      // сдвиг — в точках `#ui`, мышь и прямоугольники — в точках экрана: под масштабом интерфейса (Б13) их `k` в точке
      const k = uiK();
      const start = shiftOf(panel);
      const r = panel.getBoundingClientRect();
      const base: Rect = { left: r.left - start.x * k, top: r.top - start.y * k, right: r.right - start.x * k, bottom: r.bottom - start.y * k };
      const key = keyOf(String(panel.className));
      const edge = topEdge();
      const move = (m: PointerEvent) => {
        const px = clampShift(base, { x: start.x * k + m.clientX - from.x, y: start.y * k + m.clientY - from.y }, view(), edge);
        const s = { x: Math.round(px.x / k), y: Math.round(px.y / k) };
        put(panel, s);
        shifts.set(key, s);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('dragging');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      document.body.classList.add('dragging');
      e.preventDefault();
    },
    true,
  );
  root.addEventListener('dblclick', e => {
    const t = e.target as HTMLElement | null;
    const handle = t?.closest<HTMLElement>(HANDLE);
    const panel = handle?.closest<HTMLElement>('.panel');
    if (!panel || t?.closest(NOT_HANDLE)) return;
    put(panel, { x: 0, y: 0 });
    shifts.delete(keyOf(String(panel.className)));
  });
  // окно открыли снова — на его прежнем месте
  new MutationObserver(list => {
    for (const m of list)
      for (const n of m.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        for (const el of [n, ...n.querySelectorAll<HTMLElement>('.panel')]) {
          if (!el.classList.contains('panel') || el.classList.contains(FIXED)) continue;
          const s = shifts.get(keyOf(String(el.className)));
          if (s) put(el, s);
          el.style.zIndex = String(++z);
        }
      }
  }).observe(root, { childList: true, subtree: true });
  return () => {
    shifts.clear();
    for (const el of root.querySelectorAll<HTMLElement>('.panel')) put(el, { x: 0, y: 0 });
  };
}
