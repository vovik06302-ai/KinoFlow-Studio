import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelDownloadManager, scanModelsDirectory } from './modelDownloader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_COMFY_FILTERS = [
  'http://127.0.0.1:8188/*',
  'http://localhost:8188/*',
  'ws://127.0.0.1:8188/*',
  'ws://localhost:8188/*',
];

const modelDownloadManager = new ModelDownloadManager();
let ipcRegistered = false;

/**
 * Configures Electron session headers so the packaged React UI (loaded via file://)
 * can directly communicate with a local ComfyUI server at http://127.0.0.1:8188
 * without Origin or CORS rejections.
 */
function configureLocalComfyAccess() {
  const defaultSession = session.defaultSession;

  defaultSession.webRequest.onBeforeSendHeaders(
    { urls: LOCAL_COMFY_FILTERS },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      requestHeaders.Origin = 'http://127.0.0.1:8188';
      callback({ requestHeaders });
    },
  );

  defaultSession.webRequest.onHeadersReceived(
    { urls: ['http://127.0.0.1:8188/*', 'http://localhost:8188/*'] },
    (details, callback) => {
      const headers = { ...(details.responseHeaders ?? {}) };

      // Strip existing case-variant CORS headers before injecting canonical values
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (
          lower === 'access-control-allow-origin' ||
          lower === 'access-control-allow-methods' ||
          lower === 'access-control-allow-headers'
        ) {
          delete headers[key];
        }
      }

      headers['Access-Control-Allow-Origin'] = ['*'];
      headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
      headers['Access-Control-Allow-Headers'] = ['*'];

      callback({ responseHeaders: headers });
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
