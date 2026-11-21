import type { BaseModelId, GenerationSettings } from '../types/video';

export type VramRiskLevel = 'ok' | 'tight' | 'oom_risk';

export interface VramEstimateInput {
  modelId: BaseModelId;
  width: number;
  height: number;
  frames: number;
  upscale1080p?: boolean;
  rifeEnabled?: boolean;
  fastLightX2V?: boolean;
  vramTotalGb?: number;
}

export interface VramEstimateResult {
  estimatedGb: number;
  availableGb: number | null;
  level: VramRiskLevel;
  headline: string;
  recommendation: string | null;
  safePatch: Partial<GenerationSettings> | null;
}

/**
 * Estimates peak GPU VRAM usage (in GB) for a Wan 2.2 ComfyUI workflow segment.
 * Accounts for active expert weights (MoE loads one expert at a time in ComfyUI),
 * latent/attention buffers scaling with pixel-frames, and post-processing peaks.
 */
export function estimateVramUsage(input: VramEstimateInput): VramEstimateResult {
  const baseModelGb = (() => {
    switch (input.modelId) {
      case 'wan22-ti2v-5b-fp8':
        return 5.8;
      case 'wan22-t2v-a14b-q4':
        return 8.6;
      case 'wan22-t2v-a14b-q5':
        return 10.4;
      case 'auto':
      default:
        return 13.6; // 14B FP8 expert + VAE + buffers (with ComfyUI lowvram offload)
    }
  })();

  // Reference baseline: 832x480 @ 81 frames (~32.3M pixel-frames)
  const pixelFrames = Math.max(1, input.width) * Math.max(1, input.height) * Math.max(1, input.frames);
  const baselinePixelFrames = 832 * 480 * 81;
  const activationGb = 1.6 * (pixelFrames / baselinePixelFrames);
  const loraOverheadGb = input.fastLightX2V ? 0.5 : 0;
  const upscaleOverheadGb = input.upscale1080p ? 1.4 : 0;
  const rifeOverheadGb = input.rifeEnabled ? 0.8 : 0;

  const estimatedGb =
    Math.round((baseModelGb + activationGb + loraOverheadGb + upscaleOverheadGb + rifeOverheadGb) * 10) /
    10;

  const availableGb =
    typeof input.vramTotalGb === 'number' && Number.isFinite(input.vramTotalGb) && input.vramTotalGb > 0
      ? Math.round(input.vramTotalGb * 10) / 10
      : null;

  // Threshold against detected GPU VRAM (or typical 16 GB ceiling when GPU is not yet probed)
  const effectiveCeiling = availableGb ?? 16;

  // ComfyUI automatically offloads blocks on 12-16 GB GPUs, so allow ~2.5 GB headroom for FP8 offload
  const offloadAllowance = input.modelId === 'auto' ? 2.5 : 1.0;
  const effectiveDemand = Math.max(0, estimatedGb - offloadAllowance);

  let level: VramRiskLevel = 'ok';
  if (effectiveDemand > effectiveCeiling * 0.96 || (availableGb !== null && availableGb <= 8.5 && input.modelId !== 'wan22-ti2v-5b-fp8')) {
    level = 'oom_risk';
  } else if (effectiveDemand > effectiveCeiling * 0.78) {
    level = 'tight';
  }

  let safePatch: Partial<GenerationSettings> | null = null;
  let recommendation: string | null = null;

  if (level !== 'ok') {
    const patch: Partial<GenerationSettings> = {};
    const hints: string[] = [];

    if (input.width > 832 || input.height > 832) {
      const isPortrait = input.height > input.width;
      patch.resolutionId = isPortrait ? '480x832' : '832x480';
      patch.width = isPortrait ? 480 : 832;
      patch.height = isPortrait ? 832 : 480;
      hints.push(`снизьте разрешение до ${patch.width}×${patch.height}`);
    }
    if (input.frames > 81) {
      patch.fps = 16;
      patch.frames = 81;
      hints.push('переключите базу на 16 fps (81 кадр)');
    }
    if (input.upscale1080p) {
      patch.upscale1080p = false;
      hints.push('отключите 1080p-апскейл');
    }
    if (availableGb !== null && availableGb <= 10 && input.modelId !== 'wan22-ti2v-5b-fp8') {
      patch.modelId = 'wan22-ti2v-5b-fp8';
      hints.push('выберите лёгкую модель Wan 2.2 TI2V-5B');
    } else if (availableGb !== null && availableGb <= 12.5 && input.modelId === 'auto') {
      patch.modelId = 'wan22-t2v-a14b-q4';
      hints.push('используйте GGUF Q4_K_M для 12 ГБ VRAM');
    }

    safePatch = Object.keys(patch).length > 0 ? patch : null;
    recommendation =
      hints.length > 0
        ? `Чтобы избежать ошибки Out of Memory (OOM): ${hints.join(', ')}.`
        : 'Закройте другие приложения с GPU-нагрузкой перед стартом.';
  }

  const headline =
    level === 'oom_risk'
      ? `Высокий риск нехватки VRAM (~${estimatedGb} ГБ${availableGb ? ` при ${availableGb} ГБ на GPU` : ''})`
      : level === 'tight'
        ? `Впритык по VRAM (~${estimatedGb} ГБ${availableGb ? ` / ${availableGb} ГБ` : ''})`
        : `Оценка VRAM: ~${estimatedGb} ГБ${availableGb ? ` / ${availableGb} ГБ` : ''}`;

  return {
    estimatedGb,
    availableGb,
    level,
    headline,
    recommendation,
    safePatch,
  };
}
