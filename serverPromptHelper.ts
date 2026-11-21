export interface CharacterHint {
  name: string;
  weight: number;
}

export interface CameraMovement {
  label: string;
  cue: string;
}

export interface LightingPreset {
  label: string;
  cue: string;
}

export const CAMERA_MOVEMENTS: CameraMovement[] = [
  { label: 'Static Shot', cue: 'static camera, no movement, locked-off shot' },
  { label: 'Slow Zoom In', cue: 'slow cinematic zoom in, gradually approaching the subject' },
  { label: 'Slow Zoom Out', cue: 'slow cinematic zoom out, revealing the environment' },
  { label: 'Pan Left/Right', cue: 'slow cinematic horizontal pan across the scene' },
  { label: 'Dolly Shot', cue: 'smooth dolly movement, camera gliding forward through the scene' },
  { label: 'Orbital Shot', cue: 'slow cinematic orbital camera movement rotating around the subject' },
  { label: 'Handheld Shake', cue: 'subtle handheld camera movement, organic shaky cam, documentary style' },
  { label: 'Drone View', cue: 'high-angle cinematic drone shot, sweeping aerial perspective' },
];

export const LIGHTING_PRESETS: LightingPreset[] = [
  { label: 'Golden Hour', cue: 'warm golden hour lighting, soft long shadows, amber sunlight' },
  { label: 'Cinematic Noir', cue: 'high-contrast noir lighting, deep shadows, dramatic chiaroscuro, moody atmosphere' },
  { label: 'Cyberpunk Neon', cue: 'vibrant neon lighting, contrasting cyan and magenta hues, futuristic nocturnal glow' },
  { label: 'Soft Studio', cue: 'soft professional studio lighting, diffused light, clean minimal shadows' },
  { label: 'Moonlit Night', cue: 'dark nocturnal scene, cool moonlight, soft silver glints, deep blue shadows' },
  { label: 'Overcast Day', cue: 'diffused natural light, soft flat lighting, grey moody sky' },
];

export interface EnhancePromptBody {
  prompt?: string;
  model?: string;
  characters?: CharacterHint[];
  durationSec?: number;
  resolution?: string;
  cameraMovement?: string;
  lightingPreset?: string;
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
      ? `Active character reference photos (MUST preserve these exact character names verbatim and maintain consistent facial identity/appearance from the reference reference photos):\\n${characters
          .map(
            (c, idx) =>
              `- Character ${idx + 1}: "${c.name.trim()}" (IP-Adapter / FaceID identity weight: ${Number(c.weight).toFixed(2)})`
          )
          .join('\\n')}`
      : 'No named character reference photos attached.';

  const targetModel = typeof body.model === 'string' ? body.model : 'Wan 2.2';
  const durationInfo =
    typeof body.durationSec === 'number' ? `${body.durationSec}s scene` : '5s scene';
  const resolutionInfo = typeof body.resolution === 'string' ? body.resolution : '832x480';
  
  const cameraCue = body.cameraMovement || 'natural cinematic camera movement';
  const lightingCue = body.lightingPreset || 'natural cinematic lighting';

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
  ].join('\\n');

  const userMessage = [
    `Target video model: ${targetModel} (${resolutionInfo}, ${durationInfo})`,
    `Selected camera movement: ${cameraCue}`,
    `Selected lighting: ${lightingCue}`,
    `Visual style: ${styleLabel}`,
    `Optical style direction: ${styleCue}`,
    characterSection,
    `Original scene description:\\n${rawPrompt}`,
  ].join('\\n\\n');

  return { systemInstruction, userMessage };
}

function extractRawErrorText(error: unknown): string {
  if (error instanceof Error) return error.//... (остальное без изменений)
}

// ... (продолжение файла с функциями ошибок и retry, которые остаются прежними)
