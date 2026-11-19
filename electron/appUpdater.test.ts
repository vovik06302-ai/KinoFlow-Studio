import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  UpdateManager,
  compareVersions,
  downloadToFile,
  interpretRelease,
  pickInstallerAsset,
} from './appUpdater.js';

test('compareVersions orders semver tags and ignores the v prefix', () => {
  assert.equal(compareVersions('v1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.9', '1.1.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(compareVersions('garbage', '1.0.0'), 0);
});

test('pickInstallerAsset prefers the Setup .exe and ignores blockmaps and non-https links', () => {
  const asset = pickInstallerAsset([
    { name: 'KinoFlowStudio-Setup-1.2.0.exe.blockmap', browser_download_url: 'https://x/blockmap' },
    { name: 'portable.exe', browser_download_url: 'https://x/portable.exe' },
    { name: 'KinoFlowStudio-Setup-1.2.0.exe', browser_download_url: 'https://x/setup.exe' },
    { name: 'evil.exe', browser_download_url: 'http://x/evil.exe' },
  ]);
  assert.equal(asset?.name, 'KinoFlowStudio-Setup-1.2.0.exe');
  assert.equal(pickInstallerAsset([]), null);
});

test('interpretRelease reports an update only for newer stable releases with an installer', () => {
  const release = {
    tag_name: 'v1.2.0',
    html_url: 'https://github.com/o/r/releases/tag/v1.2.0',
    draft: false,
    prerelease: false,
    assets: [
      { name: 'KinoFlowStudio-Setup-1.2.0.exe', browser_download_url: 'https://x/s.exe', size: 1000 },
    ],
  };
  const newer = interpretRelease(release, '1.1.0');
  assert.equal(newer.available, true);
  assert.equal(newer.latestVersion, '1.2.0');
  assert.equal(newer.size, 1000);

  assert.equal(interpretRelease(release, '1.2.0').available, false);
  assert.equal(interpretRelease(release, '1.3.0').available, false);
  assert.equal(interpretRelease({ ...release, prerelease: true }, '1.1.0').available, false);
  assert.equal(interpretRelease({ ...release, draft: true }, '1.1.0').available, false);
  assert.equal(interpretRelease({ ...release, assets: [] }, '1.1.0').reason, 'no_installer');
});

test('UpdateManager.check queries GitHub releases/latest and treats 404 as no update', async () => {
  const calls: string[] = [];
  const okFetch = (async (url: string) => {
    calls.push(url);
    return new Response(
      JSON.stringify({
        tag_name: 'v1.1.0',
        assets: [{ name: 'KinoFlowStudio-Setup-1.1.0.exe', browser_download_url: 'https://x/s.exe', size: 5 }],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const manager = new UpdateManager({ currentVersion: '1.0.0', tempDir: os.tmpdir(), fetchImpl: okFetch });
  const info = await manager.check();
  assert.equal(info.available, true);
  assert.ok(calls[0].endsWith('/repos/vovik06302-ai/KinoFlow-Studio/releases/latest'));

  const notFound = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
  const manager404 = new UpdateManager({ currentVersion: '1.0.0', tempDir: os.tmpdir(), fetchImpl: notFound });
  assert.equal((await manager404.check()).available, false);

  const broken = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
  const manager500 = new UpdateManager({ currentVersion: '1.0.0', tempDir: os.tmpdir(), fetchImpl: broken });
  await assert.rejects(() => manager500.check(), /HTTP 500/);
});

function startServer(body: Buffer, opts: { redirect?: boolean } = {}): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (opts.redirect && req.url === '/start') {
        res.writeHead(302, { Location: '/file' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Length': String(body.length) });
      const half = Math.floor(body.length / 2);
      res.write(body.subarray(0, half));
      setTimeout(() => res.end(body.subarray(half)), 20);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test('downloadToFile follows redirects, reports rising percent up to 100 and renames the .part file', async () => {
  const body = Buffer.alloc(200_000, 7);
  const { server, url } = await startServer(body, { redirect: true });
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kf-upd-'));
  try {
    const percents: number[] = [];
    const dest = path.join(dir, 'setup.exe');
    const result = await downloadToFile({
      url: `${url}/start`,
      destPath: dest,
      expectedSize: body.length,
      onProgress: (p) => percents.push(p.percent),
    });
    assert.equal(result.size, body.length);
    assert.equal((await fsp.stat(dest)).size, body.length);
    await assert.rejects(() => fsp.stat(`${dest}.part`));
    assert.equal(percents[percents.length - 1], 100);
    assert.deepEqual(percents, [...percents].sort((a, b) => a - b));
  } finally {
    server.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('downloadToFile rejects and cleans up when the size does not match the release asset', async () => {
  const body = Buffer.alloc(1000, 1);
  const { server, url } = await startServer(body);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kf-upd-'));
  try {
    const dest = path.join(dir, 'setup.exe');
    await assert.rejects(
      () => downloadToFile({ url, destPath: dest, expectedSize: 5000 }),
      /не полностью|HTTP/,
    );
    await assert.rejects(() => fsp.stat(dest));
    await assert.rejects(() => fsp.stat(`${dest}.part`));
  } finally {
    server.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('UpdateManager.install refuses to run before a download and spawns the downloaded file afterwards', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kf-upd-'));
  try {
    const manager = new UpdateManager({ currentVersion: '1.0.0', tempDir: dir });
    assert.throws(() => manager.install(), /не найден/);
    const file = path.join(dir, 'KinoFlowStudio-Setup-1.1.0.exe');
    await fsp.writeFile(file, 'x');
    manager.downloadedPath = file;
    let spawned: unknown[] = [];
    const fakeSpawn = (...args: unknown[]) => {
      spawned = args;
      return { unref() {} };
    };
    assert.deepEqual(manager.install(fakeSpawn), { started: true });
    assert.equal(spawned[0], file);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
