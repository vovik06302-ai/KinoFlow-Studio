const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kinoflowModels', {
  isElectron: true,
  selectComfyDirectory: () => ipcRenderer.invoke('models:select-dir'),
  scanModels: (comfyDir) => ipcRenderer.invoke('models:scan', comfyDir),
  startDownload: (comfyDir, modelIds) =>
    ipcRenderer.invoke('models:download', { comfyDir, modelIds }),
  cancelDownload: (modelId) => ipcRenderer.invoke('models:cancel', modelId),
  getDownloadState: () => ipcRenderer.invoke('models:state'),
  openFolder: (targetPath) => ipcRenderer.invoke('models:open-folder', targetPath),
  onProgress: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('models:progress', listener);
    return () => {
      ipcRenderer.removeListener('models:progress', listener);
    };
  },
});

contextBridge.exposeInMainWorld('kinoflowComfy', {
  isElectron: true,
  request: (options) => ipcRenderer.invoke('comfy:request', options),
  probe: (excludeBaseUrl, candidatePorts) =>
    ipcRenderer.invoke('comfy:probe', { excludeBaseUrl, candidatePorts }),
});
