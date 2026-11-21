import type { CharacterReference } from '../types/video';

export interface EnhancePromptParams {
  prompt: string;
  model: string;
  characters: Array<Pick<CharacterReference, 'name' | 'weight'>>;
  durationSec: number;
  resolution: string;
  shootingStyleLabel?: string;
  shootingStyleCue?: string;
  cameraMovement?: string;
  lightingPreset?: string;
}

export type PromptEnhanceSource = 'local-llm' | 'gemini' | 'offline-composer';

export interface EnhancePromptOptions {
  fetchImpl?: typeof fetch;
  pageProtocol?: string;
  offlineMode?: boolean;
  localLlmUrl?: string;
  localLlmModel?: string;
}

export interface EnhancePromptDetailedResult {
  enhancedPrompt: string;
  source: PromptEnhanceSource;
}

const DEFAULT_REALISM_DIRECTIVE =
  'authentic live-action cinema footage, natural skin texture with fine pores and subtle micro-expressions, physically motivated lighting with true shadow falloff, natural fabric and hair movement, continuous smooth physical motion, shallow optical depth of field';

/**
 * 100% autonomous, offline cinematic prompt builder.
 * Preserves user prompt and named characters while cleanly weaving in camera movement,
 * lighting preset, shooting style optics, and photorealistic live-action cues without duplicates.
 */
export function composeOfflineCinematicPrompt(params: EnhancePromptParams): string {
  const base = params.prompt.trim().replace(/\s+/g, ' ');
  if (!base) return '';

  const segments: string[] = [];
  const lowerAll = () => segments.join(' ').toLowerCase();

  const pushUnique = (fragment?: string) => {
    const clean = (fragment ?? '').trim().replace(/^[.,;:\s]+|[.,;:\s]+$/g, '');
    if (!clean) return;
    const probe = clean.slice(0, Math.min(24, clean.length)).toLowerCase();
    if (probe.length >= 6 && lowerAll().includes(probe)) return;
    segments.push(clean);
  };

  pushUnique(base);

  const namedChars = (params.characters ?? [])
    .map((c) => c.name.trim())
    .filter(Boolean);
  const missingCharNames = namedChars.filter((name) => !base.toLowerCase().includes(name.toLowerCase()));
  if (missingCharNames.length > 0) {
    pushUnique(`featuring ${missingCharNames.join(' and ')} with consistent natural appearance`);
  }

  pushUnique(params.cameraMovement);
  pushUnique(params.lightingPreset);
  pushUnique(params.shootingStyleCue);
  pushUnique(DEFAULT_REALISM_DIRECTIVE);

  return segments
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ');
}

function cleanLlmResponseText(text: string): string {
  return text
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^["'«»“”]+|["'«»“”]+$/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

interface ElectronHttpBridge {
  request?: (options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }) => Promise<{ ok: boolean; status: number; bodyText: string; errorMessage?: string }>;
}

/**
 * Enhances a scene prompt using a locally running LLM server (Ollama `/api/chat` or
 * OpenAI-compatible LM Studio / llama.cpp `/v1/chat/completions`) with zero cloud traffic.
 */
export async function enhancePromptViaLocalLlm(
  params: EnhancePromptParams,
  options: { url: string; model?: string; fetchImpl?: typeof fetch },
): Promise<string> {
  const baseUrl = options.url.trim().replace(/\/+$/, '');
  const modelName = (options.model ?? '').trim() || 'qwen2.5:7b';
  const fetchImpl = options.fetchImpl ?? fetch;

  const isOllamaNative = /:11434$/i.test(baseUrl) && !/\/v1$/i.test(baseUrl);
  const endpoint = isOllamaNative
    ? `${baseUrl}/api/chat`
    : /\/v1$/i.test(baseUrl)
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/v1/chat/completions`;

  const systemPrompt =
    'You are a cinematic video prompt engineer for Wan 2.2. Translate the user scene into ONE cohesive photorealistic English paragraph (90-150 words). Preserve all character names verbatim. Include the requested camera movement, lighting, and optical style. Output ONLY the final prompt text with no quotes or markdown.';
  const userContent = [
    `Scene: ${params.prompt.trim()}`,
    params.cameraMovement ? `Camera: ${params.cameraMovement}` : '',
    params.lightingPreset ? `Lighting: ${params.lightingPreset}` : '',
    params.shootingStyleCue ? `Style: ${params.shootingStyleCue}` : '',
    params.characters.length > 0
      ? `Characters: ${params.characters.map((c) => c.name.trim()).filter(Boolean).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const payload = isOllamaNative
    ? JSON.stringify({
        model: modelName,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      })
    : JSON.stringify({
        model: modelName,
        temperature: 0.5,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });

  const electronBridge =
    typeof window !== 'undefined'
      ? (window as unknown as { kinoflowComfy?: ElectronHttpBridge }).kinoflowComfy
      : undefined;

  let bodyText: string;
  if (electronBridge?.request && !options.fetchImpl) {
    const res = await electronBridge.request({
      url: endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      timeoutMs: 45_000,
    });
    if (!res.ok) {
      throw new Error(`Локальная LLM (${endpoint}) ответила ошибкой ${res.status || ''}`);
    }
    bodyText = res.bodyText;
  } else {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    if (!response.ok) {
      throw new Error(`Локальная LLM ответила статусом HTTP ${response.status}.`);
    }
    bodyText = await response.text();
  }

  const parsed = JSON.parse(bodyText) as {
    message?: { content?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = parsed.message?.content ?? parsed.choices?.[0]?.message?.content ?? '';
  const cleaned = cleanLlmResponseText(raw);
  if (!cleaned) {
    throw new Error('Локальная LLM вернула пустой ответ.');
  }
  return cleaned;
}

/** Returns true if the text contains Cyrillic characters (Russian/Ukrainian/etc.). */
export function containsCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text);
}

/**
 * Translates a Russian/Cyrillic video prompt directly into crisp, natural English for Wan 2.2
 * using a local Ollama or OpenAI-compatible LM Studio server with zero cloud traffic.
 */
export async function translatePromptToEnglishViaLocalLlm(
  text: string,
  options: { url: string; model?: string; fetchImpl?: typeof fetch },
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (!containsCyrillic(trimmed)) return trimmed;

  const baseUrl = options.url.trim().replace(/\/+$/, '');
  const modelName = (options.model ?? '').trim() || 'qwen2.5:7b';
  const fetchImpl = options.fetchImpl ?? fetch;

  const isOllamaNative = /:11434$/i.test(baseUrl) && !/\/v1$/i.test(baseUrl);
  const endpoint = isOllamaNative
    ? `${baseUrl}/api/chat`
    : /\/v1$/i.test(baseUrl)
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/v1/chat/completions`;

  const systemPrompt =
    'You are a precise cinematic translator for Wan 2.2 video generation. Translate the user prompt into natural, descriptive English preserving every visual detail, subject, camera action, and lighting cue. Do NOT invent new plot elements or add quotes/markdown. Output ONLY the English translation.';

  const payload = isOllamaNative
    ? JSON.stringify({
        model: modelName,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: trimmed },
        ],
      })
    : JSON.stringify({
        model: modelName,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: trimmed },
        ],
      });

  const electronBridge =
    typeof window !== 'undefined'
      ? (window as unknown as { kinoflowComfy?: ElectronHttpBridge }).kinoflowComfy
      : undefined;

  let bodyText: string;
  if (electronBridge?.request && !options.fetchImpl) {
    const res = await electronBridge.request({
      url: endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      timeoutMs: 30_000,
    });
    if (!res.ok) {
      throw new Error(`Локальная LLM (${endpoint}) ответила ошибкой ${res.status || ''}`);
    }
    bodyText = res.bodyText;
  } else {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    if (!response.ok) {
      throw new Error(`Локальная LLM ответила статусом HTTP ${response.status}.`);
    }
    bodyText = await response.text();
  }

  const parsed = JSON.parse(bodyText) as {
    message?: { content?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = parsed.message?.content ?? parsed.choices?.[0]?.message?.content ?? '';
  const cleaned = cleanLlmResponseText(raw);
  if (!cleaned) {
    throw new Error('Локальная LLM вернула пустой перевод.');
  }
  return cleaned;
}

export async function parseEnhancePromptResponse(response: Response): Promise<string> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const bodyText = await response.text().catch(() => '');
  const trimmed = bodyText.trim();
  const looksLikeHtml =
    contentType.includes('text/html') || /^<!doctype\s+html|^<html\b/i.test(trimmed);

  let payload: { enhancedPrompt?: string; error?: string } = {};
  if (trimmed && !looksLikeHtml) {
    try {
      payload = JSON.parse(trimmed) as { enhancedPrompt?: string; error?: string };
    } catch {
      payload = {};
    }
  }

  if (response.ok && typeof payload.enhancedPrompt === 'string' && payload.enhancedPrompt.trim()) {
    return payload.enhancedPrompt.trim();
  }

  if (payload.error) {
    throw new Error(payload.error);
  }

  if (looksLikeHtml) {
    throw new Error(
      'Эндпоинт улучшения промпта (/api/enhance-prompt) не активен: сервер вернул HTML-страницу вместо JSON. Запустите веб-версию через сервер (npm run dev / server.ts) или введите промпт вручную.',
    );
  }

  throw new Error(
    response.ok
      ? 'Сервер улучшения промпта вернул пустой или некорректный JSON-ответ.'
      : `Сервер улучшения промпта вернул ошибку (HTTP ${response.status}).`,
  );
}

/**
 * 3-tier autonomous prompt enhancement:
 * 1. If a local LLM URL (Ollama / LM Studio) is configured, tries local LLM first (100% offline).
 * 2. In Electron desktop (`file:`) or when `offlineMode` is enabled, uses the built-in offline
 *    cinematic prompt composer immediately with zero internet traffic.
 * 3. In web mode (`http:`/`https:`), calls `/api/enhance-prompt` (Gemini) and falls back to the
 *    local offline composer only on network/endpoint unavailability.
 */
export async function enhanceScenePromptDetailed(
  params: EnhancePromptParams,
  options?: EnhancePromptOptions,
): Promise<EnhancePromptDetailedResult> {
  if (!params.prompt.trim()) {
    throw new Error('Введите описание сцены перед улучшением промпта.');
  }

  const localLlmUrl = options?.localLlmUrl?.trim();
  if (localLlmUrl) {
    try {
      const enhancedPrompt = await enhancePromptViaLocalLlm(params, {
        url: localLlmUrl,
        model: options?.localLlmModel,
        fetchImpl: options?.fetchImpl,
      });
      return { enhancedPrompt, source: 'local-llm' };
    } catch {
      // Fall through to offline composer in offline/Electron mode, or cloud in online web mode
      if (options?.offlineMode || options?.pageProtocol === 'file:') {
        return {
          enhancedPrompt: composeOfflineCinematicPrompt(params),
          source: 'offline-composer',
        };
      }
    }
  }

  const protocol =
    options?.pageProtocol ??
    (typeof window !== 'undefined' && window.location ? window.location.protocol : 'http:');

  if (protocol === 'file:' || options?.offlineMode) {
    return {
      enhancedPrompt: composeOfflineCinematicPrompt(params),
      source: 'offline-composer',
    };
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl('/api/enhance-prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
    const enhancedPrompt = await parseEnhancePromptResponse(response);
    return { enhancedPrompt, source: 'gemini' };
  } catch {
    return {
      enhancedPrompt: composeOfflineCinematicPrompt(params),
      source: 'offline-composer',
    };
  }
}

export async function enhanceScenePrompt(
  params: EnhancePromptParams,
  options?: EnhancePromptOptions,
): Promise<string> {
  const result = await enhanceScenePromptDetailed(params, options);
  return result.enhancedPrompt;
}
