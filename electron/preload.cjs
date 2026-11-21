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

contextBridge.exposeInMainWorld('kinoflowFilm', {
  isElectron: true,
  checkFfmpeg: () => ipcRenderer.invoke('film:check-ffmpeg'),
  selectAudio: () => ipcRenderer.invoke('film:select-audio'),
  mergeSegments: (segmentUrls, suggestedName, audioOptions) =>
    ipcRenderer.invoke('film:merge', {
      segmentUrls,
      suggestedName,
      audioPath: audioOptions?.audioPath,
      audioVolume: audioOptions?.audioVolume,
    }),
  extractLastFrame: (videoUrl) =>
    ipcRenderer.invoke('film:extract-last-frame', { videoUrl }),
  archiveClip: (videoUrl, filename) =>
    ipcRenderer.invoke('film:archive-clip', { videoUrl, filename }),
  showFile: (filePath) => ipcRenderer.invoke('film:show-file', filePath),
  onProgress: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('film:progress', listener);
    return () => {
      ipcRenderer.removeListener('film:progress', listener);
    };
  },
});

contextBridge.exposeInMainWorld('kinoflowLauncher', {
  isElectron: true,
  getState: (instanceId) => ipcRenderer.invoke('comfy:launcher-state', instanceId),
  getAllStates: () => ipcRenderer.invoke('comfy:launcher-states'),
  detectDir: () => ipcRenderer.invoke('comfy:launcher-detect'),
  start: (payload) => ipcRenderer.invoke('comfy:launcher-start', payload),
  stop: (payload) => ipcRenderer.invoke('comfy:launcher-stop', payload),
  installFlushFix: (comfyDir) => ipcRenderer.invoke('comfy:launcher-install-flush-fix', comfyDir),
  restart: (payload) => ipcRenderer.invoke('comfy:launcher-restart', payload),
  getGpuUsage: () => ipcRenderer.invoke('comfy:gpu-usage'),
  onGpuUsage: (callback) => {
    let active = true;
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('comfy:gpu-usage-update', listener);
    ipcRenderer.send('comfy:gpu-watch', true);
    return () => {
      if (!active) return;
      active = false;
      ipcRenderer.removeListener('comfy:gpu-usage-update', listener);
      ipcRenderer.send('comfy:gpu-watch', false);
    };
  },
  onEvent: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('comfy:launcher-event', listener);
    return () => {
      ipcRenderer.removeListener('comfy:launcher-event', listener);
    };
  },
});
