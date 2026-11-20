// из bolnitsa: electron/preload.cjs @ e0a3491
// Мостик страницы к оболочке: только то, что нужно игре и бенчу (аргументы, память, сведения, запись итога и снимков,
// перезапуск без vsync; сохранения в папке игры и сохранение при выходе — из bolnitsa: electron/preload.cjs @ 15a7ad6,
// docs/specs/2026-10-vertical-slice.md, «Сохранения»).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  args: () => ipcRenderer.invoke('shell:args'),
  save: json => ipcRenderer.invoke('shell:save', json),
  saveShot: (name, dataUrl) => ipcRenderer.invoke('shell:shot', name, dataUrl),
  metrics: () => ipcRenderer.invoke('shell:metrics'),
  info: () => ipcRenderer.invoke('shell:info'),
  firstFrame: ms => ipcRenderer.send('shell:first-frame', ms),
  relaunch: args => ipcRenderer.send('shell:relaunch', args),
  saves: {
    read: name => ipcRenderer.invoke('saves:read', name),
    write: (name, bytes) => ipcRenderer.invoke('saves:write', name, bytes),
    move: (from, to) => ipcRenderer.invoke('saves:move', from, to),
    remove: name => ipcRenderer.invoke('saves:remove', name),
    list: () => ipcRenderer.invoke('saves:list'),
  },
  /** окно закрывают: страница сохраняется и зовёт `closeNow` */
  onClosing: cb => ipcRenderer.on('shell:closing', () => cb()),
  closeNow: () => ipcRenderer.send('shell:close-now'),
});
