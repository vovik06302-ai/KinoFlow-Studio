import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UpdateManager } from './appUpdater.js';
import { ModelDownloadManager, scanModelsDirectory } from './modelDownloader.js';
import {
  DEFAULT_COMFY_PROBE_PORTS,
  performComfyRequest,
  probeLocalComfyUrls,
} from './comfyBridge.js';
import { ComfyLauncher, findLaunchScript } from './comfyLauncher.js';
import { findFfmpeg, isHttpUrl, mergeSegments } from './filmMerger.js';
import {
  appendStartupLog,
  isLocalComfyHttpUrl,
  isLocalComfyUrl,
  resolveRendererEntryPath,
  resolveWindowIconPath,
} from './startupHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modelDownloadManager = new ModelDownloadManager();
let ipcRegistered = false;
let updaterRegistered = false;
let mainWindowRef = null;

// ---- Автозапуск ComfyUI вместе с программой ----

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'launcher-settings.json');
}

function readSavedComfyDir() {
  try {
    const data = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
    return typeof data?.comfyDir === 'string' ? data.comfyDir : '';
  } catch {
    return '';
  }
}

function saveComfyDir(comfyDir) {
  if (typeof comfyDir !== 'string' || !comfyDir.trim()) return;
  try {
    if (readSavedComfyDir() === comfyDir.trim()) return;
    fs.writeFileSync(getSettingsPath(), JSON.stringify({ comfyDir: comfyDir.trim() }), 'utf-8');
  } catch (error) {
    logStartupError('saveComfyDir', error);
  }
}

function isPortOpen(port, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function autoStartComfy() {
  try {
    const comfyDir = readSavedComfyDir();
    if (!comfyDir) return; // папка ещё не выбрана — запуск вручную один раз сохранит её
    const portStates = await Promise.all(
      DEFAULT_COMFY_PROBE_PORTS.map((port) => isPortOpen(port)),
    );
    if (portStates.some(Boolean)) return; // ComfyUI уже работает (Portable 8188 / Desktop 8000 / 8189)
    const scriptPath = findLaunchScript(comfyDir);
    if (!scriptPath) return;
    await comfyLauncher.start(scriptPath);
  } catch (error) {
    logStartupError('autoStartComfy', error);
  }
}

function getStartupLogPath() {
  try {
    return path.join(app.getPath('userData'), 'startup.log');
  } catch {
    return null;
  }
}

function logStartupError(label, error) {
  console.error(`[KinoFlow] ${label}:`, error);
  appendStartupLog(getStartupLogPath(), label, error);
}

process.on('uncaughtException', (error) => {
  logStartupError('uncaughtException', error);
  if (app.isReady()) {
    dialog.showErrorBox(
      'KinoFlow Studio — ошибка запуска',
      `Произошла непредвиденная ошибка:\n${error?.message ?? error}\n\nЛог сохранён в: ${getStartupLogPath() ?? 'папке данных приложения'}`,
    );
  }
});

process.on('unhandledRejection', (reason) => {
  logStartupError('unhandledRejection', reason);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const target = mainWindowRef ?? BrowserWindow.getAllWindows()[0];
    if (target && !target.isDestroyed()) {
      if (target.isMinimized()) target.restore();
      if (!target.isVisible()) target.show();
      target.focus();
    }
  });
}

/**
 * Configures Electron session headers so the packaged React UI (loaded via file://)
 * can directly stream videos, open WebSockets, and send requests to a local/LAN ComfyUI
 * server on any port (8188 Portable, 8000 Desktop, etc.) without Origin, CORS, or
 * Chromium Private Network Access rejections.
 *
 * Uses programmatic host filtering instead of Chromium `URLPattern` strings because
 * trailing wildcards in IP hostnames (192.168.x.x / 10.x.x.x) throw
 * `Invalid url pattern` and abort app startup.
 */
function configureLocalComfyAccess() {
  try {
    const defaultSession = session.defaultSession;

    defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (!isLocalComfyUrl(details.url)) {
        callback({});
        return;
      }
      const requestHeaders = { ...details.requestHeaders };
      try {
        const parsed = new URL(details.url);
        const httpProtocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
        requestHeaders.Origin = `${httpProtocol}//${parsed.host}`;
      } catch {
        requestHeaders.Origin = 'http://127.0.0.1:8188';
      }
      callback({ requestHeaders });
    });

    defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (!isLocalComfyHttpUrl(details.url)) {
        callback({});
        return;
      }
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
    });
  } catch (error) {
    logStartupError('configureLocalComfyAccess', error);
  }
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
    saveComfyDir(comfyDir);
    return scanModelsDirectory(comfyDir);
  });

  ipcMain.handle('models:download', async (_event, payload) => {
    const { comfyDir, modelIds } = payload ?? {};
    saveComfyDir(comfyDir);
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

let launcherIpcRegistered = false;
const comfyLauncher = new ComfyLauncher();

function registerLauncherIpc() {
  if (launcherIpcRegistered) return;
  launcherIpcRegistered = true;

  comfyLauncher.subscribe((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('comfy:launcher-event', event);
    }
  });

  ipcMain.handle('comfy:launcher-state', async () => comfyLauncher.getState());

  ipcMain.handle('comfy:launcher-start', async (_event, comfyDir) => {
    saveComfyDir(comfyDir);
    const scriptPath = findLaunchScript(typeof comfyDir === 'string' ? comfyDir : '');
    return comfyLauncher.start(scriptPath);
  });

  ipcMain.handle('comfy:launcher-stop', async () => comfyLauncher.stop());

  // Do not leave an orphaned ComfyUI running when the app is closed after starting it from here.
  app.on('before-quit', () => {
    comfyLauncher.stop();
  });
}

let filmIpcRegistered = false;

function registerFilmIpc() {
  if (filmIpcRegistered) return;
  filmIpcRegistered = true;

  ipcMain.handle('film:check-ffmpeg', async () => ({ ffmpegPath: await findFfmpeg() }));

  ipcMain.handle('film:merge', async (event, payload) => {
    const segmentUrls = Array.isArray(payload?.segmentUrls) ? payload.segmentUrls : [];
    if (segmentUrls.length === 0 || segmentUrls.length > 24 || !segmentUrls.every(isHttpUrl)) {
      return { ok: false, error: 'Некорректный список сегментов для склейки.' };
    }

    const ffmpegPath = await findFfmpeg();
    if (!ffmpegPath) {
      return {
        ok: false,
        code: 'FFMPEG_NOT_FOUND',
        error:
          'FFmpeg не найден. Установите FFmpeg и добавьте его в PATH (или положите ffmpeg.exe в C:\\ffmpeg\\bin).',
      };
    }

    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];
    const suggestedName =
      typeof payload?.suggestedName === 'string' && payload.suggestedName.trim()
        ? path.basename(payload.suggestedName.trim())
        : 'kinoflow_film.mp4';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Сохранить фильм',
      defaultPath: path.join(app.getPath('videos'), suggestedName),
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    if (canceled || !filePath) {
      return { ok: false, code: 'CANCELLED' };
    }

    try {
      await mergeSegments({
        segmentUrls,
        outputPath: filePath,
        ffmpegPath,
        tempRoot: app.getPath('temp'),
        onProgress: (progress) => {
          if (!win.isDestroyed()) win.webContents.send('film:progress', progress);
        },
      });
      return { ok: true, path: filePath };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  ipcMain.handle('film:show-file', async (_event, filePath) => {
    if (typeof filePath === 'string' && filePath) {
      shell.showItemInFolder(filePath);
    }
    return { ok: true };
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
      const installerPath = updateManager.getDownloadedPath();
      if (!installerPath) {
        throw new Error('Файл обновления не найден. Загрузите обновление заново.');
      }
      if (process.platform === 'win32') {
        const openError = await shell.openPath(installerPath);
        if (openError) {
          updateManager.install();
        }
      } else {
        updateManager.install();
      }
      // Stop background tasks and quit cleanly so the NSIS installer can overwrite files.
      comfyLauncher.stop();
      modelDownloadManager.cancel();
      setTimeout(() => app.quit(), 600);
      return { ok: true };
    } catch (error) {
      logStartupError('update:install', error);
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
}

function loadSafeWindowIcon() {
  try {
    const iconPath = resolveWindowIconPath(__dirname);
    if (!iconPath) return undefined;
    const img = nativeImage.createFromPath(iconPath);
    return img.isEmpty() ? undefined : img;
  } catch (error) {
    logStartupError('loadSafeWindowIcon', error);
    return undefined;
  }
}

function buildLoadErrorDataUrl(title, details) {
  const safeTitle = String(title).replace(/[<>&]/g, '');
  const safeDetails = String(details).replace(/[<>&]/g, '');
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>KinoFlow Studio</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B0D11;color:#E6E9F0;font-family:system-ui,sans-serif;padding:24px}
.box{max-width:560px;background:#141821;border:1px solid #7F1D1D;border-radius:8px;padding:24px}
h1{margin:0 0 10px;font-size:18px;color:#F8FAFC}p{margin:0 0 12px;font-size:13px;color:#CBD5E1;line-height:1.5}
pre{margin:0;padding:12px;background:#0B0D11;border:1px solid #222734;border-radius:6px;color:#FCA5A5;font-size:12px;white-space:pre-wrap;word-break:break-word}</style></head>
<body><div class="box"><h1>${safeTitle}</h1><p>Не удалось загрузить интерфейс приложения. Переустановите KinoFlow Studio из последнего релиза или проверьте лог запуска.</p><pre>${safeDetails}</pre></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createMainWindow() {
  Menu.setApplicationMenu(null);

  const windowIcon = loadSafeWindowIcon();
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'KinoFlow Studio',
    ...(windowIcon ? { icon: windowIcon } : {}),
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

  mainWindowRef = mainWindow;
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
  });

  mainWindow.setMenuBarVisibility(false);

  const ensureVisible = () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  };

  mainWindow.once('ready-to-show', ensureVisible);
  // Safety net: never leave the window hidden if external resources (e.g. Google Fonts) stall first paint.
  const showFallbackTimer = setTimeout(ensureVisible, 2500);
  mainWindow.once('show', () => clearTimeout(showFallbackTimer));
  mainWindow.once('closed', () => clearTimeout(showFallbackTimer));

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // Ignore aborted/subframe failures; only surface main-frame load failures.
    if (errorCode === -3) return;
    logStartupError('did-fail-load', `${errorCode} ${errorDescription} (${validatedURL})`);
    ensureVisible();
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logStartupError('render-process-gone', details);
    ensureVisible();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_DEV_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl).catch((error) => {
      logStartupError('loadURL', error);
      ensureVisible();
      void mainWindow.loadURL(
        buildLoadErrorDataUrl('Ошибка загрузки dev-сервера', String(error?.message ?? error)),
      );
    });
  } else {
    const entryPath = resolveRendererEntryPath(__dirname);
    if (!entryPath) {
      const msg = `Файл интерфейса build-renderer/index.html не найден рядом с ${__dirname}`;
      logStartupError('resolveRendererEntryPath', msg);
      ensureVisible();
      void mainWindow.loadURL(buildLoadErrorDataUrl('Файлы интерфейса не найдены', msg));
      return;
    }
    mainWindow.loadFile(entryPath).catch((error) => {
      logStartupError('loadFile', error);
      ensureVisible();
      void mainWindow.loadURL(
        buildLoadErrorDataUrl('Ошибка открытия интерфейса', String(error?.message ?? error)),
      );
    });
  }
}

if (hasSingleInstanceLock) {
  app
    .whenReady()
    .then(() => {
      configureLocalComfyAccess();
      registerModelManagerIpc();
      registerUpdaterIpc();
      registerFilmIpc();
      registerLauncherIpc();
      createMainWindow();
      void autoStartComfy();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow();
        }
      });
    })
    .catch((error) => {
      logStartupError('app.whenReady', error);
      dialog.showErrorBox(
        'KinoFlow Studio — ошибка запуска',
        `Не удалось запустить приложение:\n${error?.message ?? error}\n\nЛог: ${getStartupLogPath() ?? ''}`,
      );
      app.quit();
    });
}

app.on('before-quit', () => {
  modelDownloadManager.cancel();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
