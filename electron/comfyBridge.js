/**
 * Native Node.js HTTP bridge for local ComfyUI communication in Electron.
 * Running HTTP requests from Electron's main process completely bypasses Chromium
 * CORS, Private Network Access (PNA), and OPTIONS preflight restrictions, so
 * KinoFlow Studio connects to ComfyUI even without --enable-cors-header "*".
 */

export const DEFAULT_COMFY_PROBE_PORTS = [8188, 8000, 8189];

/**
 * Extracts a normalized Node/Undici error code from a failed fetch error.
 */
export function extractNetworkErrorCode(err) {
  if (!err || typeof err !== 'object') {
    return 'NETWORK_ERROR';
  }
  if (err.name === 'AbortError') {
    return 'ABORT_ERR';
  }
  const cause = err.cause && typeof err.cause === 'object' ? err.cause : null;
  if (cause && typeof cause.code === 'string' && cause.code) {
    return cause.code;
  }
  if (typeof err.code === 'string' && err.code) {
    return err.code;
  }
  const msg = typeof err.message === 'string' ? err.message : '';
  if (/ECONNREFUSED/i.test(msg)) return 'ECONNREFUSED';
  if (/ETIMEDOUT/i.test(msg)) return 'ETIMEDOUT';
  if (/ENOTFOUND/i.test(msg)) return 'ENOTFOUND';
  if (/EHOSTUNREACH/i.test(msg)) return 'EHOSTUNREACH';
  return 'NETWORK_ERROR';
}

/**
 * Performs a single HTTP request to ComfyUI from Node.js (Electron main process).
 * Supports JSON/text bodies as well as multipart/form-data image uploads.
 */
export async function performComfyRequest(options) {
  const rawUrl = typeof options?.url === 'string' ? options.url.trim() : '';
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      status: 0,
      statusText: 'Invalid URL',
      bodyText: '',
      networkError: true,
      errorCode: 'INVALID_URL',
      errorMessage: `Некорректный адрес сервера: ${rawUrl}`,
    };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      status: 0,
      statusText: 'Unsupported Protocol',
      bodyText: '',
      networkError: true,
      errorCode: 'UNSUPPORTED_PROTOCOL',
      errorMessage: 'Поддерживаются только протоколы http:// и https://.',
    };
  }

  const method = typeof options?.method === 'string' ? options.method.toUpperCase() : 'GET';
  const timeoutMs =
    typeof options?.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 15000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOptions = {
      method,
      signal: controller.signal,
      headers: { ...(options?.headers ?? {}) },
    };

    if (options?.multipart && typeof options.multipart === 'object') {
      const formData = new FormData();
      const { fieldName, fileName, contentType, bytesBase64, fields } = options.multipart;
      const bytes = Buffer.from(bytesBase64 || '', 'base64');
      const blob = new Blob([bytes], { type: contentType || 'application/octet-stream' });
      formData.append(fieldName || 'image', blob, fileName || 'upload.png');
      if (fields && typeof fields === 'object') {
        for (const [key, val] of Object.entries(fields)) {
          formData.append(key, String(val));
        }
      }
      fetchOptions.body = formData;
      // Let Undici/fetch set the multipart boundary header automatically
      delete fetchOptions.headers['Content-Type'];
      delete fetchOptions.headers['content-type'];
    } else if (typeof options?.body === 'string') {
      fetchOptions.body = options.body;
    }

    const response = await fetch(parsedUrl.toString(), fetchOptions);
    const bodyText = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      bodyText,
      networkError: false,
    };
  } catch (err) {
    const errorCode = extractNetworkErrorCode(err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      statusText: errorCode,
      bodyText: '',
      networkError: true,
      errorCode,
      errorMessage,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes common local ComfyUI ports (8188 Portable, 8000 Desktop, 8189)
 * when the configured port is closed, returning the first responsive ComfyUI server.
 */
export async function probeLocalComfyUrls(
  excludeBaseUrl = '',
  candidatePorts = DEFAULT_COMFY_PROBE_PORTS,
  timeoutMs = 1500,
) {
  const normalizedExclude = String(excludeBaseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
  const candidates = [];

  for (const port of candidatePorts) {
    const candidate = `http://127.0.0.1:${port}`;
    if (candidate.toLowerCase() !== normalizedExclude) {
      candidates.push(candidate);
    }
  }

  const results = await Promise.all(
    candidates.map(async (baseUrl) => {
      const res = await performComfyRequest({
        url: `${baseUrl}/system_stats`,
        method: 'GET',
        timeoutMs,
      });
      if (!res.ok) return null;
      try {
        const data = JSON.parse(res.bodyText);
        // Verify payload looks like ComfyUI /system_stats
        if (data && (data.system || Array.isArray(data.devices))) {
          return { baseUrl, systemStats: data };
        }
      } catch {
        return null;
      }
      return null;
    }),
  );

  return results.find((entry) => entry !== null) ?? null;
}
