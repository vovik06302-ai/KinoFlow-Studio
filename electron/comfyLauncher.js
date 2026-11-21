import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Starts a portable ComfyUI (.bat) or ComfyUI Desktop (ComfyUI.exe) from its folder and streams
 * console output so KinoFlow Studio can show the log and wait until the server answers.
 */

export const LAUNCH_SCRIPT_NAMES = [
  'run_nvidia_gpu.bat',
  'run_nvidia_gpu_fast_fp16_accumulation.bat',
  'ComfyUI.exe',
  'run_cpu.bat',
];

/**
 * Environment overrides for running ComfyUI hidden behind pipes on Windows.
 * Disabling console tqdm progress bars avoids OSError [Errno 22] Invalid argument
 * during KSamplerAdvanced stderr.flush() calls (KinoFlow Studio reads step progress
 * over WebSocket instead). UTF-8 flags prevent legacy Windows codepage crashes.
 */
export function buildComfyLaunchEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8:replace',
    PYTHONUNBUFFERED: '1',
    TQDM_DISABLE: '1',
  };
}

/** The .bat or .exe lives next to or inside the `ComfyUI` folder; checks the folder and two parents. */
export function findLaunchScript(comfyDir, fsImpl = fs) {
  if (typeof comfyDir !== 'string' || !comfyDir.trim()) return null;
  const start = comfyDir.trim();
  const dirs = [start, path.dirname(start), path.dirname(path.dirname(start))];
  for (const dir of dirs) {
    for (const name of LAUNCH_SCRIPT_NAMES) {
      const candidate = path.join(dir, name);
      try {
        if (fsImpl.statSync(candidate).isFile()) return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

/**
 * Probes standard Windows ComfyUI Portable and Desktop installation directories and returns
 * the first existing folder (preferring folders that contain a launch script or `models/`).
 */
export function detectComfyDirectory({
  env = process.env,
  homedir = os.homedir(),
  fsImpl = fs,
} = {}) {
  const localAppData = env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');
  const candidates = [
    'C:\\ComfyUI_windows_portable\\ComfyUI',
    'D:\\ComfyUI_windows_portable\\ComfyUI',
    'E:\\ComfyUI_windows_portable\\ComfyUI',
    path.join(homedir, 'Documents', 'ComfyUI'),
    path.join(localAppData, 'Programs', '@comfyorgcomfyui-electron'),
    'C:\\ComfyUI',
  ];

  for (const dir of candidates) {
    try {
      if (fsImpl.statSync(dir).isDirectory()) {
        if (findLaunchScript(dir, fsImpl)) return dir;
        try {
          if (fsImpl.statSync(path.join(dir, 'models')).isDirectory()) return dir;
        } catch {
          // continue checking
        }
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

function defaultKill(child) {
  if (process.platform === 'win32' && child.pid) {
    // The .bat starts python as a child process: kill the whole tree.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill();
  }
}

export class ComfyLauncher {
  constructor({
    spawnImpl = spawn,
    killImpl = defaultKill,
    maxLogLines = 500,
    platform = process.platform,
    baseEnv = process.env,
  } = {}) {
    this.spawnImpl = spawnImpl;
    this.killImpl = killImpl;
    this.maxLogLines = maxLogLines;
    this.platform = platform;
    this.baseEnv = baseEnv;
    this.child = null;
    this.scriptPath = null;
    this.logs = [];
    this.listeners = new Set();
    this.partial = { stdout: '', stderr: '' };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  getState() {
    return {
      running: Boolean(this.child),
      pid: this.child?.pid ?? null,
      scriptPath: this.scriptPath,
      logs: [...this.logs],
    };
  }

  pushLines(stream, chunk) {
    const text = this.partial[stream] + String(chunk);
    const parts = text.split(/\r?\n/);
    this.partial[stream] = parts.pop() ?? '';
    for (const line of parts) {
      if (!line.trim()) continue;
      this.logs.push(line);
      if (this.logs.length > this.maxLogLines) this.logs.shift();
      this.emit({ type: 'log', line });
    }
  }

  start(scriptPath) {
    if (this.child) {
      return { ok: false, error: 'ComfyUI уже запущен из KinoFlow Studio.' };
    }
    if (!scriptPath) {
      return {
        ok: false,
        error: 'Не найден run_nvidia_gpu.bat или ComfyUI.exe в указанной папке ComfyUI.',
      };
    }
    if (this.platform !== 'win32') {
      return { ok: false, error: 'Запуск ComfyUI из приложения поддерживается только в Windows.' };
    }

    this.logs = [];
    this.partial = { stdout: '', stderr: '' };
    this.scriptPath = scriptPath;

    const isExe = /\.exe$/i.test(scriptPath);
    const command = isExe ? scriptPath : 'cmd.exe';
    const args = isExe ? [] : ['/c', path.basename(scriptPath)];

    let child;
    try {
      child = this.spawnImpl(command, args, {
        cwd: path.dirname(scriptPath),
        windowsHide: !isExe,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildComfyLaunchEnv(this.baseEnv),
      });
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }

    this.child = child;
    child.stdout?.on('data', (chunk) => this.pushLines('stdout', chunk));
    child.stderr?.on('data', (chunk) => this.pushLines('stderr', chunk));
    child.on('error', (error) => {
      this.pushLines('stderr', `${error?.message ?? error}\n`);
    });
    child.on('close', (code) => {
      for (const stream of ['stdout', 'stderr']) {
        if (this.partial[stream].trim()) this.pushLines(stream, '\n');
      }
      this.child = null;
      this.emit({ type: 'exit', code });
    });

    this.emit({ type: 'started', scriptPath });
    return { ok: true, scriptPath };
  }

  stop() {
    if (!this.child) return { ok: true, wasRunning: false };
    this.killImpl(this.child);
    return { ok: true, wasRunning: true };
  }
}
