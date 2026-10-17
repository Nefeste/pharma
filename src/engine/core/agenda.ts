// Очередь событий в состоянии завода (docs/02-architecture.md, §3): двоичная куча по времени в обычном массиве. Она
// сохраняется как есть, без класса и без перестройки при загрузке (ADR студии 0004). При равном времени события идут по
// номеру постановки, поэтому порядок исполнения детерминирован.
//
// Ядро «Больницы» хранит события отсортированным массивом со вставкой (src/engine/shift/engine.ts, `schedule`). Здесь
// событий на порядок больше (склад, линии, люди), поэтому — куча.

export interface Due<E> {
  /** игровые секунды */
  t: number;
  /** номер постановки */
  seq: number;
  e: E;
}

export interface Agenda<E> {
  heap: Due<E>[];
  seq: number;
}

export function agenda<E>(): Agenda<E> {
  return { heap: [], seq: 0 };
}

export function schedule<E>(a: Agenda<E>, t: number, e: E): void {
  const h = a.heap;
  h.push({ t, seq: a.seq++, e });
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!before(h[i], h[p])) break;
    [h[i], h[p]] = [h[p], h[i]];
    i = p;
  }
}

/** Время ближайшего события или `undefined`, если очередь пуста. */
export function nextTime<E>(a: Agenda<E>): number | undefined {
  return a.heap[0]?.t;
}

/** Достаёт ближайшее событие, если оно наступило к моменту `now`. */
export function popDue<E>(a: Agenda<E>, now: number): Due<E> | undefined {
  const h = a.heap;
  const top = h[0];
  if (!top || top.t > now) return undefined;
  const last = h.pop()!;
  if (h.length > 0) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && before(h[l], h[m])) m = l;
      if (r < h.length && before(h[r], h[m])) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m], h[i]];
      i = m;
    }
  }
  return top;
}

function before<E>(a: Due<E>, b: Due<E>): boolean {
  return a.t < b.t || (a.t === b.t && a.seq < b.seq);
}
