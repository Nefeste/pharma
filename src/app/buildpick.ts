// Выбор в панели стройки (Б7б): инструмент, тип и класс помещения, вид двери, зона склада, ряд стеллажа — и что панель
// показывает. Отдельно от src/app/build.ts: хранилище панелей берёт отсюда значения по умолчанию без отрисовки.
import type { ZoneKind } from '../content/types';
import type { BuildDoor } from '../engine/site/edit';

export type BuildTool = 'room' | 'hull' | 'door' | 'zone' | 'rack' | 'vehicles' | 'unit' | 'demolish';
export const BUILD_TOOLS: readonly BuildTool[] = ['room', 'hull', 'door', 'zone', 'rack', 'vehicles', 'unit', 'demolish'];
export const BUILD_DOORS: readonly BuildDoor[] = ['door', 'double', 'gate', 'hatch'];

/** Что выбрано в панели стройки: инструмент, тип и класс помещения, вид двери, зона, ряд стеллажа; R — поворот. */
export interface BuildPick {
  tool?: BuildTool;
  type?: string;
  grade: 'D' | 'cnc';
  vehicles: boolean;
  door: BuildDoor;
  materials: boolean;
  gate: number;
  zone: ZoneKind;
  bays: number;
  levels: number;
  face: 'n' | 's';
  /** R у двери: поперёк оси, которую нашла стена; у оборудования (Б7в) — поворот следа на четверть */
  turn: boolean;
  /** оборудование (Б7в): класс, поставщик; переносимая единица — щелчок ставит её на новое место */
  cls?: string;
  vendor: string;
  moving?: string;
}

export const PICK: BuildPick = { grade: 'cnc', vehicles: false, door: 'door', materials: false, gate: 2, zone: 'quarantine', bays: 6, levels: 4, face: 'n', turn: false, vendor: 'ven.ru' };

/** Для панели: стройка, выбор, строки призрака и ответа, шаги отмены, потрачено, перестраиваемое. */
export interface BuildHud {
  on: boolean;
  pick: BuildPick;
  ghost?: { ok: boolean; warn: boolean; text: string };
  result?: { ok: boolean; text: string };
  undo: number;
  spent: number;
  editing?: string;
}

export const NO_BUILD: BuildHud = { on: false, pick: PICK, undo: 0, spent: 0 };
