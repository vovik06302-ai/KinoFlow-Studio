import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ComfyLauncher,
  buildComfyLaunchEnv,
  detectComfyDirectory,
  findLaunchScript,
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

