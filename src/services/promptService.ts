import type { CharacterReference } from '../types/video';

export interface EnhancePromptParams {
  prompt: string;
  model: string;
  characters: Array<Pick<CharacterReference, 'name' | 'weight'>>;
  durationSec: number;
  resolution: string;
  shootingStyleLabel?: string;
  shootingStyleCue?: string;
}

export async function enhanceScenePrompt(params: EnhancePromptParams): Promise<string> {
  const response = await fetch('/api/enhance-prompt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    enhancedPrompt?: string;
    error?: string;
  };

  if (!response.ok || !payload.enhancedPrompt) {
    throw new Error(
      payload.error || `Сервер улучшения промпта вернул ошибку (${response.status}).`,
    );
  }

  return payload.enhancedPrompt;
}
