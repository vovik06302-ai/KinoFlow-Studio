import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UpdateManager } from './appUpdater.js';
import { ModelDownloadManager, scanModelsDirectory } from './modelDownloader.js';
import { performComfyRequest, probeLocalComfyUrls } from './comfyBridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_COMFY_HTTP_FILTERS = [
  'http://127.0.0.1:*/*',
  'http://localhost:*/*',
  'http://[::1]:*/*',
  'http://192.168.*/*',
  'http://10.*/*',
];

const LOCAL_COMFY_ALL_FILTERS = [
  ...LOCAL_COMFY_HTTP_FILTERS,
  'ws://127.0.0.1:*/*',
  'ws://localhost:*/*',
  'ws://[::1]:*/*',
  'ws://192.168.*/*',
  'ws://10.*/*',
];

const modelDownloadManager = new ModelDownloadManager();
let ipcRegistered = false;
let updaterRegistered = false;

/**
 * Configures Electron session headers so the packaged React UI (loaded via file://)
 * can directly stream videos, open WebSockets, and send requests to a local/LAN ComfyUI
 * server on any port (8188 Portable, 8000 Desktop, etc.) without Origin, CORS, or
 * Chromium Private Network Access rejections.
 */
function configureLocalComfyAccess() {
  const defaultSession = session.defaultSession;

  defaultSession.webRequest.onBeforeSendHeaders(
    { urls: LOCAL_COMFY_ALL_FILTERS },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      try {
        const parsed = new URL(details.url);
        const httpProtocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
        requestHeaders.Origin = `${httpProtocol}//${parsed.host}`;
      } catch {
        requestHeaders.Origin = 'http://127.0.0.1:8188';
      }
      callback({ requestHeaders });
    },
  );

  defaultSession.webRequest.onHeadersReceived(
    { urls: LOCAL_COMFY_HTTP_FILTERS },
    (details, callback) => {
      const headers = { ...(details.responseHeaders ?? {}) };

      // Strip existing case-variant CORS headers before injecting canonical values
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (
          lower === 'access-control-allow-origin' ||
          lower === 'access-control-allow-methods' ||
          lower === 'access-control-allow-headers' ||
          lower === 'access-control-allow-private-network'
        ) {
          delete headers[key];
        }
      }

      headers['Access-Control-Allow-Origin'] = ['*'];
      headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
      headers['Access-Control-Allow-Headers'] = ['*'];
      headers['Access-Control-Allow-Private-Network'] = ['true'];

      const responseUpdate = { responseHeaders: headers };
      // If ComfyUI was started without --enable-cors-header "*", OPTIONS preflights return 405;
      // rewrite to 204 so Chromium allows the follow-up request cleanly.
      if (details.method === 'OPTIONS' && details.statusCode >= 400) {
        responseUpdate.statusLine = 'HTTP/1.1 204 No Content';
      }

      callback(responseUpdate);
    },
  );
}

function registerModelManagerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  modelDownloadManager.subscribe((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('models:progress', event);
      }
    }
  });

  ipcMain.handle('comfy:request', async (_event, options) => {
    return performComfyRequest(options);
  });

  ipcMain.handle('comfy:probe', async (_event, payload) => {
    const { excludeBaseUrl, candidatePorts } = payload ?? {};
    return probeLocalComfyUrls(excludeBaseUrl, candidatePorts);
  });

  ipcMain.handle('models:select-dir', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: 'Выберите папку ComfyUI (например, C:\\ComfyUI_windows_portable\\ComfyUI)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('models:scan', async (_event, comfyDir) => {
    return scanModelsDirectory(comfyDir);
  });

  ipcMain.handle('models:download', async (_event, payload) => {
    const { comfyDir, modelIds } = payload ?? {};
    return modelDownloadManager.startQueue(comfyDir, modelIds);
  });

  ipcMain.handle('models:cancel', async (_event, modelId) => {
    return modelDownloadManager.cancel(modelId);
  });

  ipcMain.handle('models:state', async () => {
    return modelDownloadManager.getSnapshot();
  });

  ipcMain.handle('models:open-folder', async (_event, targetPath) => {
    if (typeof targetPath === 'string' && targetPath.trim()) {
      const resolved = path.resolve(targetPath.trim());
      if (fs.existsSync(resolved)) {
        await shell.openPath(resolved);
      }
    }
  });
}

function registerUpdaterIpc() {
  if (updaterRegistered) return;
  updaterRegistered = true;

  const updateManager = new UpdateManager({
    currentVersion: app.getVersion(),
    tempDir: path.join(app.getPath('temp'), 'KinoFlowStudio-update'),
  });

  updateManager.subscribe((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('update:progress', event);
      }
    }
  });

  ipcMain.handle('update:version', async () => app.getVersion());

  ipcMain.handle('update:check', async () => {
    try {
      return await updateManager.check();
    } catch (error) {
      return {
        available: false,
        currentVersion: app.getVersion(),
        latestVersion: null,
        error: String(error?.message ?? error),
      };
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      await updateManager.download();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  ipcMain.handle('update:cancel', async () => updateManager.cancel());

  ipcMain.handle('update:install', async () => {
    try {
      updateManager.install();
      // Give the installer a moment to start, then close the app so files can be replaced.
      setTimeout(() => app.quit(), 800);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
}

function resolveRendererEntry() {
  const rendererPath = path.join(__dirname, '..', 'build-renderer', 'index.html');
  if (fs.existsSync(rendererPath)) {
    return rendererPath;
  }
  return path.join(__dirname, '..', 'dist', 'index.html');
}

function createMainWindow() {
  Menu.setApplicationMenu(null);

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'KinoFlow Studio',
    backgroundColor: '#0B0D11',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_DEV_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(resolveRendererEntry());
  }
}

app.whenReady().then(() => {
  configureLocalComfyAccess();
  registerModelManagerIpc();
  registerUpdaterIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  modelDownloadManager.cancel();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
