// Сценарий в браузере, часть «Стройка» (Б7б; docs/specs/2026-10-vertical-slice.md, «Б7б», «Проверки Б7б»): чистое окно,
// место директора, B — стройка. Корпус к востоку от «Общего коридора», коридор в нём (красный — от входа не дойти) и
// дверь из «Общего коридора» (закрыт на перестройку), шлюз для людей с дверью из нового коридора; зона карантина и ряд
// стеллажа на складе — склад закрыт, «Готово» — снова работает; «нельзя» — дверь на улицу; красная — дверь из общего
// коридора в упаковку мимо шлюза, отмена; жёлтая — у мойки один проём, отмена; снос занятого ряда стеллажа — «когда
// освободится», отмена. Паллета едет в новое место: зона карантина ГП у паллетирования — первая паллета готовой продукции
// ложится в неё. Сцена после
// каждой правки — заново по новому плану, срезы разбираются; программы отрисовщика — те же: шейдеры заново не
// собираются. Отклик — в кадрах (геймдизайн, §21). Снимки — tools/app/out/build-*.png, лист — tools/app/out/build.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Пороги отклика — в кадрах, как у части «Первая неделя» (tools/app/e2e-week.mjs): числа — геймдизайн, §21. */
const FRAMES = { input: 6, command: 15 };

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function buildPart({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await director({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  ok(`Стройка, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'build.png'), fullPage: true });
  await lister.close();
  ok(`Стройка: ${shots.length} снимков → ${join(out, 'build.png')}`);
}

/** Чистое окно игры: прокрутка с Promise, счёт кадров и миг ввода, проверки ответа по имени (страница запрещает `eval`). */
export async function openGame({ browser, port, errors, requests, q }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const promised = (o, names) => {
      for (const k of names) {
        const f = o[k];
        o[k] = function (...a) {
          const r = f.apply(this, a);
          return r instanceof Promise ? r : Promise.resolve();
        };
      }
    };
    promised(Element.prototype, ['scrollIntoView', 'scroll', 'scrollTo', 'scrollBy']);
    promised(window, ['scroll', 'scrollTo', 'scrollBy']);
    window.__fn = 0;
    const tick = () => {
      window.__fn++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const mark = () => {
      window.__in = { t: performance.now(), f: window.__fn };
    };
    addEventListener('pointerdown', mark, true);
    addEventListener('pointerup', mark, true);
    addEventListener('keydown', mark, true);
    const h = () => window.__game.store.get();
    const plan = () => window.__game.layout.plan.plant;
    window.__seen = {
      // стройка открыта: панель, стены вниз
      panel: () => h().build.on && !!document.querySelector('[data-test=build-panel]') && h().walls === 'down',
      // новый план — сцена заново: номер правки, раскладка по нему, призрак говорит о новом плане
      rev: r => window.__game.world.rev === r && window.__game.layout.plan.plant === window.__game.world.plan,
      // подпись помещения в стройке — с этим состоянием
      label: ([id, re]) => new RegExp(re).test(document.querySelector(`[data-test=labels] [data-room="${id}"] span`)?.textContent ?? ''),
      // строка призрака
      ghost: re => new RegExp(re).test(document.querySelector('[data-test=build-ghost]')?.textContent ?? ''),
      result: re => new RegExp(re).test(document.querySelector('[data-test=build-result]')?.textContent ?? ''),
      // паллета лежит на месте зоны
      placed: zone => {
        const slots = window.__game.layout.plan.slots;
        return [...window.__game.view.units.values()].some(u => u.where === 'slot' && slots[u.ref]?.group === zone);
      },
      plan: () => plan(),
    };
  });
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith('data:') && !u.startsWith('blob:')) requests.push(u);
  });
  await page.goto(`http://127.0.0.1:${port}/index.html?q=${q}&lang=ru`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  return { ctx, page };
}

/** Общие шаги окна: кадры, часы, отклик, снимок, места, клетка на экране, протяжка. */
export function steps(page, { out, fail, shots, feel, prefix = 'build' }) {
  const frames = n => page.evaluate(k => new Promise(r => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);
  const clock = () => page.evaluate(() => `${document.querySelector('[data-test=date]')?.textContent ?? ''} ${document.querySelector('[data-test=clock]')?.textContent ?? ''}`);
  /** Середина клетки плана на экране: камеру — над ней, если клетка у края кадра. */
  const at = async (x, z) => {
    let p = await page.evaluate(([cx, cz]) => window.__game.stage.screen(cx + 0.5, 0, cz + 0.5), [x, z]);
    if (!p || p.x < 260 || p.y < 70 || p.x > 1240 || p.y > 680) {
      await page.evaluate(([cx, cz]) => {
        const c = window.__game.stage.cam;
        c.target.set(cx, 0, cz);
        c.half = 18;
      }, [x, z]);
      await frames(3);
      p = await page.evaluate(([cx, cz]) => window.__game.stage.screen(cx + 0.5, 0, cz + 0.5), [x, z]);
    }
    return p;
  };
  return {
    frames,
    clock,
    at,
    /** Отклик: от ввода до первого кадра, в котором проверка `check` (`window.__seen`) верна, — мс и кадры. */
    measure: async (label, act, check, arg, kind = 'command') => {
      await page.evaluate(() => {
        window.__in = undefined;
      });
      await act();
      const r = await page
        .waitForFunction(([c, a]) => (window.__seen[c](a) && window.__in ? { ms: Math.round(performance.now() - window.__in.t), f: window.__fn - window.__in.f } : false), [check, arg], { timeout: 30_000, polling: 'raf' })
        .then(v => v.jsonValue(), () => undefined);
      feel.push({ label, kind, ...(r ?? { ms: -1, f: -1 }) });
      if (!r) fail(`отклик «${label}»: ответа нет за 30 с`);
      else if (r.f > FRAMES[kind]) fail(`отклик «${label}»: ${r.f} кадров (${r.ms} мс) — больше ${FRAMES[kind]}`);
      return r;
    },
    shot: async what => {
      await frames(2);
      const file = join(out, `${prefix}-${String(shots.length + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, label: `${shots.length + 1}. ${what} · ${await clock()}` });
    },
    /** Места — экраном «Кем вы будете»: кнопка «Место», плитки, «Взять». */
    seats: async want => {
      if (!(await page.evaluate(() => !!document.querySelector('#seats')))) await page.click('[data-test=seats-open]');
      await page.waitForSelector('#seats', { timeout: 20_000 });
      const pick = await page.evaluate(() => window.__game.store.get().seats.pick);
      for (const id of ['director', 'production', 'quality', 'supply', 'commerce']) if (pick.includes(id) !== want.includes(id)) await page.click(`[data-test=seat-tile][data-seat=${id}]`);
      await page.click('[data-test=seats-take]');
      await page.waitForFunction(w => [...(window.__game.store.get().top?.seats ?? [])].sort().join() === w, [...want].sort().join(), { timeout: 20_000 });
      await page.evaluate(() => window.__game.actions.setSpeed(0));
    },
    /** Протянуть мышью от клетки до клетки: камера — над серединой протяжки; нажать, провести, отпустить. */
    drag: async (a, b) => {
      await page.evaluate(([p1, p2]) => {
        const c = window.__game.stage.cam;
        c.target.set((p1[0] + p2[0]) / 2 + 0.5, 0, (p1[1] + p2[1]) / 2 + 0.5);
        c.half = Math.max(10, Math.abs(p1[0] - p2[0]), Math.abs(p1[1] - p2[1])) + 4;
      }, [a, b]);
      await frames(3);
      const p = await page.evaluate(([cx, cz]) => window.__game.stage.screen(cx + 0.5, 0, cz + 0.5), a);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      const q2 = await page.evaluate(([cx, cz]) => window.__game.stage.screen(cx + 0.5, 0, cz + 0.5), b);
      await page.mouse.move(q2.x, q2.y, { steps: 6 });
      await frames(2);
      const ghost = await page.evaluate(() => document.querySelector('[data-test=build-ghost]')?.textContent ?? '');
      await page.mouse.up();
      return ghost;
    },
    /** Навести на клетку и прочитать строку призрака. */
    hover: async (x, z) => {
      const p = await at(x, z);
      await page.mouse.move(p.x, p.y);
      await frames(3);
      return page.evaluate(() => document.querySelector('[data-test=build-ghost]')?.textContent ?? '');
    },
    rev: () => page.evaluate(() => window.__game.world.rev),
  };
}

/** Место директора: стройка — корпус, коридор, шлюз, двери, зона и ряд, «нельзя», красная, жёлтая, снос занятого, отмена. */
async function director(x) {
  const { ok, fail, errors } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, x);
  const label = id => page.evaluate(r => document.querySelector(`[data-test=labels] [data-room="${r}"] span`)?.textContent ?? '', id);
  try {
    await s.seats(['director']);
    await s.measure('B — стройка', () => page.keyboard.press('KeyB'), 'panel', undefined, 'input');
    await s.shot('Стройка: панель, стены вниз, подписи помещений');
    const works = await label('hall');
    if (works !== 'работает') fail(`подпись «Общего коридора»: «${works}»`);
    else ok('стройка открыта: панель, стены вниз, над помещениями — «работает»');

    // корпус к востоку от «Общего коридора»: внутренность 10 × 10
    await page.click('[data-test=tool-hull]');
    let rev = await s.rev();
    const hullGhost = await s.drag([59, 18], [70, 29]);
    await page.waitForFunction(r => window.__game.world.rev === r, rev + 1, { timeout: 20_000 }).catch(() => {});
    await s.frames(3);
    const grid = await page.evaluate(() => [window.__game.layout.w, window.__game.layout.h]);
    await s.shot('Корпус: пристройка к востоку');
    if (!/^Корпус 12 × 12 м — [\d\s]+\s₽$/.test(hullGhost) || grid[0] !== 71) fail(`корпус: призрак «${hullGhost}», сетка ${grid}`);
    else ok(`корпус: «${hullGhost}», сетка ${grid.join(' × ')}`);

    // коридор в пристройке: без двери — красный, «от входа не дойти»
    await page.click('[data-test=tool-room]');
    await page.selectOption('[data-test=room-type]', 'corridor');
    rev = await s.rev();
    const corrGhost = await s.drag([59, 20], [70, 24]);
    await page.waitForFunction(r => window.__game.world.rev === r, rev + 1, { timeout: 20_000 }).catch(() => {});
    await page.waitForFunction(() => /не работает: от входа не дойти/.test(document.querySelector('[data-test=labels] [data-room="corridor-1"] span')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
    const corrLabel = await label('corridor-1');
    await s.shot('Коридор без двери: красный');
    if (!/^Общий коридор 12 × 5 м — [\d\s]+\s₽ — не будет работать: от входа не дойти: Общий коридор 1$/.test(corrGhost) || !/^не работает: от входа не дойти/.test(corrLabel)) fail(`коридор: призрак «${corrGhost}», подпись «${corrLabel}»`);
    else ok(`коридор: «${corrGhost}» · «${corrLabel}»`);

    // дверь из «Общего коридора»: коридор закрыт на перестройку; сцена заново — теми же программами отрисовщика, шейдеры
    // заново не собираются (Stage.setLayout освобождает прежнюю сцену после кадра новой)
    await page.click('[data-test=tool-door]');
    const doorGhost = await s.hover(59, 22);
    rev = await s.rev();
    const progs = () => page.evaluate(() => window.__game.stage.renderer.info.programs.map(p => p.id).sort((a, b) => a - b).join());
    const before = await progs();
    await s.measure('Дверь — новый план, сцена заново', () => page.mouse.down().then(() => page.mouse.up()), 'rev', rev + 1);
    await page.waitForFunction(() => /закрыто на перестройку/.test(document.querySelector('[data-test=labels] [data-room="corridor-1"] span')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
    await s.frames(3);
    const after = await progs();
    const doorLabel = await label('corridor-1');
    if (!/^Дверь — [\d\s]+\s₽$/.test(doorGhost) || doorLabel !== 'закрыто на перестройку') fail(`дверь: призрак «${doorGhost}», подпись «${doorLabel}»`);
    else if (after !== before) fail(`дверь: программы отрисовщика собраны заново — было ${before}, стало ${after}`);
    else ok(`дверь: «${doorGhost}» · коридор «${doorLabel}» · программ отрисовщика те же ${before.split(',').length}`);

    // шлюз для людей класса D из нового коридора
    await page.click('[data-test=tool-room]');
    await page.selectOption('[data-test=room-type]', 'airlock.people');
    rev = await s.rev();
    const alGhost = await s.drag([62, 24], [65, 27]);
    await page.waitForFunction(r => window.__game.world.rev === r, rev + 1, { timeout: 20_000 }).catch(() => {});
    await page.click('[data-test=tool-door]');
    await s.hover(63, 24);
    rev = await s.rev();
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(r => window.__game.world.rev === r, rev + 1, { timeout: 20_000 }).catch(() => {});
    await s.frames(3);
    await s.shot('Шлюз для людей и дверь в него');
    const plan1 = await page.evaluate(() => window.__seen.plan().rooms.map(r => r.id));
    if (!/^Шлюз для людей 4 × 4 м — [\d\s]+\s₽/.test(alGhost) || !plan1.includes('airlock.people-1')) fail(`шлюз: призрак «${alGhost}», помещения ${plan1.join(', ')}`);
    else ok(`шлюз: «${alGhost}»`);

    // «нельзя»: дверь на улицу — план тот же
    const street = await s.hover(30, 39);
    rev = await s.rev();
    await page.mouse.down();
    await page.mouse.up();
    await s.frames(10);
    if (!/^Дверь: нельзя — дверь на улицу — только рампы и вход$/.test(street) || (await s.rev()) !== rev) fail(`дверь на улицу: «${street}», правка ${await s.rev()} вместо ${rev}`);
    else ok(`нельзя: «${street}»`);

    // зона карантина ГП у паллетирования и ряд стеллажа: склад закрыт на перестройку
    await page.click('[data-test=tool-zone]');
    await page.selectOption('[data-test=zone-kind]', 'fgQuarantine');
    rev = await s.rev();
    const zoneGhost = await s.drag([21, 13], [22, 14]);
    await page.waitForFunction(r => window.__game.world.rev === r, rev + 1, { timeout: 20_000 }).catch(() => {});
    await page.click('[data-test=tool-rack]');
    await page.fill('[data-test=rack-bays]', '1');
    await page.fill('[data-test=rack-levels]', '2');
    const rackGhost = await s.hover(13, 34);
    rev = await s.rev();
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(r => window.__game.world.rev === r, rev + 1, { timeout: 20_000 }).catch(() => {});
    await page.waitForFunction(() => /закрыто на перестройку/.test(document.querySelector('[data-test=labels] [data-room="warehouse"] span')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
    const whLabel = await label('warehouse');
    await s.shot('Склад: зона и ряд стеллажа, закрыт на перестройку');
    if (!/^Зона «Карантин ГП» 2 × 2 м — мест: 1$/.test(zoneGhost) || !/^Стеллаж: секций 1, ярусов 2 — [\d\s]+\s₽$/.test(rackGhost) || whLabel !== 'закрыто на перестройку') fail(`склад: зона «${zoneGhost}», ряд «${rackGhost}», подпись «${whLabel}»`);
    else ok(`склад: «${zoneGhost}», «${rackGhost}» · «${whLabel}»`);
    await s.measure('«Готово» — склад работает', () => page.click('[data-test=build-done]'), 'label', ['warehouse', '^работает$']);

    // красная: дверь из общего коридора в упаковку мимо шлюза; отмена
    await page.click('[data-test=tool-door]');
    const red = await s.hover(40, 21);
    rev = await s.rev();
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(() => /^не работает: вход в класс D — не через шлюз$/.test(document.querySelector('[data-test=labels] [data-room="packaging"] span')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
    const redLabel = await label('packaging');
    await s.shot('Красная: дверь в упаковку мимо шлюза');
    if (!/^Дверь — [\d\s]+\s₽ — не будет работать: вход в класс D — не через шлюз$/.test(red) || redLabel !== 'не работает: вход в класс D — не через шлюз') fail(`красная: призрак «${red}», подпись «${redLabel}»`);
    else ok(`красная: «${red}» · «${redLabel}»`);
    await s.measure('Ctrl+Z — отмена', () => page.keyboard.press('Control+KeyZ'), 'label', ['packaging', '^работает$']);

    // жёлтая: у мойки один проём; отмена
    await page.click('[data-test=tool-demolish]');
    const yellow = await s.hover(58, 9);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(() => /^замечание: у мойки один проём/.test(document.querySelector('[data-test=labels] [data-room="washing"] span')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
    const yLabel = await label('washing');
    await s.shot('Жёлтая: у мойки один проём');
    if (!/^Снести: Дверь — вернётся [\d\s]+\s₽ — замечание: у мойки один проём на вход грязного и выход чистого$/.test(yellow) || !/^замечание: у мойки один проём/.test(yLabel)) fail(`жёлтая: призрак «${yellow}», подпись «${yLabel}»`);
    else ok(`жёлтая: «${yellow}» · «${yLabel}»`);
    await page.keyboard.press('Control+KeyZ');
    await page.waitForFunction(() => /^работает$/.test(document.querySelector('[data-test=labels] [data-room="washing"] span')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});

    // снос занятого: ряд стеллажа с паллетами — «когда освободится»; отмена
    const busy = await page.evaluate(() => window.__game.builder.view?.busy.find(id => window.__game.layout.plan.plant.racks.some(r => r.id === id)));
    if (!busy) fail('снос занятого: занятого ряда нет');
    else {
      const r = await page.evaluate(id => window.__game.layout.plan.plant.racks.find(q => q.id === id), busy);
      const later = await s.hover(Math.floor(r.x / 100) + 1, Math.floor(r.z / 100));
      rev = await s.rev();
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForFunction(() => /^Снесётся, когда освободится$/.test(document.querySelector('[data-test=build-result]')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
      const res = await page.evaluate(() => document.querySelector('[data-test=build-result]')?.textContent ?? '');
      const still = await page.evaluate(id => window.__game.layout.plan.plant.racks.some(q => q.id === id), busy);
      await s.shot('Снос занятого ряда: когда освободится');
      if (!/ — когда освободится$/.test(later) || res !== 'Снесётся, когда освободится' || !still || (await s.rev()) !== rev) fail(`снос занятого: призрак «${later}», ответ «${res}», зона на месте ${still}`);
      else ok(`снос занятого: «${later}» · «${res}»`);
      await page.keyboard.press('Control+KeyZ');
      await page.waitForFunction(() => (window.__game.builder.view?.leaving.length ?? 1) === 0, null, { timeout: 20_000 }).catch(() => {});
      const left = await page.evaluate(() => window.__game.builder.view?.leaving.length);
      if (left !== 0) fail(`отмена сноса: сносимого — ${left}`);
      else ok(`отмена: снос занятого ряда ${busy} отменён`);
    }

    // выход из стройки — «Готово», стены — как были
    await page.keyboard.press('KeyB');
    await page.waitForFunction(() => !window.__game.store.get().build.on && window.__game.store.get().walls !== 'down', null, { timeout: 20_000 });
    const spent = await page.evaluate(() => window.__game.builder.view?.spent ?? 0);

    // паллета едет в новое место: первая паллета готовой продукции ложится в новую зону карантина ГП
    let placed = false;
    // промотка встаёт и на автопаузах: до 9 сентября — не больше двадцати промоток
    for (let d = 0; d < 20 && !placed && (await page.evaluate(() => window.__game.t)) < 8 * 86400; d++) {
      // «До утра» (5): планёрку — закрыть, совещание S&OP — тоже; паллета ложится днём — смотреть после каждой промотки
      for (let k = 0; k < 4 && (await page.evaluate(() => { const h = window.__game.store.get(); return h.morning.open || h.sop.open; })); k++) await page.keyboard.press('Escape');
      await page.keyboard.press('Digit5');
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
      await s.frames(2);
      placed = await page.evaluate(() => window.__seen.placed('zone-1'));
    }
    for (let k = 0; k < 4 && (await page.evaluate(() => { const h = window.__game.store.get(); return h.morning.open || h.sop.open; })); k++) await page.keyboard.press('Escape');
    await s.frames(3);
    await s.at(22, 14);
    await s.shot('Паллета ГП в новой зоне');
    if (!placed) fail(`новая зона карантина ГП: паллеты в ней нет — ${await s.clock()}`);
    else ok(`паллета ГП в новой зоне — ${await s.clock()}; потрачено на стройку ${Math.round(spent / 100).toLocaleString('ru')} ₽`);
    if (errors.length) fail(`ошибки страницы: ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await ctx.close();
  }
}
