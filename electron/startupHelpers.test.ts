import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendStartupLog,
  isLocalComfyHost,
  isLocalComfyHttpUrl,
  isLocalComfyUrl,
  resolveRendererEntryPath,
  resolveWindowIconPath,
} from './startupHelpers.js';

test('isLocalComfyHost matches loopback and private LAN ranges and rejects public hosts', () => {
  assert.equal(isLocalComfyHost('localhost'), true);
  assert.equal(isLocalComfyHost('127.0.0.1'), true);
  assert.equal(isLocalComfyHost('::1'), true);
  assert.equal(isLocalComfyHost('[::1]'), true);
  assert.equal(isLocalComfyHost('192.168.1.42'), true);
  assert.equal(isLocalComfyHost('10.0.0.5'), true);
  assert.equal(isLocalComfyHost('172.16.0.10'), true);
  assert.equal(isLocalComfyHost('172.31.255.1'), true);

  assert.equal(isLocalComfyHost('172.15.0.1'), false);
  assert.equal(isLocalComfyHost('172.32.0.1'), false);
  assert.equal(isLocalComfyHost('fonts.googleapis.com'), false);
  assert.equal(isLocalComfyHost('api.github.com'), false);
  assert.equal(isLocalComfyHost(''), false);
});

test('isLocalComfyUrl and isLocalComfyHttpUrl separate HTTP/WS local traffic from file:// and public URLs', () => {
  assert.equal(isLocalComfyUrl('http://127.0.0.1:8188/system_stats'), true);
  assert.equal(isLocalComfyUrl('http://192.168.0.15:8188/view?filename=a.mp4'), true);
  assert.equal(isLocalComfyUrl('ws://127.0.0.1:8188/ws?clientId=1'), true);
  assert.equal(isLocalComfyUrl('ws://10.0.0.8:8000/ws'), true);
  assert.equal(isLocalComfyUrl('http://[::1]:8188/prompt'), true);

  assert.equal(isLocalComfyHttpUrl('http://127.0.0.1:8188/system_stats'), true);
  assert.equal(isLocalComfyHttpUrl('ws://127.0.0.1:8188/ws'), false);

  assert.equal(isLocalComfyUrl('file:///C:/app/build-renderer/index.html'), false);
  assert.equal(isLocalComfyUrl('https://fonts.googleapis.com/css2?family=DM+Sans'), false);
  assert.equal(isLocalComfyUrl('https://api.github.com/repos/vovik06302-ai/KinoFlow-Studio/releases/latest'), false);
  assert.equal(isLocalComfyUrl('not-a-url'), false);
});

test('resolveWindowIconPath prefers unpacked icon outside app.asar when present', () => {
  const electronDir = path.join('/apps', 'resources', 'app.asar', 'electron');
  const unpacked = path.join('/apps', 'resources', 'app.asar.unpacked', 'assets', 'icon.ico');
  const packed = path.join('/apps', 'resources', 'app.asar', 'assets', 'icon.ico');

  const bothExist = { existsSync: (p: string) => p === unpacked || p === packed };
  assert.equal(resolveWindowIconPath(electronDir, bothExist), unpacked);

  const onlyPacked = { existsSync: (p: string) => p === packed };
  assert.equal(resolveWindowIconPath(electronDir, onlyPacked), packed);

  const noneExist = { existsSync: () => false };
  assert.equal(resolveWindowIconPath(electronDir, noneExist), null);
});

test('resolveRendererEntryPath picks build-renderer first, then dist, or null if absent', () => {
  const dir = '/app/electron';
  const buildEntry = path.join(dir, '..', 'build-renderer', 'index.html');
  const distEntry = path.join(dir, '..', 'dist', 'index.html');

  assert.equal(
    resolveRendererEntryPath(dir, { existsSync: (p) => p === buildEntry || p === distEntry }),
    buildEntry,
  );
  assert.equal(
    resolveRendererEntryPath(dir, { existsSync: (p) => p === distEntry }),
    distEntry,
  );
  assert.equal(resolveRendererEntryPath(dir, { existsSync: () => false }), null);
});

test('appendStartupLog writes timestamped diagnostics and swallows filesystem failures', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kf-log-'));
  try {
    const logPath = path.join(dir, 'nested', 'startup.log');
    appendStartupLog(logPath, 'uncaughtException', new Error('boom'));
    const contents = await fsp.readFile(logPath, 'utf8');
    assert.match(contents, /uncaughtException/);
    assert.match(contents, /boom/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }

  assert.doesNotThrow(() =>
    appendStartupLog('/nonexistent/path/startup.log', 'test', 'err', {
      mkdirSync: () => {
        throw new Error('EACCES');
      },
      appendFileSync: () => {
        throw new Error('EACCES');
      },
    }),
  );
});
