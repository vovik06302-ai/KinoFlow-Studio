import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ComfyLauncher,
  WIN_FLUSH_FIX_NODE_DIR,
  WIN_FLUSH_FIX_PYTHON_SOURCE,
  buildComfyLaunchEnv,
  buildPortableLaunchArgs,
  detectComfyDirectory,
  ensureWindowsFlushFixInstalled,
  findLaunchScript,
  findPortableRoot,
  parseBatMainPyFlags,
  readLogFileDelta,
  resolveComfyRootDir,
  validateInstanceLaunch,
} from './comfyLauncher.js';

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number };
function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  return child;
}

test('buildComfyLaunchEnv disables tqdm and enforces UTF-8 stdio without dropping existing env', () => {
  const env = buildComfyLaunchEnv({ PATH: 'C:\\Windows\\System32', CUSTOM_VAR: 'ok' });
  assert.equal(env.PATH, 'C:\\Windows\\System32');
  assert.equal(env.CUSTOM_VAR, 'ok');
  assert.equal(env.TQDM_DISABLE, '1');
  assert.equal(env.PYTHONUTF8, '1');
  assert.equal(env.PYTHONIOENCODING, 'utf-8:replace');
  assert.equal(env.PYTHONUNBUFFERED, '1');
});

test('findLaunchScript finds run_nvidia_gpu.bat next to the ComfyUI folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-comfy-'));
  try {
    const comfyDir = path.join(root, 'ComfyUI_windows_portable', 'ComfyUI');
    fs.mkdirSync(comfyDir, { recursive: true });
    assert.equal(findLaunchScript(comfyDir), null);

    const script = path.join(root, 'ComfyUI_windows_portable', 'run_nvidia_gpu.bat');
    fs.writeFileSync(script, '@echo off');
    assert.equal(findLaunchScript(comfyDir), script);
    assert.equal(findLaunchScript(path.dirname(comfyDir)), script);
    assert.equal(findLaunchScript(''), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ComfyLauncher streams complete log lines, keeps a bounded buffer and reports exit', () => {
  const child = fakeChild();
  const calls: Array<{
    command: string;
    args: string[];
    cwd?: string;
    stdio?: unknown;
    env?: Record<string, string | undefined>;
  }> = [];
  const launcher = new ComfyLauncher({
    platform: 'win32',
    maxLogLines: 3,
    baseEnv: { SYSTEMROOT: 'C:\\Windows' },
    spawnImpl: (
      command: string,
      args: string[],
      options: { cwd?: string; stdio?: unknown; env?: Record<string, string | undefined> },
    ) => {
      calls.push({ command, args, cwd: options.cwd, stdio: options.stdio, env: options.env });
      return child;
    },
  });
  const events: string[] = [];
  launcher.subscribe((event) => events.push(event.type === 'log' ? `log:${event.line}` : event.type));

  const script = path.join('C:', 'ComfyUI_windows_portable', 'run_nvidia_gpu.bat');
  assert.deepEqual(launcher.start(script), { ok: true, scriptPath: script });
  assert.equal(calls[0].command, 'cmd.exe');
  assert.deepEqual(calls[0].args, ['/c', 'run_nvidia_gpu.bat']);
  assert.equal(calls[0].cwd, path.dirname(script));
  assert.deepEqual(calls[0].stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(calls[0].env?.TQDM_DISABLE, '1');
  assert.equal(calls[0].env?.PYTHONUTF8, '1');
  assert.equal(calls[0].env?.SYSTEMROOT, 'C:\\Windows');
  assert.equal(launcher.start(script).ok, false, 'second start is rejected while running');

  child.stdout.emit('data', 'Starting server\nTo see the GUI go to: http://127.0.0.1:8188\npartial');
  child.stdout.emit('data', ' line\nfour\nfive\n');
  assert.deepEqual(launcher.getState().logs, ['partial line', 'four', 'five']);
  assert.equal(launcher.getState().running, true);

  child.emit('close', 0);
  assert.equal(launcher.getState().running, false);
  assert.ok(events.includes('exit'));
});

test('ComfyLauncher.stop kills a running process, is a no-op otherwise and refuses non-Windows starts', () => {
  const child = fakeChild();
  let killed: unknown = null;
  const launcher = new ComfyLauncher({
    platform: 'win32',
    spawnImpl: () => child,
    killImpl: (target: unknown) => {
      killed = target;
    },
  });
  assert.deepEqual(launcher.stop(), { ok: true, wasRunning: false });
  launcher.start('C:\\x\\run_nvidia_gpu.bat');
  assert.deepEqual(launcher.stop(), { ok: true, wasRunning: true });
  assert.equal(killed, child);

  const linux = new ComfyLauncher({ platform: 'linux', spawnImpl: () => child });
  assert.match(linux.start('/x/run_nvidia_gpu.bat').error ?? '', /только в Windows/);
  assert.match(new ComfyLauncher({ platform: 'win32' }).start(null).error ?? '', /Не найден/);
});

test('ComfyLauncher launches ComfyUI.exe directly without cmd.exe and detectComfyDirectory finds valid installs', () => {
  const child = fakeChild();
  const calls: Array<{ command: string; args: string[] }> = [];
  const launcher = new ComfyLauncher({
    platform: 'win32',
    spawnImpl: (command: string, args: string[]) => {
      calls.push({ command, args });
      return child;
    },
  });

  const exePath = 'C:\\Users\\Demo\\AppData\\Local\\Programs\\@comfyorgcomfyui-electron\\ComfyUI.exe';
  assert.deepEqual(launcher.start(exePath), { ok: true, scriptPath: exePath });
  assert.equal(calls[0].command, exePath);
  assert.deepEqual(calls[0].args, []);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-detect-'));
  try {
    const docsComfy = path.join(root, 'Documents', 'ComfyUI');
    fs.mkdirSync(path.join(docsComfy, 'models'), { recursive: true });

    const detected = detectComfyDirectory({ homedir: root, env: {} });
    assert.equal(detected, docsComfy);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveComfyRootDir and ensureWindowsFlushFixInstalled install idempotent [Errno 22] patch node', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-flush-fix-'));
  try {
    const portableDir = path.join(root, 'ComfyUI_windows_portable');
    const comfyDir = path.join(portableDir, 'ComfyUI');
    fs.mkdirSync(path.join(comfyDir, 'custom_nodes'), { recursive: true });
    const batPath = path.join(portableDir, 'run_nvidia_gpu.bat');
    fs.writeFileSync(batPath, '@echo off');

    assert.equal(resolveComfyRootDir(batPath), comfyDir);
    assert.equal(resolveComfyRootDir(portableDir), comfyDir);
    assert.equal(resolveComfyRootDir(comfyDir), comfyDir);

    const first = ensureWindowsFlushFixInstalled(batPath);
    assert.equal(first.installed, true);
    assert.equal(first.updated, true);
    assert.ok(first.path?.endsWith(path.join('custom_nodes', WIN_FLUSH_FIX_NODE_DIR, '__init__.py')));
    const written = fs.readFileSync(first.path!, 'utf8');
    assert.equal(written, WIN_FLUSH_FIX_PYTHON_SOURCE);
    assert.match(written, /LogInterceptor/);
    assert.match(written, /errno\.EINVAL/);

    // Second run must be a no-op (updated === false)
    const second = ensureWindowsFlushFixInstalled(comfyDir);
    assert.equal(second.installed, true);
    assert.equal(second.updated, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('parseBatMainPyFlags and buildPortableLaunchArgs parse run_nvidia_gpu.bat and assemble GPU 1 / port 8189 args', () => {
  const batContent = [
    '@echo off',
    'REM ComfyUI Portable launch script',
    '.\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build --fast fp16_accumulation --cuda-device 0 --port=8188 --reserve-vram 1.5',
    'pause',
  ].join('\r\n');

  const flags = parseBatMainPyFlags(batContent);
  assert.deepEqual(flags, [
    '--windows-standalone-build',
    '--fast',
    'fp16_accumulation',
    '--reserve-vram',
    '1.5',
  ]);

  const args = buildPortableLaunchArgs({ batContent, gpuIndex: 1, port: 8189 });
  assert.deepEqual(args, [
    '-s',
    'ComfyUI\\main.py',
    '--windows-standalone-build',
    '--fast',
    'fp16_accumulation',
    '--reserve-vram',
    '1.5',
    '--cuda-device',
    '1',
    '--port',
    '8189',
  ]);

  // Fallback when bat is missing or empty
  assert.deepEqual(parseBatMainPyFlags(null), ['--windows-standalone-build']);
  assert.deepEqual(parseBatMainPyFlags(''), ['--windows-standalone-build']);
  assert.deepEqual(buildPortableLaunchArgs({ batContent: null, gpuIndex: 1, port: 8189 }), [
    '-s',
    'ComfyUI\\main.py',
    '--windows-standalone-build',
    '--cuda-device',
    '1',
    '--port',
    '8189',
  ]);
});

test('validateInstanceLaunch checks GPU range, port range, port conflicts, and duplicate starts', () => {
  const running = new Map<string, { running: boolean; port: number }>([
    ['1', { running: true, port: 8188 }],
  ]);

  // GPU index validation (integer 0–7)
  assert.equal(
    validateInstanceLaunch({ instanceId: '2', gpuIndex: -1, port: 8189, runningInstances: running }).ok,
    false,
  );
  assert.equal(
    validateInstanceLaunch({ instanceId: '2', gpuIndex: 8, port: 8189, runningInstances: running }).ok,
    false,
  );
  assert.equal(
    validateInstanceLaunch({ instanceId: '2', gpuIndex: 1.5, port: 8189, runningInstances: running }).ok,
    false,
  );

  // Port validation (integer 1024–65535)
  assert.equal(
    validateInstanceLaunch({ instanceId: '2', gpuIndex: 1, port: 80, runningInstances: running }).ok,
    false,
  );
  assert.equal(
    validateInstanceLaunch({ instanceId: '2', gpuIndex: 1, port: 70000, runningInstances: running }).ok,
    false,
  );
  assert.equal(
    validateInstanceLaunch({ instanceId: '2', gpuIndex: 1, port: Number.NaN, runningInstances: running }).ok,
    false,
  );

  // Port conflict with already-running instance 1
  const conflict = validateInstanceLaunch({
    instanceId: '2',
    gpuIndex: 1,
    port: 8188,
    runningInstances: running,
  });
  assert.equal(conflict.ok, false);
  assert.match(conflict.error ?? '', /8188/);

  // Duplicate start of already-running instance 1
  const duplicate = validateInstanceLaunch({
    instanceId: '1',
    gpuIndex: 0,
    port: 8190,
    runningInstances: running,
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error ?? '', /уже запущен/);

  // Valid second instance
  assert.deepEqual(
    validateInstanceLaunch({ instanceId: '2', gpuIndex: 1, port: 8189, runningInstances: running }),
    { ok: true },
  );
});

test('ComfyLauncher.startInstance spawns python.exe without shell, uses file descriptor stdio and required UTF-8 env', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-portable-'));
  const logsDir = path.join(root, 'userData-logs');
  try {
    const portableRoot = path.join(root, 'ComfyUI_windows_portable');
    const comfyDir = path.join(portableRoot, 'ComfyUI');
    fs.mkdirSync(path.join(portableRoot, 'python_embeded'), { recursive: true });
    fs.mkdirSync(path.join(comfyDir, 'custom_nodes'), { recursive: true });
    fs.writeFileSync(path.join(portableRoot, 'python_embeded', 'python.exe'), '');
    fs.writeFileSync(path.join(comfyDir, 'main.py'), '# main');
    fs.writeFileSync(
      path.join(portableRoot, 'run_nvidia_gpu.bat'),
      '.\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build --port 8188\r\npause\r\n',
    );

    assert.equal(findPortableRoot(comfyDir), portableRoot);
    assert.equal(findPortableRoot(portableRoot), portableRoot);

    const child = fakeChild();
    const spawnCalls: Array<{
      command: string;
      args: string[];
      options: {
        cwd?: string;
        stdio?: unknown;
        env?: Record<string, string | undefined>;
        shell?: unknown;
        windowsHide?: boolean;
      };
    }> = [];

    const launcher = new ComfyLauncher({
      platform: 'win32',
      logsDir,
      pollIntervalMs: 60_000,
      baseEnv: { SYSTEMROOT: 'C:\\Windows' },
      spawnImpl: (
        command: string,
        args: string[],
        options: {
          cwd?: string;
          stdio?: unknown;
          env?: Record<string, string | undefined>;
          shell?: unknown;
          windowsHide?: boolean;
        },
      ) => {
        spawnCalls.push({ command, args, options });
        return child;
      },
    });

    const result = launcher.startInstance({
      instanceId: '2',
      comfyDir,
      gpuIndex: 1,
      port: 8189,
    });

    assert.equal(result.ok, true);
    assert.equal(result.instanceId, '2');
    assert.equal(spawnCalls.length, 1);

    const call = spawnCalls[0];
    assert.equal(call.command, path.join(portableRoot, 'python_embeded', 'python.exe'));
    assert.deepEqual(call.args, [
      '-s',
      'ComfyUI\\main.py',
      '--windows-standalone-build',
      '--cuda-device',
      '1',
      '--port',
      '8189',
    ]);
    assert.equal(call.options.cwd, portableRoot);
    assert.equal(call.options.shell, undefined, 'shell must NOT be enabled');
    assert.equal(call.options.windowsHide, true);

    assert.ok(Array.isArray(call.options.stdio), 'stdio must be an array');
    const stdioArr = call.options.stdio as unknown[];
    assert.equal(stdioArr[0], 'ignore');
    assert.equal(typeof stdioArr[1], 'number', 'stdout must be an opened file descriptor');
    assert.equal(stdioArr[2], stdioArr[1], 'stderr must reuse the same log file descriptor');

    assert.equal(call.options.env?.PYTHONUNBUFFERED, '1');
    assert.equal(call.options.env?.PYTHONUTF8, '1');
    assert.equal(call.options.env?.PYTHONIOENCODING, 'utf-8');
    assert.equal(call.options.env?.SYSTEMROOT, 'C:\\Windows');
    assert.equal(result.logPath, path.join(logsDir, 'comfyui-2.log'));

    child.emit('close', 0);
    assert.equal(launcher.getState('2').running, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readLogFileDelta reads appended bytes by offset and buffers incomplete trailing lines', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-logtail-'));
  try {
    const logPath = path.join(root, 'comfyui-2.log');
    fs.writeFileSync(logPath, 'Line 1\nPartial ', 'utf8');

    const first = readLogFileDelta(logPath, 0, '');
    assert.deepEqual(first.lines, ['Line 1']);
    assert.equal(first.nextPartial, 'Partial ');
    assert.equal(first.nextOffset, Buffer.byteLength('Line 1\nPartial ', 'utf8'));

    // No new bytes yet
    const empty = readLogFileDelta(logPath, first.nextOffset, first.nextPartial);
    assert.deepEqual(empty.lines, []);
    assert.equal(empty.nextPartial, 'Partial ');
    assert.equal(empty.nextOffset, first.nextOffset);

    // Append completion of partial line + one full line + another partial fragment
    fs.appendFileSync(logPath, 'line 2\r\nLine 3\ntail', 'utf8');
    const second = readLogFileDelta(logPath, empty.nextOffset, empty.nextPartial);
    assert.deepEqual(second.lines, ['Partial line 2', 'Line 3']);
    assert.equal(second.nextPartial, 'tail');

    // Finish the tail
    fs.appendFileSync(logPath, ' finished\n', 'utf8');
    const third = readLogFileDelta(logPath, second.nextOffset, second.nextPartial);
    assert.deepEqual(third.lines, ['tail finished']);
    assert.equal(third.nextPartial, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('two ComfyLauncher instances are independent: stopping one does not affect the other', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-dual-'));
  const logsDir = path.join(root, 'logs');
  try {
    const portableRoot = path.join(root, 'ComfyUI_windows_portable');
    const comfyDir = path.join(portableRoot, 'ComfyUI');
    fs.mkdirSync(path.join(portableRoot, 'python_embeded'), { recursive: true });
    fs.mkdirSync(comfyDir, { recursive: true });
    fs.writeFileSync(path.join(portableRoot, 'python_embeded', 'python.exe'), '');
    fs.writeFileSync(path.join(comfyDir, 'main.py'), '');

    const child1 = fakeChild();
    child1.pid = 1001;
    const child2 = fakeChild();
    child2.pid = 2002;
    const childrenQueue = [child1, child2];
    const killedChildren: unknown[] = [];

    const launcher = new ComfyLauncher({
      platform: 'win32',
      logsDir,
      pollIntervalMs: 60_000,
      maxLogLines: 500,
      spawnImpl: () => childrenQueue.shift()!,
      killImpl: (target: unknown) => {
        killedChildren.push(target);
      },
    });

    const events: Array<{ type: string; instanceId: string; line?: string }> = [];
    launcher.subscribe((ev) => {
      events.push({
        type: ev.type,
        instanceId: ev.instanceId,
        ...(ev.type === 'log' ? { line: ev.line } : {}),
      });
    });

    const res1 = launcher.startInstance({ instanceId: '1', comfyDir, gpuIndex: 0, port: 8188 });
    const res2 = launcher.startInstance({ instanceId: '2', comfyDir, gpuIndex: 1, port: 8189 });
    assert.equal(res1.ok, true);
    assert.equal(res2.ok, true);

    // Port conflict check while both are running
    const conflict = launcher.startInstance({ instanceId: '3', comfyDir, gpuIndex: 2, port: 8189 });
    assert.equal(conflict.ok, false);
    assert.match(conflict.error ?? '', /8189/);

    // Write distinct logs to each instance log file and poll
    fs.appendFileSync(res1.logPath!, 'GPU0 ready on 8188\n', 'utf8');
    fs.appendFileSync(res2.logPath!, 'GPU1 ready on 8189\n', 'utf8');
    launcher.pollInstanceLog('1');
    launcher.pollInstanceLog('2');

    assert.deepEqual(launcher.getState('1').logs, ['GPU0 ready on 8188']);
    assert.deepEqual(launcher.getState('2').logs, ['GPU1 ready on 8189']);
    assert.ok(events.some((e) => e.type === 'log' && e.instanceId === '1' && e.line === 'GPU0 ready on 8188'));
    assert.ok(events.some((e) => e.type === 'log' && e.instanceId === '2' && e.line === 'GPU1 ready on 8189'));

    // Stop instance 1 -> must kill only child1 and leave instance 2 running
    assert.deepEqual(launcher.stop('1'), { ok: true, wasRunning: true });
    assert.deepEqual(killedChildren, [child1]);
    child1.emit('close', 0);

    assert.equal(launcher.getState('1').running, false);
    assert.equal(launcher.getState('2').running, true);
    assert.equal(launcher.getState('2').pid, 2002);

    // stopAll stops remaining instance 2
    const stopAllRes = launcher.stopAll();
    assert.deepEqual(stopAllRes.stoppedIds, ['2']);
    assert.deepEqual(killedChildren, [child1, child2]);
    child2.emit('close', 0);
    assert.equal(launcher.getState('2').running, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});



