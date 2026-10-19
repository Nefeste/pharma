// из bolnitsa: src/render/gpu.ts @ e0a3491 — исправлено (перенести в «Больницу»): счёт замеров `taken` — память замеров
// обрезана, и отметка начала прогона длиной массива с третьего прогона бенча давала пустую выборку.
// Время видеокарты на кадр (spec docs/specs/2026-10-shell-3d.md, «Авто-бенч»): EXT_disjoint_timer_query_webgl2, если оно
// есть (спецификация Khronos, пример 1: beginQuery/endQuery с TIME_ELAPSED_EXT). С вертикальной синхронизацией к/с
// упираются в 60, а время видеокарты показывает запас. Результат запроса приходит через кадр-другой — опрашивается без
// остановки отрисовки.
interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  private ext: TimerExt | null;
  private free: WebGLQuery[] = [];
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  /** готовые замеры, мс, последние 2000; забирает бенч */
  readonly samples: number[] = [];
  /** сколько замеров пришло всего: отметка начала прогона бенча (`since` в stats.ts) */
  taken = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  get available(): boolean {
    return this.ext !== null;
  }

  begin() {
    if (!this.ext || this.active || this.pending.length > 6) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll() {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      this.pending.shift();
      this.free.push(q);
      if (!disjoint) {
        this.samples.push(ns / 1e6);
        this.taken++;
      }
    }
    if (this.samples.length > 2000) this.samples.splice(0, this.samples.length - 2000);
  }
}
