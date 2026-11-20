import fs from 'node:fs';
import path from 'node:path';

/**
 * Pure startup helpers for the Electron main process:
 * - Safe URL matching for local/LAN ComfyUI servers (avoids Chromium URLPattern crashes
 *   on trailing-wildcard IP hostnames like 192.168.x.x or 10.x.x.x).
 * - Safe asset & renderer entry resolution inside both development trees and packaged app.asar.
 * - Crash/startup diagnostic log writer that never throws.
 */

export function isLocalComfyHost(hostname) {
  if (typeof hostname !== 'string') return false;
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return true;
  }
  if (host.startsWith('192.168.') || host.startsWith('10.')) {
    return true;
  }
  const match172 = /^172\.(\d+)\./.exec(host);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }
  return false;
}

export function isLocalComfyUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString) return false;
  try {
    const parsed = new URL(urlString);
    if (
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'https:' &&
      parsed.protocol !== 'ws:' &&
      parsed.protocol !== 'wss:'
    ) {
      return false;
    }
    return isLocalComfyHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function isLocalComfyHttpUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString) return false;
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return isLocalComfyHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Resolves `assets/icon.ico`, preferring the unpacked copy next to `app.asar` when packaged
 * so Windows native icon loaders do not fail on ASAR virtual paths.
 */
export function resolveWindowIconPath(electronDir, fsImpl = fs) {
  const candidates = [];
  const rawPath = path.join(electronDir, '..', 'assets', 'icon.ico');
  const unpackedPath = rawPath.replace(/app\.asar([\\/])/i, 'app.asar.unpacked$1');
  if (unpackedPath !== rawPath) {
    candidates.push(unpackedPath);
  }
  candidates.push(rawPath);

  for (const candidate of candidates) {
    try {
      if (fsImpl.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * Finds the packaged renderer HTML entry point (`build-renderer/index.html` or fallback `dist/index.html`).
 */
export function resolveRendererEntryPath(electronDir, fsImpl = fs) {
  const candidates = [
    path.join(electronDir, '..', 'build-renderer', 'index.html'),
    path.join(electronDir, '..', 'dist', 'index.html'),
  ];
  for (const candidate of candidates) {
    try {
      if (fsImpl.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

export function formatErrorForLog(error) {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function appendStartupLog(logPath, label, error, fsImpl = fs) {
  if (!logPath) return;
  try {
    fsImpl.mkdirSync(path.dirname(logPath), { recursive: true });
    const line = `[${new Date().toISOString()}] ${label}: ${formatErrorForLog(error)}\n`;
    fsImpl.appendFileSync(logPath, line, 'utf8');
  } catch {
    // Logging must never crash the main process
  }
}
