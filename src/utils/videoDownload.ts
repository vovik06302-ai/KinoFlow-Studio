import type { GenerationHistoryItem } from '../types/video';

const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;

/**
 * Produces a safe local filename with a video extension (defaults to .mp4).
 */
export function normalizeDownloadFilename(filename?: string, fallbackId?: string): string {
  const raw = (filename ?? '').trim().split(/[\\/]/).pop() ?? '';
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  if (sanitized) {
    return VIDEO_EXT_RE.test(sanitized) ? sanitized : `${sanitized}.mp4`;
  }
  const safeId = (fallbackId ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '');
  return safeId ? `kinoflow_${safeId}.mp4` : 'kinoflow_video.mp4';
}

export interface VideoDownloadTarget {
  url: string;
  filename: string;
}

/**
 * Resolves the downloadable video URL and normalized filename from a history item
 * (or a specific segment within that history item).
 */
export function resolveHistoryItemDownload(
  item: GenerationHistoryItem | null | undefined,
  segmentIndex?: number,
): VideoDownloadTarget | null {
  if (!item) return null;
  const segments = item.segments && item.segments.length > 0 ? item.segments : null;
  const activeSegment =
    segments && typeof segmentIndex === 'number'
      ? segments[Math.max(0, Math.min(segmentIndex, segments.length - 1))]
      : null;

  const url = (activeSegment?.videoUrl || item.videoUrl || '').trim();
  if (!url) return null;

  const filename = normalizeDownloadFilename(
    activeSegment?.filename || item.filename,
    activeSegment?.promptId || item.id,
  );
  return { url, filename };
}

export interface TriggerDownloadDeps {
  fetchImpl?: typeof fetch;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  clickLink?: (href: string, download: string) => void;
  scheduleRevoke?: (fn: () => void, delayMs: number) => void;
}

function defaultClickLink(href: string, download: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = download;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Downloads a generated video locally using a CORS blob fetch when possible
 * (forcing a local save dialog even across origins) with a direct anchor fallback.
 */
export async function triggerVideoDownload(
  url: string,
  filename: string,
  deps: TriggerDownloadDeps = {},
): Promise<'blob' | 'direct'> {
  const cleanUrl = url.trim();
  if (!cleanUrl) {
    throw new Error('URL видео отсутствует.');
  }

  const normalizedName = normalizeDownloadFilename(filename);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const createObjectURL = deps.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectURL = deps.revokeObjectURL ?? ((u: string) => URL.revokeObjectURL(u));
  const clickLink = deps.clickLink ?? defaultClickLink;
  const scheduleRevoke =
    deps.scheduleRevoke ?? ((fn: () => void, delayMs: number) => { window.setTimeout(fn, delayMs); });

  if (cleanUrl.startsWith('blob:') || cleanUrl.startsWith('data:')) {
    clickLink(cleanUrl, normalizedName);
    return 'direct';
  }

  try {
    const response = await fetchImpl(cleanUrl, { mode: 'cors' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const blobUrl = createObjectURL(blob);
    clickLink(blobUrl, normalizedName);
    scheduleRevoke(() => revokeObjectURL(blobUrl), 1500);
    return 'blob';
  } catch {
    clickLink(cleanUrl, normalizedName);
    return 'direct';
  }
}
