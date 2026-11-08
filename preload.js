const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a),
  send: (ch, ...a) => ipcRenderer.send(ch, ...a),
  on: (ch, fn) => { const h = (e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); },
  // đường dẫn thật của file kéo thả từ ngoài vào
  pathForFile: f => { try { return webUtils.getPathForFile(f) || ''; } catch { return (f && f.path) || ''; } },
  isElectron: true,
});
