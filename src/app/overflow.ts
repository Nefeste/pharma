// Переполнения окна (Б12, шаг 2; docs/specs/2026-10-vertical-slice.md, «Б12»; 13-art.md, «Что проверяет арт-директор»,
// п. 4): текст шире своей коробки и обрезан — кнопка, вкладка, ячейка, строка. Не переполнение: многоточие —
// замысел (`text-overflow: ellipsis`), прокрутка — замысел (`overflow: auto` или `scroll`), ширина в точку — округление.
// Правило — чистая функция над измерениями; измеряет окно (`measure`), её зовёт сценарий в браузере.

/** Измерения одного элемента окна. */
export interface Box {
  /** что это — для отчёта: тег, класс, `data-test`, начало текста */
  what: string;
  scrollW: number;
  clientW: number;
  scrollH: number;
  clientH: number;
  /** `overflow-x` и `overflow-y` по вычисленному стилю */
  ox: string;
  oy: string;
  /** `text-overflow: ellipsis` */
  ellipsis: boolean;
  /** `white-space: nowrap` или `pre` */
  nowrap: boolean;
  /** на сколько точек коробка выходит за край предка, что её обрезает, или за край окна; 0 — не выходит */
  cut: number;
}

/** Допуск — точка: ширины браузер округляет. */
export const SLACK = 1;

/** Обрезает ли коробка своё содержимое по оси: скрыто или обрезано, но не прокрутка. */
const clips = (o: string) => o === 'hidden' || o === 'clip';

/**
 * Переполнения среди коробок: текст шире коробки, которая его обрезает или не даёт перенести, и не многоточием; по
 * высоте — обрезанное снизу. Прокрутка — не переполнение.
 */
export function overflows(boxes: readonly Box[]): string[] {
  const out: string[] = [];
  for (const b of boxes) {
    if (b.ellipsis) continue;
    const wide = b.scrollW > b.clientW + SLACK && (clips(b.ox) || (b.nowrap && b.ox === 'visible'));
    const tall = b.scrollH > b.clientH + SLACK && clips(b.oy);
    if (wide) out.push(`${b.what}: width ${b.scrollW} > ${b.clientW}`);
    else if (tall) out.push(`${b.what}: height ${b.scrollH} > ${b.clientH}`);
    else if (b.cut > SLACK) out.push(`${b.what}: cut ${b.cut}`);
  }
  return out;
}

/** Элементы, у которых текст бывает обрезан: кнопки, ячейки, заголовки, подписи, строки с запретом переноса. */
const PICK = 'button, th, td, label, .phead, .mhead, .msec, .csec, .lhead, .notice, .num, .nowrap, .tabs > *, dt, dd';

/**
 * На сколько коробка выходит за край первого предка, что обрезает по ширине (`hidden` или `clip`), или за край окна;
 * предок с прокруткой — не обрезает: до коробки докрутят.
 */
function cutOf(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  let edge = { left: 0, right: window.innerWidth };
  for (let a = el.parentElement; a && a.id !== 'ui'; a = a.parentElement) {
    const o = getComputedStyle(a).overflowX;
    if (o === 'auto' || o === 'scroll') return 0;
    if (o === 'hidden' || o === 'clip') {
      const ar = a.getBoundingClientRect();
      edge = { left: Math.max(edge.left, ar.left), right: Math.min(edge.right, ar.right) };
      break;
    }
  }
  return Math.round(Math.max(0, r.right - edge.right, edge.left - r.left));
}

/** Измерить окно: видимые элементы внутри панелей (`#ui`). */
export function measure(root: ParentNode = document): Box[] {
  const boxes: Box[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(`#ui ${PICK.split(', ').join(', #ui ')}`)) {
    if (!el.offsetParent || el.clientWidth === 0) continue;
    const st = getComputedStyle(el);
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const test = el.dataset.test ? `[${el.dataset.test}]` : '';
    boxes.push({
      what: `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}${test} «${text}»`,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      ox: st.overflowX,
      oy: st.overflowY,
      ellipsis: st.textOverflow === 'ellipsis',
      nowrap: st.whiteSpace === 'nowrap' || st.whiteSpace === 'pre',
      cut: cutOf(el),
    });
  }
  return boxes;
}
