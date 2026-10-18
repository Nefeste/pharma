// Цвет для проверок картинки (docs/specs/2026-10-view.md, 2г; требования — геймдизайн, §23): имитация цветовой слепоты,
// разница цветов ΔE*ab и контраст значка с фоном. Чистые функции без Three.js и DOM — их проверяют тесты в Bun, а окно
// берёт отсюда цвет значка на лампе.
//
// Источники (взяты 18.10.2026):
// - имитация — Machado, Oliveira, Fernandes (2009), «A Physiologically-based Model for Simulation of Color Vision
//   Deficiency», IEEE TVCG 15(6), 1291–1298; матрицы полной тяжести (1,0) — из набора библиотеки Colour Science
//   (github.com/colour-science/colour, colour/blindness/datasets/machado2010.py, коммит 248121e; перенесены из диссертации
//   Machado, 2010). Матрицы выведены из спектров основных цветов экрана и действуют на линейный RGB. Тританопию модель
//   передаёт приближённо: её ветвь построена сдвигом чувствительности (оговорка библиотеки);
// - sRGB → XYZ (МЭК 61966-2-1, белая точка D65, CIE 1931 2°: x 0,3127, y 0,3290) и CIELAB (CIE 1976) — по той же библиотеке
//   (colour/models/rgb/datasets/srgb.py, colour/models/cie_lab.py, colour/colorimetry/lightness.py);
// - относительная яркость и контраст — WCAG 2.1, определения «relative luminance» и «contrast ratio»
//   (github.com/w3c/wcag, guidelines/terms/20, коммит 23bad59); для значков — не меньше 3:1 (п. 1.4.11).

export type Vision = 'normal' | 'protan' | 'deutan' | 'tritan';
export const VISIONS: readonly Vision[] = ['normal', 'protan', 'deutan', 'tritan'];

/** Матрицы Machado (2009), тяжесть 1,0: протанопия, дейтеранопия, тританопия. */
const CVD: Record<Exclude<Vision, 'normal'>, readonly number[]> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

/** sRGB → XYZ (МЭК 61966-2-1) и белая точка D65. */
const TO_XYZ = [0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505];
const WHITE = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];

/** Значение sRGB 0…1 → линейное. */
export const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

const rgbOf = (hex: number) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/** Линейный RGB цвета, каким его видит глаз `vision` (обрезан в 0…1). */
export function simulate(hex: number, vision: Vision): number[] {
  const lin = rgbOf(hex).map(toLinear);
  if (vision === 'normal') return lin;
  const m = CVD[vision];
  return [0, 1, 2].map(i => Math.min(1, Math.max(0, m[i * 3] * lin[0] + m[i * 3 + 1] * lin[1] + m[i * 3 + 2] * lin[2])));
}

const f = (t: number) => (t > (24 / 116) ** 3 ? Math.cbrt(t) : (841 / 108) * t + 16 / 116);

/** CIELAB линейного RGB. */
export function labOf(lin: readonly number[]): [number, number, number] {
  const xyz = [0, 1, 2].map(i => TO_XYZ[i * 3] * lin[0] + TO_XYZ[i * 3 + 1] * lin[1] + TO_XYZ[i * 3 + 2] * lin[2]);
  const [fx, fy, fz] = xyz.map((v, i) => f(v / WHITE[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Разница двух цветов ΔE*ab (CIE 1976) для глаза `vision`. */
export function deltaE(a: number, b: number, vision: Vision = 'normal'): number {
  const la = labOf(simulate(a, vision));
  const lb = labOf(simulate(b, vision));
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** Относительная яркость (WCAG). */
export function luminance(hex: number): number {
  const [r, g, b] = rgbOf(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст двух цветов (WCAG): от 1 до 21. */
export function contrast(a: number, b: number): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Тёмная краска значка — для светлых фонов. */
export const INK_DARK = 0x1f2428;
export const INK_LIGHT = 0xffffff;

/** Краска значка на цветном фоне: белая или тёмная — какая контрастнее. */
export const inkOf = (bg: number) => (contrast(bg, INK_LIGHT) >= contrast(bg, INK_DARK) ? INK_LIGHT : INK_DARK);
