import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

/**
 * In-app updater for the Windows installer published to GitHub Releases.
 * - check():    GET /repos/<repo>/releases/latest, compares the tag with the running version
 * - download(): streams the .exe asset to a temp folder and reports bytes / percent
 * - install():  starts the downloaded installer and lets the caller quit the app
 */

export const DEFAULT_UPDATE_REPO = 'vovik06302-ai/KinoFlow-Studio';
const USER_AGENT = 'KinoFlowStudio-Updater';

export function parseVersion(value) {
  const match = String(value ?? '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? '',
  };
}

/** Returns 1 if a > b, -1 if a < b, 0 if equal or not comparable. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] > pb[key] ? 1 : -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre > pb.pre ? 1 : -1;
}

export function pickInstallerAsset(assets) {
  const candidates = (Array.isArray(assets) ? assets : []).filter(
    (asset) =>
      asset &&
      typeof asset.name === 'string' &&
      /\.exe$/i.test(asset.name) &&
      typeof asset.browser_download_url === 'string' &&
      asset.browser_download_url.startsWith('https://'),
  );
  return candidates.find((asset) => /setup/i.test(asset.name)) ?? candidates[0] ?? null;
}

export function interpretRelease(release, currentVersion) {
  const tag = typeof release?.tag_name === 'string' ? release.tag_name : '';
  const latestVersion = tag.replace(/^v/i, '') || null;

  if (!release || release.draft || release.prerelease || !parseVersion(tag)) {
    return { available: false, currentVersion, latestVersion };
  }
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    return { available: false, currentVersion, latestVersion };
  }
  const asset = pickInstallerAsset(release.assets);
  if (!asset) {
    return { available: false, currentVersion, latestVersion, reason: 'no_installer' };
  }
  return {
    available: true,
    currentVersion,
    latestVersion,
    assetName: asset.name,
    assetUrl: asset.browser_download_url,
    size: typeof asset.size === 'number' ? asset.size : null,
    releaseUrl: typeof release.html_url === 'string' ? release.html_url : null,
  };
}

/**
 * Streams `url` into `<destPath>.part` and renames it to `destPath` when complete.
 * Follows redirects (GitHub serves assets from a CDN) and reports progress.
 */
export async function downloadToFile({
  url,
  destPath,
  expectedSize = null,
  signal,
  onProgress,
  fetchImpl = fetch,
}) {
  const partPath = `${destPath}.part`;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.rmSync(partPath, { force: true });

  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Сервер ответил HTTP ${response.status} при загрузке обновления.`);
  }

  const headerLength = Number(response.headers.get('content-length'));
  const total = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : expectedSize;

  const writeStream = fs.createWriteStream(partPath);
  let received = 0;
  let lastPercent = -1;

  const emit = (force = false) => {
    const percent = total ? Math.min(100, Math.floor((received / total) * 100)) : 0;
    if (force || percent !== lastPercent) {
      lastPercent = percent;
      onProgress?.({ received, total: total ?? null, percent });
    }
  };

  try {
    emit(true);
    for await (const chunk of response.body) {
      if (!writeStream.write(chunk)) {
        await once(writeStream, 'drain');
      }
      received += chunk.length;
      emit();
    }
    writeStream.end();
    await once(writeStream, 'finish');
  } catch (error) {
    writeStream.destroy();
    fs.rmSync(partPath, { force: true });
    throw error;
  }

  if (expectedSize && received !== expectedSize) {
    fs.rmSync(partPath, { force: true });
    throw new Error(
      `Файл обновления загружен не полностью: ${received} из ${expectedSize} байт.`,
    );
  }

  fs.rmSync(destPath, { force: true });
  fs.renameSync(partPath, destPath);
  emit(true);
  return { path: destPath, size: received };
}

export class UpdateManager {
  constructor({
    repo = DEFAULT_UPDATE_REPO,
    currentVersion,
    tempDir,
    fetchImpl = fetch,
    apiBase = 'https://api.github.com',
  }) {
    this.repo = repo;
    this.currentVersion = currentVersion;
    this.tempDir = tempDir;
    this.fetchImpl = fetchImpl;
    this.apiBase = apiBase;
    this.listeners = new Set();
    this.info = null;
    this.downloadedPath = null;
    this.abortController = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  async check() {
    const response = await this.fetchImpl(`${this.apiBase}/repos/${this.repo}/releases/latest`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    });
    if (response.status === 404) {
      this.info = { available: false, currentVersion: this.currentVersion, latestVersion: null };
      return this.info;
    }
    if (!response.ok) {
      throw new Error(`GitHub ответил HTTP ${response.status}.`);
    }
    this.info = interpretRelease(await response.json(), this.currentVersion);
    return this.info;
  }

  async download() {
    if (!this.info?.available) {
      throw new Error('Нет доступного обновления.');
    }
    if (this.abortController) {
      throw new Error('Загрузка уже идёт.');
    }
    const info = this.info;
    const destPath = path.join(this.tempDir, info.assetName);
    this.abortController = new AbortController();
    try {
      this.emit({ phase: 'downloading', received: 0, total: info.size, percent: 0 });
      const result = await downloadToFile({
        url: info.assetUrl,
        destPath,
        expectedSize: info.size,
        signal: this.abortController.signal,
        fetchImpl: this.fetchImpl,
        onProgress: (progress) => this.emit({ phase: 'downloading', ...progress }),
      });
      this.downloadedPath = result.path;
      this.emit({ phase: 'downloaded', received: result.size, total: result.size, percent: 100 });
      return { path: result.path };
    } catch (error) {
      const cancelled = this.abortController?.signal.aborted;
      this.emit({
        phase: cancelled ? 'cancelled' : 'error',
        message: cancelled ? 'Загрузка отменена.' : String(error?.message ?? error),
      });
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      return { cancelled: true };
    }
    return { cancelled: false };
  }

  getDownloadedPath() {
    if (!this.downloadedPath || !fs.existsSync(this.downloadedPath)) {
      return null;
    }
    return this.downloadedPath;
  }

  /** Starts the downloaded installer detached from this process. */
  install(spawnImpl = spawn) {
    const installerPath = this.getDownloadedPath();
    if (!installerPath) {
      throw new Error('Файл обновления не найден. Загрузите обновление заново.');
    }
    const child = spawnImpl(installerPath, [], { detached: true, stdio: 'ignore' });
    child.on?.('error', () => {
      // Prevent unhandled EventEmitter 'error' crash if Windows refuses direct spawn
    });
    child.unref?.();
    return { started: true };
  }
}
