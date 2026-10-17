// из bolnitsa: electron/preload.cjs @ e0a3491
// Мостик страницы к оболочке: только то, что нужно игре и бенчу (аргументы, память, сведения, запись итога и снимков,
// перезапуск без vsync).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  args: () => ipcRenderer.invoke('shell:args'),
  save: json => ipcRenderer.invoke('shell:save', json),
  saveShot: (name, dataUrl) => ipcRenderer.invoke('shell:shot', name, dataUrl),
  metrics: () => ipcRenderer.invoke('shell:metrics'),
  info: () => ipcRenderer.invoke('shell:info'),
  firstFrame: ms => ipcRenderer.send('shell:first-frame', ms),
  relaunch: args => ipcRenderer.send('shell:relaunch', args),
});
