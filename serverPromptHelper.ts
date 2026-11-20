export interface CharacterHint {
  name: string;
  weight: number;
}

export interface EnhancePromptBody {
  prompt?: string;
  model?: string;
  characters?: CharacterHint[];
  durationSec?: number;
  resolution?: string;
  shootingStyleLabel?: string;
  shootingStyleCue?: string;
}

export interface GeminiTextGenerator {
  generateText(params: {
    model: string;
    contents: string;
    systemInstruction: string;
  }): Promise<string>;
}

export const ENHANCE_PROMPT_MODELS = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const;

export function buildEnhancePromptMessages(body: EnhancePromptBody): {
  systemInstruction: string;
  userMessage: string;
} {
  const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const characters = Array.isArray(body.characters)
    ? body.characters.filter((c) => c && typeof c.name === 'string' && c.name.trim().length > 0)
    : [];

  const characterSection =
    characters.length > 0
      ? `Active character reference photos (MUST preserve these exact character names verbatim and maintain consistent facial identity/appearance from the reference photos):\n${characters
          .map(
            (c, idx) =>
              `- Character ${idx + 1}: "${c.name.trim()}" (IP-Adapter / FaceID identity weight: ${Number(c.weight).toFixed(2)})`,
          )
          .join('\n')}`
      : 'No named character reference photos attached.';

  const targetModel = typeof body.model === 'string' ? body.model : 'Wan 2.2';
  const durationInfo =
    typeof body.durationSec === 'number' ? `${body.durationSec}s scene` : '5s scene';
  const resolutionInfo = typeof body.resolution === 'string' ? body.resolution : '832x480';
  const styleLabel =
    typeof body.shootingStyleLabel === 'string' && body.shootingStyleLabel.trim()
      ? body.shootingStyleLabel.trim()
      : 'Кинематографичный реализм (ARRI 35mm)';
  const styleCue =
    typeof body.shootingStyleCue === 'string' && body.shootingStyleCue.trim()
      ? body.shootingStyleCue.trim()
      : 'Shot on ARRI Alexa 35 with 35mm prime cinema lens, natural filmic dynamic range, subtle organic 35mm grain.';

  const systemInstruction = [
    'You are an Oscar-caliber Director of Photography and Diffusion Transformer (Wan 2.2 / CogVideoX) live-action photorealism prompt engineer.',
    'Translate the user scene description (typically in Russian) into a single, richly detailed live-action cinematic English prompt engineered for maximum photorealism.',
    'Strict rules:',
    '1. Output ONLY the final English prompt as one cohesive paragraph (100 to 165 words). No markdown, no quotes, no headings, no explanations.',
    '2. Preserve EVERY character name provided in the user prompt or character reference list verbatim, and describe them as real photographed humans keeping consistent likeness to their reference photographs.',
    '3. Always incorporate authentic live-action optical and physical realism details organically into the scene:',
    '   - Natural human skin texture with fine pores, subtle lines, realistic micro-expressions, and zero plastic or waxy sheen.',
    '   - Realistic physical fabric folds, garment weight, and natural stray hair strands moving naturally with air and body momentum.',
    '   - Physically motivated natural or practical lighting with true shadow falloff, subtle skin subsurface scattering, and natural eye catchlights.',
    '   - Authentic optical depth of field, focus breathing, lens physics, and subtle organic film grain matching the requested shooting style.',
    '4. Structure chronologically: camera framing and movement -> characters and natural expressions -> continuous physical action -> environment and practical lighting -> optical/camera texture.',
    '5. NEVER use artificial buzzwords like "8k, unreal engine, octane render, masterpiece, hyperrealistic CGI". Write strictly as a real film camera capturing a real moment.',
  ].join('\n');

  const userMessage = [
    `Target video model: ${targetModel} (${resolutionInfo}, ${durationInfo})`,
    `Selected shooting style: ${styleLabel}`,
    `Optical style direction: ${styleCue}`,
    characterSection,
    `Original scene description:\n${rawPrompt}`,
  ].join('\n\n');

  return { systemInstruction, userMessage };
}

function extractRawErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Неизвестная ошибка Gemini API';
}

export function isTransientGeminiError(error: unknown): boolean {
  const raw = extractRawErrorText(error);
  return /\b(503|502|504|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|ETIMEDOUT|ECONNRESET|fetch failed|TimeoutError|timed out|aborted/i.test(
    raw,
  );
}

export function formatGeminiEnhanceError(error: unknown): { status: number; message: string } {
  const raw = extractRawErrorText(error);

  if (raw.includes('GEMINI_API_KEY')) {
    return {
      status: 500,
      message: 'На сервере не настроен ключ GEMINI_API_KEY для улучшения промптов.',
    };
  }

  if (/\b503\b|UNAVAILABLE|high demand|overloaded/i.test(raw)) {
    return {
      status: 503,
      message:
        'Сервер Gemini временно перегружен (503). Подождите несколько секунд и повторите попытку.',
    };
  }

  if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    return {
      status: 429,
      message: 'Превышен лимит запросов к Gemini API (429). Попробуйте чуть позже.',
    };
  }

  if (/\b(400|401|403)\b|API_KEY_INVALID|PERMISSION_DENIED/i.test(raw)) {
    return {
      status: 502,
      message: 'Ошибка доступа к Gemini API (проверьте API-ключ в настройках окружения).',
    };
  }

  if (/\b404\b|NOT_FOUND/i.test(raw)) {
    return {
      status: 502,
      message: 'Выбранная модель Gemini недоступна (404). Попробуйте повторить запрос позже.',
    };
  }

  // Unwrap embedded JSON error payload if present so the user never sees raw JSON brackets
  let cleaned = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) {
      cleaned = parsed.error.message;
    }
  } catch {
    // Keep original message
  }

  return {
    status: 502,
    message: `Не удалось улучшить промпт: ${cleaned}`,
  };
}

export async function enhancePromptWithRetry(
  generator: GeminiTextGenerator,
  messages: { systemInstruction: string; userMessage: string },
  options?: {
    models?: readonly string[];
    retryDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<string> {
  const models = options?.models ?? ENHANCE_PROMPT_MODELS;
  const retryDelayMs = options?.retryDelayMs ?? 700;
  const sleep =
    options?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let lastError: unknown = null;

  for (let mIdx = 0; mIdx < models.length; mIdx += 1) {
    const model = models[mIdx];
    const maxAttempts = mIdx === 0 ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const text = (
          await generator.generateText({
            model,
            contents: messages.userMessage,
            systemInstruction: messages.systemInstruction,
          })
        ).trim();

        if (!text) {
          throw new Error('Модель Gemini вернула пустой ответ. Попробуйте повторить запрос.');
        }
        return text;
      } catch (err) {
        lastError = err;
        const transient = isTransientGeminiError(err);
        if (!transient) {
          throw err;
        }
        if (attempt < maxAttempts) {
          await sleep(retryDelayMs * attempt);
        }
      }
    }
  }

  throw lastError ?? new Error('Модель Gemini вернула пустой ответ. Попробуйте повторить запрос.');
}
