import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ComfyLauncher, findLaunchScript } from './comfyLauncher.js';

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number };
function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  return child;
}

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
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const launcher = new ComfyLauncher({
    platform: 'win32',
    maxLogLines: 3,
    spawnImpl: (command: string, args: string[], options: { cwd?: string }) => {
      calls.push({ command, args, cwd: options.cwd });
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
