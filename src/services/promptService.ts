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

export async function enhanceScenePrompt(
  params: EnhancePromptParams,
  options?: { fetchImpl?: typeof fetch; pageProtocol?: string },
): Promise<string> {
  const protocol =
    options?.pageProtocol ??
    (typeof window !== 'undefined' && window.location ? window.location.protocol : 'http:');

  if (protocol === 'file:') {
    throw new Error(
      'Улучшение промпта через Gemini доступно в веб-версии с запущенным сервером (npm run dev). В автономном Windows-приложении вы можете сразу писать промпт в поле ниже.',
    );
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl('/api/enhance-prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error(
      'Не удалось связаться с сервером улучшения промптов (/api/enhance-prompt). Проверьте, что сервер KinoFlow Studio запущен.',
    );
  }

  return parseEnhancePromptResponse(response);
}
