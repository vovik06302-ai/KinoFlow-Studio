import type { SelectedAudioTrack } from '../types/film';

export const AUDIO_VOLUME_MIN_PERCENT = 0;
export const AUDIO_VOLUME_MAX_PERCENT = 200;
export const AUDIO_VOLUME_DEFAULT_PERCENT = 100;

export type GeneratedAudioExtension = 'mp3' | 'wav' | 'ogg';

export interface GenerateExternalAudioParams {
  endpoint: string;
  apiKey?: string;
  prompt: string;
  durationSec: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface GeneratedAudioResult {
  blob: Blob;
  base64: string;
  mimeType: string;
  extension: GeneratedAudioExtension;
  filename: string;
  objectUrl: string;
}

interface ElectronBinaryHttpBridge {
  request?: (options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    responseType?: 'text' | 'base64';
  }) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    bodyText: string;
    bodyBase64?: string;
    contentType?: string;
    networkError?: boolean;
    errorMessage?: string;
  }>;
}

/**
 * Validates that an external audio API endpoint uses http:// or https:// and has a hostname.
 */
export function validateExternalAudioEndpoint(rawUrl?: string): string {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) {
    throw new Error('Укажите адрес (endpoint) внешнего API генерации звука в настройках.');
  }
  if (/\s/.test(trimmed)) {
    throw new Error('Адрес внешнего API звука не должен содержать пробелы.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Некорректный URL внешнего API генерации звука.');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    throw new Error('Endpoint внешнего API звука должен начинаться с http:// или https://.');
  }
  return parsed.toString();
}

export function detectAudioFormatFromMime(mimeType?: string): {
  mimeType: string;
  extension: GeneratedAudioExtension;
} {
  const lower = (mimeType ?? '').toLowerCase();
  if (lower.includes('wav')) {
    return { mimeType: 'audio/wav', extension: 'wav' };
  }
  if (lower.includes('ogg')) {
    return { mimeType: 'audio/ogg', extension: 'ogg' };
  }
  return { mimeType: 'audio/mpeg', extension: 'mp3' };
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/^data:audio\/[^;]+;base64,/i, '').trim();
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(clean, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function buildGeneratedAudioFilename(extension: GeneratedAudioExtension): string {
  return `kinoflow_sound_${Date.now()}.${extension}`;
}

function bytesToAudioResult(
  bytes: Uint8Array,
  rawMimeType?: string,
  explicitExt?: string,
): GeneratedAudioResult {
  if (bytes.byteLength === 0) {
    throw new Error('Внешний API вернул пустой аудиофайл.');
  }
  const detected = explicitExt
    ? detectAudioFormatFromMime(explicitExt)
    : detectAudioFormatFromMime(rawMimeType);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: detected.mimeType });
  const base64 = uint8ArrayToBase64(bytes);
  const objectUrl =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(blob)
      : '';
  return {
    blob,
    base64,
    mimeType: detected.mimeType,
    extension: detected.extension,
    filename: buildGeneratedAudioFilename(detected.extension),
    objectUrl,
  };
}

function extractErrorMessageFromJson(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as {
      error?: string | { message?: string };
      message?: string;
      detail?: string;
    };
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    if (
      parsed.error &&
      typeof parsed.error === 'object' &&
      typeof parsed.error.message === 'string' &&
      parsed.error.message.trim()
    ) {
      return parsed.error.message.trim();
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail.trim();
  } catch {
    // Non-JSON error body
  }
  return null;
}

async function parseJsonAudioPayload(
  rawText: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<GeneratedAudioResult> {
  let payload: {
    audioBase64?: string;
    audio_base64?: string;
    audio?: string;
    audioUrl?: string;
    audio_url?: string;
    url?: string;
    mimeType?: string;
    mime_type?: string;
    format?: string;
  };
  try {
    payload = JSON.parse(rawText) as typeof payload;
  } catch {
    throw new Error('Внешний API звука вернул некорректный JSON-ответ.');
  }

  const base64Candidate = payload.audioBase64 ?? payload.audio_base64 ?? payload.audio;
  if (typeof base64Candidate === 'string' && base64Candidate.trim()) {
    const bytes = base64ToUint8Array(base64Candidate);
    const mimeHint = payload.mimeType ?? payload.mime_type ?? payload.format;
    return bytesToAudioResult(bytes, mimeHint, payload.format);
  }

  const urlCandidate = payload.audioUrl ?? payload.audio_url ?? payload.url;
  if (typeof urlCandidate === 'string' && urlCandidate.trim()) {
    const safeAudioUrl = validateExternalAudioEndpoint(urlCandidate);
    const audioRes = await fetchImpl(safeAudioUrl, { method: 'GET', signal });
    if (!audioRes.ok) {
      throw new Error(`Не удалось скачать сгенерированный звук (HTTP ${audioRes.status}).`);
    }
    const arrayBuffer = await audioRes.arrayBuffer();
    const contentType = audioRes.headers.get('content-type') ?? payload.mimeType ?? payload.format;
    return bytesToAudioResult(new Uint8Array(arrayBuffer), contentType, payload.format);
  }

  throw new Error(
    'Ответ внешнего API не содержит аудиоданных (ожидается бинарный MP3/WAV или JSON с audioBase64 / audioUrl).',
  );
}

/**
 * Generates a soundtrack or sound-effects track via a user-configured external audio API
 * (Strategy B fallback when ComfyUI-AudioCraft nodes are not installed).
 */
export async function generateExternalAudio(
  params: GenerateExternalAudioParams,
): Promise<GeneratedAudioResult> {
  const endpoint = validateExternalAudioEndpoint(params.endpoint);
  const trimmedPrompt = params.prompt.trim();
  if (!trimmedPrompt) {
    throw new Error('Введите описание звука перед запуском генерации.');
  }
  const durationSec = Math.max(1, Math.min(60, Math.round(params.durationSec || 5)));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'audio/mpeg, audio/wav, audio/ogg, application/octet-stream, application/json',
  };
  const trimmedKey = (params.apiKey ?? '').trim();
  if (trimmedKey) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }

  const body = JSON.stringify({
    prompt: trimmedPrompt,
    text: trimmedPrompt,
    duration: durationSec,
    duration_seconds: durationSec,
  });

  const electronBridge =
    typeof window !== 'undefined'
      ? (window as unknown as { kinoflowComfy?: ElectronBinaryHttpBridge }).kinoflowComfy
      : undefined;

  if (electronBridge?.request && !params.fetchImpl) {
    const res = await electronBridge.request({
      url: endpoint,
      method: 'POST',
      headers,
      body,
      timeoutMs: 120_000,
      responseType: 'base64',
    });

    const contentType = (res.contentType ?? '').toLowerCase();
    if (!res.ok) {
      const decodedText = res.bodyBase64
        ? new TextDecoder().decode(base64ToUint8Array(res.bodyBase64))
        : res.bodyText;
      const errDetail = extractErrorMessageFromJson(decodedText) || res.errorMessage || res.statusText;
      throw new Error(
        `Внешний API звука вернул ошибку${res.status ? ` (HTTP ${res.status})` : ''}: ${errDetail || 'не удалось выполнить запрос.'}`,
      );
    }

    if (contentType.includes('application/json') || contentType.includes('text/')) {
      const jsonText = res.bodyBase64
        ? new TextDecoder().decode(base64ToUint8Array(res.bodyBase64))
        : res.bodyText;
      return parseJsonAudioPayload(jsonText, fetch, params.signal);
    }

    const bytes = res.bodyBase64 ? base64ToUint8Array(res.bodyBase64) : new Uint8Array(0);
    return bytesToAudioResult(bytes, contentType);
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body,
    signal: params.signal,
  });

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const errDetail = extractErrorMessageFromJson(errText) || errText.slice(0, 200) || response.statusText;
    throw new Error(`Внешний API звука вернул ошибку (HTTP ${response.status}): ${errDetail}`);
  }

  if (contentType.includes('application/json') || contentType.includes('text/')) {
    const jsonText = await response.text();
    return parseJsonAudioPayload(jsonText, fetchImpl, params.signal);
  }

  const buffer = await response.arrayBuffer();
  return bytesToAudioResult(new Uint8Array(buffer), contentType);
}

/**
 * Converts UI audio track selection and volume percentage (0–200%) into the `audioOptions`
 * structure accepted by `ElectronFilmBridge.mergeSegments` and `electron/filmMerger.js`.
 */
export function buildFilmMergeAudioOptions(
  selectedAudio: SelectedAudioTrack | null,
  volumePercent: number = AUDIO_VOLUME_DEFAULT_PERCENT,
): { audioPath?: string; audioVolume?: number } | undefined {
  if (!selectedAudio || !selectedAudio.path.trim()) {
    return undefined;
  }
  const safePercent = Number.isFinite(volumePercent)
    ? Math.max(AUDIO_VOLUME_MIN_PERCENT, Math.min(AUDIO_VOLUME_MAX_PERCENT, volumePercent))
    : AUDIO_VOLUME_DEFAULT_PERCENT;
  return {
    audioPath: selectedAudio.path.trim(),
    audioVolume: Number((safePercent / 100).toFixed(2)),
  };
}
