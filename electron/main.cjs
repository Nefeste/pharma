// из bolnitsa: electron/main.cjs @ e0a3491 — изменено: заголовок окна. Авто-бенч страницы (--bench) — бенч сцены завода
// (src/app/bench.ts; docs/specs/2026-10-view.md, 2г), окно бенча развёрнуто (перенести в «Больницу»).
// Оболочка Electron (spec docs/specs/2026-10-shell-3d.md, «Процессы и потоки»): окно, страница из dist/ по своей схеме
// app:// (без dev-сервера и без сети), запись итога бенча и снимков в файлы рядом с .exe/AppImage.
//
//   electron .                          — игра
//   electron . --bench [--secs 15]      — авто-бенч: пресеты × общий план и крупный план, 4 снимка; итог — bench-*.json и *.png
//              [--warm 3] [--qualities low,high] [--shots 0]
//   --uncapped                          — без вертикальной синхронизации: видно запас
//   --stay                              — не закрываться после бенча
//   --swiftshader                       — программный WebGL (контейнер без видеокарты), без сторожа видеопроцесса
//   --q low|medium|high                 — пресет качества
const { app, BrowserWindow, ipcMain, protocol, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const t0 = Date.now();
const argv = process.argv;
const has = k => argv.includes(`--${k}`);

if (has('uncapped')) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (has('swiftshader') || has('probe-swiftshader')) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  // программный WebGL рисует кадр «высокого» секундами: сторож видеопроцесса считает это зависанием и убивает его
  app.commandLine.appendSwitch('disable-gpu-watchdog');
}

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const DIST = path.join(__dirname, '..', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};
const timings = { processToReadyMs: 0, readyToShowMs: 0, firstFrameMs: 0, processStartToFirstFrameMs: 0 };
let blocked = 0;

async function metrics() {
  const list = app.getAppMetrics();
  const byType = {};
  let ws = 0;
  let priv = 0;
  for (const m of list) {
    ws += m.memory.workingSetSize;
    priv += m.memory.privateBytes ?? 0;
    byType[m.type] = Math.round(((byType[m.type] ?? 0) * 1024 + m.memory.workingSetSize) / 1024);
  }
  // workingSetSize — в килобайтах
  return { workingSetMB: Math.round(ws / 1024), privateMB: Math.round(priv / 1024), byType };
}

/** Куда положить итог: рядом с .exe/AppImage, иначе в «Документы», иначе в домашнюю папку. */
function saveDirs() {
  const dirs = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) dirs.push(process.env.PORTABLE_EXECUTABLE_DIR);
  if (process.env.APPIMAGE) dirs.push(path.dirname(process.env.APPIMAGE));
  if (app.isPackaged) dirs.push(path.dirname(process.execPath));
  else dirs.push(process.cwd());
  dirs.push(app.getPath('documents'), os.homedir());
  return dirs;
}

app.whenReady().then(async () => {
  timings.processToReadyMs = Math.round(process.uptime() * 1000);

  protocol.handle('app', async req => {
    const { pathname } = new URL(req.url);
    const file = path.resolve(DIST, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    try {
      // fs читает и из app.asar — в собранной версии страница лежит там
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  // Сети нет: любой запрос наружу отменяется и считается.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
    blocked++;
    console.log(`[net] blocked: ${d.url}`);
    cb({ cancel: true });
  });
  // Проверка орфографии Chromium сама качает словари с серверов Google (redirector.gvt1.com) мимо фильтра выше — она
  // выключена, а адрес словарей указывает внутрь игры
  session.defaultSession.setSpellCheckerEnabled(false);
  session.defaultSession.setSpellCheckerLanguages([]);
  session.defaultSession.setSpellCheckerDictionaryDownloadURL('app://game/');

  ipcMain.handle('shell:args', () => argv.slice(1));
  ipcMain.handle('shell:metrics', () => metrics());
  ipcMain.handle('shell:info', async () => {
    let gpu = null;
    try {
      gpu = await app.getGPUInfo('basic');
    } catch {}
    return {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${os.release()} ${process.arch}`,
      cpu: os.cpus()[0]?.model ?? null,
      cpuCount: os.cpus().length,
      ramGB: Math.round(os.totalmem() / 1073741824),
      gpuFeatureStatus: app.getGPUFeatureStatus(),
      gpu,
      vsync: !has('uncapped'),
      startup: timings,
      blockedRequests: blocked,
      memoryAtEnd: await metrics(),
    };
  });
  // Снимки и итог ложатся в одну папку — первую, куда удалось записать
  let outDir = null;
  const write = (name, data) => {
    for (const dir of outDir ? [outDir] : saveDirs()) {
      try {
        fs.writeFileSync(path.join(dir, name), data);
        outDir = dir;
        return path.join(dir, name);
      } catch {}
    }
    return null;
  };
  ipcMain.handle('shell:shot', async (_e, name, dataUrl) => {
    const safe = String(name).replace(/[^\w.-]/g, '_');
    const saved = write(safe, Buffer.from(String(dataUrl).split(',')[1] ?? '', 'base64'));
    console.log(`[bench] shot: ${saved}`);
    return saved ?? 'cannot write file';
  });
  ipcMain.handle('shell:save', async (_e, json) => {
    const stamp = (() => {
      try {
        return JSON.parse(json).shots?.[0]?.name?.match(/bench-electron-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d)-/)?.[1];
      } catch {
        return null;
      }
    })();
    const name = `bench-electron-${stamp ?? new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    const saved = write(name, json);
    console.log(`[bench] result: ${saved}`);
    if (has('bench') && !has('stay')) setTimeout(() => app.exit(0), 500);
    return saved ?? 'cannot write file';
  });
  ipcMain.on('shell:first-frame', (_e, ms) => {
    timings.firstFrameMs = Math.round(ms);
    timings.processStartToFirstFrameMs = Math.round(process.uptime() * 1000);
    console.log(`[startup] process start to first frame: ${timings.processStartToFirstFrameMs} ms`);
  });
  // перезапуск с другими ключами (авто-бенч без vsync из меню): ключи вертикальной синхронизации — до старта процесса
  ipcMain.on('shell:relaunch', (_e, extra) => {
    const keep = argv.slice(1).filter(a => !['--bench', '--uncapped', '--stay'].includes(a));
    app.relaunch({ args: [...keep, ...extra.map(String)] });
    app.exit(0);
  });

  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    backgroundColor: '#2a3236',
    title: 'Farmzavod',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.once('ready-to-show', () => {
    timings.readyToShowMs = Date.now() - t0;
    // бенч — во весь экран с первого прогона: окно 1600 × 900, развёрнутое посреди бенча, сбивало первый прогон
    // (замер владельца 19.10.2026; перенести в «Больницу»)
    if (has('bench')) win.maximize();
    win.show();
  });
  win.webContents.on('console-message', e => {
    const msg = e.message ?? '';
    if (msg.startsWith('[') || msg.startsWith('BENCH_RESULT') || e.level === 'error') console.log(msg.length > 400 ? `${msg.slice(0, 400)}…` : msg);
  });
  const q = new URLSearchParams();
  const v = k => {
    const i = argv.indexOf(`--${k}`);
    return i > 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  if (v('q')) q.set('q', v('q'));
  await win.loadURL(`app://game/index.html${q.size ? `?${q}` : ''}`);
});

app.on('window-all-closed', () => app.quit());
