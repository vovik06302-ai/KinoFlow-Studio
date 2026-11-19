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

contextBridge.exposeInMainWorld('kinoflowUpdater', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('update:version'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  cancelDownload: () => ipcRenderer.invoke('update:cancel'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onProgress: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('update:progress', listener);
    return () => {
      ipcRenderer.removeListener('update:progress', listener);
    };
  },
});
