import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Manages one or more independent ComfyUI instances on Windows.
 * For ComfyUI Portable, launches `<portableRoot>\python_embeded\python.exe -s ComfyUI\main.py`
 * with `--cuda-device` and `--port`, redirecting stdout/stderr directly to a log file
 * descriptor (never pipes, which trigger Windows UCRT `[Errno 22] Invalid argument` in
 * `app/logger.py:flush()`) and tailing the file by byte offset for the renderer UI.
 */

export const DEFAULT_INSTANCE_ID = '1';
export const INSTANCE_IDS = ['1', '2'];
export const DEFAULT_PORTABLE_FLAGS = ['--windows-standalone-build'];

export const LAUNCH_SCRIPT_NAMES = [
  'run_nvidia_gpu.bat',
  'run_nvidia_gpu_fast_fp16_accumulation.bat',
  'ComfyUI.exe',
  'run_cpu.bat',
];

/**
 * Environment overrides for legacy .bat/.exe launches.
 * Kept intact for backward compatibility with existing scripts and tests.
 */
export function buildComfyLaunchEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8:replace',
    PYTHONUNBUFFERED: '1',
    TQDM_DISABLE: '1',
    COMFYUI_DISABLE_TQDM: '1',
    NO_COLOR: '1',
    TERM: 'dumb',
  };
}

/**
 * Environment overrides for direct Portable `python.exe` launches with file-backed stdio.
 */
export function buildPortablePythonEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    TQDM_DISABLE: '1',
    COMFYUI_DISABLE_TQDM: '1',
    NO_COLOR: '1',
    TERM: 'dumb',
  };
}

export const WIN_FLUSH_FIX_NODE_DIR = 'kinoflow_win_flush_fix';

/**
 * Lightweight, non-destructive ComfyUI custom node that guards Windows stdout/stderr
 * and ComfyUI's `app.logger.LogInterceptor.flush()` / `.write()` against
 * `OSError: [Errno 22] Invalid argument` (a well-known Windows UCRT console/pipe bug
 * triggered during KSamplerAdvanced execution on ComfyUI Portable and Desktop).
 */
export const WIN_FLUSH_FIX_PYTHON_SOURCE = `# Auto-installed by KinoFlow Studio (non-destructive Windows [Errno 22] flush guard)
# Prevents OSError [Errno 22] Invalid argument in ComfyUI app/logger.py:flush() on Windows.
import errno
import sys


def _wrap_stream_safe(stream):
    if stream is None or getattr(stream, "_kinoflow_win_flush_safe", False):
        return stream

    orig_flush = getattr(stream, "flush", None)
    if callable(orig_flush):
        def _safe_flush(*args, **kwargs):
            try:
                return orig_flush(*args, **kwargs)
            except OSError as exc:
                if getattr(exc, "errno", None) == errno.EINVAL:
                    return None
                raise
        try:
            stream.flush = _safe_flush
        except Exception:
            pass

    orig_write = getattr(stream, "write", None)
    if callable(orig_write):
        def _safe_write(*args, **kwargs):
            try:
                return orig_write(*args, **kwargs)
            except OSError as exc:
                if getattr(exc, "errno", None) == errno.EINVAL:
                    return 0
                raise
        try:
            stream.write = _safe_write
        except Exception:
            pass

    inner = getattr(stream, "stream", None)
    if inner is not None and inner is not stream:
        _wrap_stream_safe(inner)

    try:
        stream._kinoflow_win_flush_safe = True
    except Exception:
        pass
    return stream


def _install_kinoflow_flush_guard():
    try:
        import app.logger as comfy_logger
        interceptor = getattr(comfy_logger, "LogInterceptor", None)
        if interceptor is not None and not getattr(interceptor, "_kinoflow_win_flush_patched", False):
            orig_flush = getattr(interceptor, "flush", None)
            if callable(orig_flush):
                def _safe_interceptor_flush(self, *args, **kwargs):
                    try:
                        return orig_flush(self, *args, **kwargs)
                    except OSError as exc:
                        if getattr(exc, "errno", None) == errno.EINVAL:
                            return None
                        raise
                interceptor.flush = _safe_interceptor_flush

            orig_write = getattr(interceptor, "write", None)
            if callable(orig_write):
                def _safe_interceptor_write(self, *args, **kwargs):
                    try:
                        return orig_write(self, *args, **kwargs)
                    except OSError as exc:
                        if getattr(exc, "errno", None) == errno.EINVAL:
                            return 0
                        raise
                interceptor.write = _safe_interceptor_write

            interceptor._kinoflow_win_flush_patched = True
    except Exception:
        pass

    for attr in ("stdout", "stderr", "__stdout__", "__stderr__"):
        _wrap_stream_safe(getattr(sys, attr, None))


_install_kinoflow_flush_guard()

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
`;

/**
 * Resolves the ComfyUI root directory (the folder containing `custom_nodes/` or `models/`)
 * from either a directory path or a launch script path (such as `run_nvidia_gpu.bat`).
 */
export function resolveComfyRootDir(comfyDirOrScript, fsImpl = fs) {
  if (typeof comfyDirOrScript !== 'string' || !comfyDirOrScript.trim()) return null;
  let start = comfyDirOrScript.trim();
  try {
    if (fsImpl.statSync(start).isFile()) {
      start = path.dirname(start);
    }
  } catch {
    if (/\.(bat|exe|cmd|sh)$/i.test(start)) {
      start = path.dirname(start);
    }
  }

  const candidates = [
    start,
    path.join(start, 'ComfyUI'),
    path.join(start, 'resources', 'ComfyUI'),
    path.dirname(start),
  ];

  for (const dir of candidates) {
    try {
      if (!fsImpl.statSync(dir).isDirectory()) continue;
      for (const marker of ['custom_nodes', 'models', 'main.py']) {
        try {
          fsImpl.statSync(path.join(dir, marker));
          return dir;
        } catch {
          // keep checking markers
        }
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * Finds the ComfyUI Portable root folder (the parent containing `python_embeded/python.exe`
 * and `ComfyUI/main.py`) starting from `comfyDir` (which may be `ComfyUI`, its parent, or a script).
 */
export function findPortableRoot(comfyDir, fsImpl = fs) {
  if (typeof comfyDir !== 'string' || !comfyDir.trim()) return null;
  let start = comfyDir.trim();
  try {
    if (fsImpl.statSync(start).isFile()) {
      start = path.dirname(start);
    }
  } catch {
    if (/\.(bat|exe|cmd|sh|py)$/i.test(start)) {
      start = path.dirname(start);
    }
  }

  const candidates = Array.from(
    new Set([start, path.dirname(start), path.dirname(path.dirname(start))]),
  );

  for (const dir of candidates) {
    try {
      const pythonPath = path.join(dir, 'python_embeded', 'python.exe');
      const mainPyPath = path.join(dir, 'ComfyUI', 'main.py');
      if (fsImpl.statSync(pythonPath).isFile() && fsImpl.statSync(mainPyPath).isFile()) {
        return dir;
      }
    } catch {
      // keep checking parent directories
    }
  }
  return null;
}

/**
 * Tokenizes a Windows .bat command line respecting double/single quotes.
 */
function tokenizeBatLine(line) {
  const tokens = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Removes existing `--cuda-device` and `--port` flags (both `--flag val` and `--flag=val`)
 * as well as batch shell tokens (`%*`, output redirections).
 */
export function stripGpuAndPortFlags(tokens) {
  const result = [];
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    if (!raw) continue;
    const lower = raw.toLowerCase();

    if (lower === '--cuda-device' || lower === '--port') {
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        i += 1;
      }
      continue;
    }
    if (lower.startsWith('--cuda-device=') || lower.startsWith('--port=')) {
      continue;
    }
    if (raw === '%*' || raw === '2>&1' || raw === '1>&2') {
      continue;
    }
    if (raw === '>' || raw === '>>' || raw === '2>' || raw === '2>>') {
      if (i + 1 < tokens.length) i += 1;
      continue;
    }
    if (/^(?:1|2)?>>?.+/.test(raw)) {
      continue;
    }
    result.push(raw);
  }
  return result;
}

/**
 * Pure parser: extracts ComfyUI CLI flags from the `main.py` command line in `run_nvidia_gpu.bat`.
 * Removes the python executable path, `-s`, `main.py` path, and any existing `--cuda-device` / `--port`.
 * Falls back to `['--windows-standalone-build']` when `batContent` is missing or contains no `main.py` line.
 */
export function parseBatMainPyFlags(batContent) {
  if (typeof batContent !== 'string' || !batContent.trim()) {
    return [...DEFAULT_PORTABLE_FLAGS];
  }

  // Merge Windows batch caret line continuations (`^` at end of line)
  const rawLines = batContent.split(/\r?\n/);
  const logicalLines = [];
  let acc = '';
  for (const rawLine of rawLines) {
    const trimmedRight = rawLine.replace(/\s+$/, '');
    if (trimmedRight.endsWith('^')) {
      acc += `${trimmedRight.slice(0, -1)} `;
    } else {
      logicalLines.push(acc + rawLine);
      acc = '';
    }
  }
  if (acc) logicalLines.push(acc);

  for (const line of logicalLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(?:rem\b|::|@?echo\b|pause\b|set\b|title\b|cd\b)/i.test(trimmed)) continue;
    if (!/main\.py(?:\b|["'\s]|$)/i.test(trimmed)) continue;

    const tokens = tokenizeBatLine(trimmed);
    const mainPyIndex = tokens.findIndex((tok) => /(?:^|[\\/])main\.py$/i.test(tok));
    if (mainPyIndex === -1) continue;

    const afterMainPy = tokens.slice(mainPyIndex + 1);
    return stripGpuAndPortFlags(afterMainPy);
  }

  return [...DEFAULT_PORTABLE_FLAGS];
}

/**
 * Builds the argv array for `python_embeded\python.exe`:
 * `['-s', 'ComfyUI\\main.py', ...flags, '--cuda-device', String(gpuIndex), '--port', String(port)]`.
 */
export function buildPortableLaunchArgs({ batContent = null, flags = null, gpuIndex, port }) {
  const baseFlags = Array.isArray(flags)
    ? stripGpuAndPortFlags(flags)
    : parseBatMainPyFlags(batContent);

  return [
    '-s',
    'ComfyUI\\main.py',
    ...baseFlags,
    '--cuda-device',
    String(gpuIndex),
    '--port',
    String(port),
  ];
}

/**
 * Validates GPU index (0–7), port (1024–65535), duplicate start, and port conflicts
 * across currently running instances. Returns Russian error messages on failure.
 */
export function validateInstanceLaunch({
  instanceId = DEFAULT_INSTANCE_ID,
  gpuIndex,
  port,
  runningInstances = new Map(),
}) {
  const id = String(instanceId || DEFAULT_INSTANCE_ID);

  const existing =
    runningInstances instanceof Map ? runningInstances.get(id) : runningInstances?.[id];
  if (existing?.running || existing?.child) {
    return {
      ok: false,
      error: `Экземпляр ${id} ComfyUI уже запущен.`,
    };
  }

  if (typeof gpuIndex !== 'number' || !Number.isInteger(gpuIndex) || gpuIndex < 0 || gpuIndex > 7) {
    return {
      ok: false,
      error: 'Номер видеокарты должен быть целым числом от 0 до 7.',
    };
  }

  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
    return {
      ok: false,
      error: 'Порт должен быть целым числом от 1024 до 65535.',
    };
  }

  const entries =
    runningInstances instanceof Map
      ? Array.from(runningInstances.entries())
      : Object.entries(runningInstances ?? {});

  for (const [otherId, slot] of entries) {
    if (String(otherId) === id) continue;
    const isOtherRunning = Boolean(slot?.running || slot?.child);
    if (isOtherRunning && slot?.port === port) {
      return {
        ok: false,
        error: `Порт ${port} уже используется запущенным экземпляром ${otherId}. Укажите другой порт.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Reads newly appended bytes from a log file starting at `offset`, splits complete lines,
 * and preserves an incomplete trailing line in `nextPartial` for the next poll tick.
 */
export function readLogFileDelta(logPath, offset = 0, partial = '', fsImpl = fs) {
  if (!logPath) {
    return { nextOffset: offset, lines: [], nextPartial: partial };
  }

  let stat;
  try {
    stat = fsImpl.statSync(logPath);
  } catch {
    return { nextOffset: offset, lines: [], nextPartial: partial };
  }

  let readOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  let currentPartial = typeof partial === 'string' ? partial : '';

  if (stat.size < readOffset) {
    readOffset = 0;
    currentPartial = '';
  }

  const bytesToRead = stat.size - readOffset;
  if (bytesToRead <= 0) {
    return { nextOffset: readOffset, lines: [], nextPartial: currentPartial };
  }

  const buffer = Buffer.alloc(bytesToRead);
  let fd = null;
  let bytesRead = 0;
  try {
    fd = fsImpl.openSync(logPath, 'r');
    bytesRead = fsImpl.readSync(fd, buffer, 0, bytesToRead, readOffset);
  } finally {
    if (fd !== null) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }

  if (bytesRead <= 0) {
    return { nextOffset: readOffset, lines: [], nextPartial: currentPartial };
  }

  const chunk = buffer.subarray(0, bytesRead).toString('utf8');
  const combined = currentPartial + chunk;
  const parts = combined.split(/\r?\n/);
  const nextPartial = parts.pop() ?? '';
  const lines = parts.filter((line) => line.trim().length > 0);

  return {
    nextOffset: readOffset + bytesRead,
    lines,
    nextPartial,
  };
}

/**
 * Installs or updates `custom_nodes/kinoflow_win_flush_fix/__init__.py` inside ComfyUI
 * so `app/logger.py:flush()` never aborts KSamplerAdvanced with Windows `[Errno 22] Invalid argument`.
 */
export function ensureWindowsFlushFixInstalled(comfyDirOrScript, fsImpl = fs) {
  const rootDir = resolveComfyRootDir(comfyDirOrScript, fsImpl);
  if (!rootDir) {
    return {
      ok: false,
      installed: false,
      error: 'Папка ComfyUI с каталогом custom_nodes не найдена.',
    };
  }

  const nodeDir = path.join(rootDir, 'custom_nodes', WIN_FLUSH_FIX_NODE_DIR);
  const initPath = path.join(nodeDir, '__init__.py');
  try {
    let existing = '';
    try {
      existing = fsImpl.readFileSync(initPath, 'utf-8');
    } catch {
      existing = '';
    }
    if (existing === WIN_FLUSH_FIX_PYTHON_SOURCE) {
      return { ok: true, installed: true, updated: false, path: initPath };
    }
    fsImpl.mkdirSync(nodeDir, { recursive: true });
    fsImpl.writeFileSync(initPath, WIN_FLUSH_FIX_PYTHON_SOURCE, 'utf-8');
    return { ok: true, installed: true, updated: true, path: initPath };
  } catch (error) {
    return {
      ok: false,
      installed: false,
      error: String(error?.message ?? error),
    };
  }
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
  if (process.platform === 'win32' && child?.pid) {
    // Kill the full process tree so python/subprocesses are terminated cleanly.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else if (child && typeof child.kill === 'function') {
    child.kill();
  }
}

export class ComfyLauncher {
  constructor({
    spawnImpl = spawn,
    killImpl = defaultKill,
    maxLogLines = 500,
    pollIntervalMs = 500,
    platform = process.platform,
    baseEnv = process.env,
    fsImpl = fs,
    logsDir = null,
    getLogsDir = null,
  } = {}) {
    this.spawnImpl = spawnImpl;
    this.killImpl = killImpl;
    this.maxLogLines = maxLogLines;
    this.pollIntervalMs = pollIntervalMs;
    this.platform = platform;
    this.baseEnv = baseEnv;
    this.fsImpl = fsImpl;
    this.logsDir = logsDir;
    this.getLogsDir = getLogsDir;
    this.instances = new Map();
    this.listeners = new Set();

    for (const id of INSTANCE_IDS) {
      this.getOrCreateSlot(id);
    }
  }

  getOrCreateSlot(instanceId = DEFAULT_INSTANCE_ID) {
    const id = String(instanceId || DEFAULT_INSTANCE_ID);
    let slot = this.instances.get(id);
    if (!slot) {
      slot = {
        id,
        child: null,
        scriptPath: null,
        gpuIndex: id === '2' ? 1 : 0,
        port: id === '2' ? 8189 : 8188,
        logPath: null,
        logFd: null,
        logOffset: 0,
        partial: '',
        streamPartial: { stdout: '', stderr: '' },
        pollTimer: null,
        logs: [],
      };
      this.instances.set(id, slot);
    }
    return slot;
  }

  resolveLogsDir(overrideLogsDir) {
    if (typeof overrideLogsDir === 'string' && overrideLogsDir.trim()) {
      return overrideLogsDir.trim();
    }
    if (typeof this.getLogsDir === 'function') {
      const resolved = this.getLogsDir();
      if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
    }
    if (typeof this.logsDir === 'string' && this.logsDir.trim()) {
      return this.logsDir.trim();
    }
    return path.join(os.tmpdir(), 'kinoflow-comfy-logs');
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  getState(instanceId = DEFAULT_INSTANCE_ID) {
    const slot = this.getOrCreateSlot(instanceId);
    return {
      instanceId: slot.id,
      running: Boolean(slot.child),
      pid: slot.child?.pid ?? null,
      scriptPath: slot.scriptPath,
      gpuIndex: slot.gpuIndex,
      port: slot.port,
      logPath: slot.logPath,
      logs: [...slot.logs],
    };
  }

  getAllStates() {
    const states = {};
    for (const id of INSTANCE_IDS) {
      states[id] = this.getState(id);
    }
    for (const id of this.instances.keys()) {
      if (!(id in states)) {
        states[id] = this.getState(id);
      }
    }
    return states;
  }

  appendLogLine(slot, line) {
    if (!line || !line.trim()) return;
    slot.logs.push(line);
    if (slot.logs.length > this.maxLogLines) {
      slot.logs.splice(0, slot.logs.length - this.maxLogLines);
    }
    this.emit({ type: 'log', instanceId: slot.id, line });
  }

  pushLinesForSlot(slot, stream, chunk) {
    const text = slot.streamPartial[stream] + String(chunk);
    const parts = text.split(/\r?\n/);
    slot.streamPartial[stream] = parts.pop() ?? '';
    for (const line of parts) {
      this.appendLogLine(slot, line);
    }
  }

  stopSlotPolling(slot) {
    if (slot.pollTimer !== null) {
      clearInterval(slot.pollTimer);
      slot.pollTimer = null;
    }
  }

  closeSlotFd(slot) {
    if (slot.logFd !== null) {
      const fdToClose = slot.logFd;
      slot.logFd = null;
      try {
        this.fsImpl.closeSync(fdToClose);
      } catch {
        // ignore close errors
      }
    }
  }

  pollInstanceLog(instanceId = DEFAULT_INSTANCE_ID, flushPartial = false) {
    const slot = this.instances.get(String(instanceId || DEFAULT_INSTANCE_ID));
    if (!slot || !slot.logPath) return [];

    const delta = readLogFileDelta(slot.logPath, slot.logOffset, slot.partial, this.fsImpl);
    slot.logOffset = delta.nextOffset;
    slot.partial = delta.nextPartial;

    for (const line of delta.lines) {
      this.appendLogLine(slot, line);
    }

    if (flushPartial && slot.partial.trim()) {
      const remainder = slot.partial;
      slot.partial = '';
      this.appendLogLine(slot, remainder);
      return [...delta.lines, remainder];
    }

    return delta.lines;
  }

  /**
   * Starts a ComfyUI Portable instance on the specified GPU and port with file-backed logging.
   */
  startInstance({
    instanceId = DEFAULT_INSTANCE_ID,
    comfyDir,
    gpuIndex,
    port,
    logsDir,
  } = {}) {
    const id = String(instanceId || DEFAULT_INSTANCE_ID);
    if (this.platform !== 'win32') {
      return { ok: false, error: 'Запуск ComfyUI из приложения поддерживается только в Windows.' };
    }

    const validation = validateInstanceLaunch({
      instanceId: id,
      gpuIndex,
      port,
      runningInstances: this.instances,
    });
    if (!validation.ok) {
      return validation;
    }

    const portableRoot = findPortableRoot(comfyDir, this.fsImpl);
    if (!portableRoot) {
      return {
        ok: false,
        error:
          'Не найдены python_embeded\\python.exe и ComfyUI\\main.py. Укажите папку ComfyUI Portable.',
      };
    }

    // Best-effort install of the Windows [Errno 22] app/logger.py flush guard before starting.
    ensureWindowsFlushFixInstalled(portableRoot, this.fsImpl);

    const batPath = path.join(portableRoot, 'run_nvidia_gpu.bat');
    let batContent = null;
    try {
      batContent = this.fsImpl.readFileSync(batPath, 'utf-8');
    } catch {
      batContent = null;
    }

    const pythonExe = path.join(portableRoot, 'python_embeded', 'python.exe');
    const args = buildPortableLaunchArgs({ batContent, gpuIndex, port });
    const targetLogsDir = this.resolveLogsDir(logsDir);
    const logPath = path.join(targetLogsDir, `comfyui-${id}.log`);

    let fd;
    let initialOffset = 0;
    try {
      this.fsImpl.mkdirSync(targetLogsDir, { recursive: true });
      fd = this.fsImpl.openSync(logPath, 'a');
      try {
        initialOffset = this.fsImpl.statSync(logPath).size;
      } catch {
        initialOffset = 0;
      }
    } catch (error) {
      return {
        ok: false,
        error: `Не удалось открыть файл журнала ${logPath}: ${String(error?.message ?? error)}`,
      };
    }

    const slot = this.getOrCreateSlot(id);
    slot.logs = [];
    slot.partial = '';
    slot.streamPartial = { stdout: '', stderr: '' };
    slot.scriptPath = pythonExe;
    slot.gpuIndex = gpuIndex;
    slot.port = port;
    slot.logPath = logPath;
    slot.logFd = fd;
    slot.logOffset = initialOffset;

    let child;
    try {
      child = this.spawnImpl(pythonExe, args, {
        cwd: portableRoot,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
        env: buildPortablePythonEnv(this.baseEnv),
      });
    } catch (error) {
      this.closeSlotFd(slot);
      return { ok: false, error: String(error?.message ?? error) };
    }

    slot.child = child;
    slot.pollTimer = setInterval(() => {
      this.pollInstanceLog(id, false);
    }, this.pollIntervalMs);
    if (typeof slot.pollTimer.unref === 'function') {
      slot.pollTimer.unref();
    }

    child.on('error', (error) => {
      this.appendLogLine(slot, String(error?.message ?? error));
    });
    child.on('close', (code) => {
      this.stopSlotPolling(slot);
      this.pollInstanceLog(id, true);
      this.closeSlotFd(slot);
      slot.child = null;
      this.emit({ type: 'exit', instanceId: id, code });
    });

    this.emit({
      type: 'started',
      instanceId: id,
      scriptPath: pythonExe,
      gpuIndex,
      port,
      logPath,
    });

    return {
      ok: true,
      instanceId: id,
      scriptPath: pythonExe,
      command: pythonExe,
      args,
      gpuIndex,
      port,
      logPath,
    };
  }

  /**
   * Starts ComfyUI:
   * - If passed an options object `{ instanceId, comfyDir, gpuIndex, port }`, delegates to `startInstance`.
   * - If passed a legacy script path string (`.bat` or `.exe`), launches instance `'1'` in legacy mode.
   */
  start(scriptPathOrOptions) {
    if (scriptPathOrOptions && typeof scriptPathOrOptions === 'object') {
      return this.startInstance(scriptPathOrOptions);
    }

    const scriptPath = scriptPathOrOptions;
    const slot = this.getOrCreateSlot(DEFAULT_INSTANCE_ID);
    if (slot.child) {
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

    // Best-effort install of the Windows [Errno 22] app/logger.py flush guard before starting ComfyUI.
    ensureWindowsFlushFixInstalled(scriptPath, this.fsImpl);

    slot.logs = [];
    slot.partial = '';
    slot.streamPartial = { stdout: '', stderr: '' };
    slot.scriptPath = scriptPath;
    slot.logPath = null;

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

    slot.child = child;
    child.stdout?.on('data', (chunk) => this.pushLinesForSlot(slot, 'stdout', chunk));
    child.stderr?.on('data', (chunk) => this.pushLinesForSlot(slot, 'stderr', chunk));
    child.on('error', (error) => {
      this.pushLinesForSlot(slot, 'stderr', `${error?.message ?? error}\n`);
    });
    child.on('close', (code) => {
      for (const stream of ['stdout', 'stderr']) {
        if (slot.streamPartial[stream].trim()) this.pushLinesForSlot(slot, stream, '\n');
      }
      slot.child = null;
      this.emit({ type: 'exit', instanceId: slot.id, code });
    });

    this.emit({ type: 'started', instanceId: slot.id, scriptPath });
    return { ok: true, scriptPath };
  }

  stop(instanceId = DEFAULT_INSTANCE_ID) {
    const slot = this.instances.get(String(instanceId || DEFAULT_INSTANCE_ID));
    if (!slot || !slot.child) return { ok: true, wasRunning: false };
    this.killImpl(slot.child);
    return { ok: true, wasRunning: true };
  }

  stopAll() {
    const stoppedIds = [];
    for (const [id, slot] of this.instances.entries()) {
      this.stopSlotPolling(slot);
      if (slot.child) {
        this.killImpl(slot.child);
        stoppedIds.push(id);
      }
      this.closeSlotFd(slot);
    }
    return { ok: true, stoppedIds };
  }
}
