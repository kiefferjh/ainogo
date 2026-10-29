const { contextBridge, ipcRenderer } = require('electron');

// Expose specific operations, never Node, arbitrary IPC, or arbitrary paths.
contextBridge.exposeInMainWorld('ainogoDesktop', {
  listKeys: () => ipcRenderer.sendSync('sessions:list'),
  getItem: key => ipcRenderer.sendSync('sessions:get', key),
  setItem: (key, raw) => ipcRenderer.sendSync('sessions:save', key, raw),
  info: () => ipcRenderer.sendSync('sessions:info'),
  exportCsv: raw => ipcRenderer.invoke('sessions:export', raw),
  openFolder: () => ipcRenderer.invoke('sessions:open-folder'),
});
