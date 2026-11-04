// Слой «Потери» (Б1л; docs/specs/2026-10-vertical-slice.md, «Б1л»; docs/13-art.md, §11): столбик у каждого места с
// потерями вида за окно и часы над ним (columns.ts) — без рамки полной высоты: полная высота здесь — самое большое
// место окна, а не время. Два вызова отрисовки. Где стоят столбики и что на них — src/app/losses.ts.
import type * as THREE from 'three';
import { FLOOR } from '../app/floor';
import { type LossBar, lossBars, lossColor, type LossPick, type LossSpot, lossSpotsOf, spotName } from '../app/losses';
import type { ContentDb } from '../content/types';
import { durText, hText } from '../i18n';
import type { FloorView } from '../sim/floor';
import { Columns } from './columns';
import type { Layout } from './layout';

/** Над столбиком, м. */
const LABEL_GAP = 0.12;
/** Частей на столбике — не больше шести (все виды без «нет смены»). */
const PARTS = 6;

/** Часы над столбиком: от часа — целыми часами, меньше — минутами, как у табличек «Узких мест» (Б1к). */
export const lossHours = (sec: number) => (sec >= 3600 ? hText(Math.round(sec / 3600) * 3600) : durText(sec));

export class LossLayer {
  readonly spots: readonly LossSpot[];
  private cols: Columns;
  private shown: LossBar[] = [];

  constructor(
    db: ContentDb,
    private l: Layout,
  ) {
    this.spots = lossSpotsOf(db, l);
    this.cols = new Columns(this.spots.length, PARTS, 'losses', FLOOR.digits);
    this.cols.group.visible = false;
  }

  get group(): THREE.Group {
    return this.cols.group;
  }

  /** Столбики и часы вида «Пол» по виду потерь; `undefined` — вида ещё нет: пусто. */
  set(v: FloorView | undefined, pick: LossPick) {
    const bars = v ? lossBars(this.spots, v, pick) : [];
    this.shown = bars;
    this.cols.set(bars.map(b => ({ n: b.n, x: b.x, z: b.z, side: b.side, parts: b.parts.map(p => ({ color: lossColor(p.part), y0: p.y0, h: p.h })), label: b.parts.reduce((y, p) => Math.max(y, p.y0 + p.h), 0) + LABEL_GAP, lines: [lossHours(b.sec), spotName(this.l, b.spot)] })));
  }

  /** Столбики, которые сейчас на полу, — для наведения, щелчка и сценария в браузере. */
  get bars(): readonly LossBar[] {
    return this.shown;
  }

  setShown(on: boolean) {
    this.cols.group.visible = on;
  }

  /** Каждый кадр: часы — цифрами высотой `FLOOR.digits`, с высоты участка — вдвое крупнее. */
  update(site: number) {
    if (this.cols.group.visible) this.cols.update(site);
  }
}
