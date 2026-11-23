/**
 * Official required models catalog for photorealistic Wan 2.2 T2V / I2V generation in ComfyUI.
 * Direct download URLs and exact byte sizes are verified against official Comfy-Org Hugging Face repositories.
 */

export const DEFAULT_COMFY_DIR = 'C:\\ComfyUI_windows_portable\\ComfyUI';

export const REQUIRED_MODELS = [
  {
    id: 'wan22-t2v-high-fp8',
    name: 'Wan 2.2 T2V 14B FP8 (High-Noise)',
    category: 'Diffusion · T2V',
    description: 'Основной эксперт структуры и движения для генерации видео по тексту (FP8 Scaled).',
    filename: 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
    targetSubfolder: 'models/diffusion_models',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
    expectedSizeBytes: 14293923632,
  },
  {
    id: 'wan22-t2v-low-fp8',
    name: 'Wan 2.2 T2V 14B FP8 (Low-Noise)',
    category: 'Diffusion · T2V',
    description: 'Второй эксперт мелкой детализации кожи, света и текстур для Text-to-Video (FP8 Scaled).',
    filename: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
    targetSubfolder: 'models/diffusion_models',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
    expectedSizeBytes: 14293923632,
  },
  {
    id: 'wan22-i2v-high-fp8',
    name: 'Wan 2.2 I2V 14B FP8 (High-Noise)',
    category: 'Diffusion · I2V',
    description: 'Эксперт анимации стартового кадра и продолжения длинных сцен до 30+ сек (FP8 Scaled).',
    filename: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
    targetSubfolder: 'models/diffusion_models',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
    expectedSizeBytes: 14294742832,
  },
  {
    id: 'wan22-i2v-low-fp8',
    name: 'Wan 2.2 I2V 14B FP8 (Low-Noise)',
    category: 'Diffusion · I2V',
    description: 'Второй эксперт фотореалистичной прорисовки в режиме «Оживление фото» и цепочках I2V.',
    filename: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
    targetSubfolder: 'models/diffusion_models',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
    expectedSizeBytes: 14294742832,
  },
  {
    id: 'umt5-xxl-fp8',
    name: 'Текстовый энкодер UMT5-XXL FP8',
    category: 'Text Encoder',
    description: 'Точное следование сложным кинематографичным промптам (выгружается в RAM на CPU).',
    filename: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    targetSubfolder: 'models/text_encoders',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    expectedSizeBytes: 6735906897,
  },
  {
    id: 'wan-21-vae',
    name: 'Video VAE (wan_2.1_vae)',
    category: 'VAE',
    description: 'Официальный пространственно-временной VAE декодер для моделей Wan 2.2 14B.',
    filename: 'wan_2.1_vae.safetensors',
    targetSubfolder: 'models/vae',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors',
    expectedSizeBytes: 253815318,
  },
  {
    id: 'wan22-ti2v-5b',
    name: 'Wan 2.2 TI2V-5B (Быстрая T2V+I2V)',
    category: 'Diffusion · 5B (Доп.)',
    description: 'Облегчённая универсальная модель T2V+I2V для видеокарт с 8–12 ГБ VRAM (загружается в FP8 на лету).',
    filename: 'wan2.2_ti2v_5B_fp16.safetensors',
    targetSubfolder: 'models/diffusion_models',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors',
    expectedSizeBytes: 9999658848,
    optional: true,
  },
  {
    id: 'wan-22-vae',
    name: 'Video VAE 48ch (wan2.2_vae)',
    category: 'VAE · 5B (Доп.)',
    description: 'Обязательный 48-канальный VAE декодер для облегчённой модели Wan 2.2 TI2V-5B.',
    filename: 'wan2.2_vae.safetensors',
    targetSubfolder: 'models/vae',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors',
    expectedSizeBytes: 1409400960,
    optional: true,
  },
  {
    id: 'upscale-realesrgan-x2plus',
    name: 'Апскейлер RealESRGAN_x2plus (1080p)',
    category: 'Upscale · 1080p (Доп.)',
    description:
      'Основная модель для «Кино-апскейл до 1080p»: естественная детализация кожи и оптики без пластикового перешарпа.',
    filename: 'RealESRGAN_x2plus.pth',
    targetSubfolder: 'models/upscale_models',
    repoId: 'dtarnow/UPscaler',
    downloadUrl:
      'https://huggingface.co/dtarnow/UPscaler/resolve/main/RealESRGAN_x2plus.pth',
    expectedSizeBytes: 67061725,
    optional: true,
  },
  {
    id: 'upscale-4x-ultrasharp',
    name: 'Апскейлер 4x-UltraSharp (Альтернатива)',
    category: 'Upscale · 1080p (Доп.)',
    description: 'Альтернативный резкий апскейлер (4x) для архитектуры и контрастных сцен.',
    filename: '4x-UltraSharp.pth',
    targetSubfolder: 'models/upscale_models',
    repoId: 'Kim2091/UltraSharp',
    downloadUrl:
      'https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth',
    expectedSizeBytes: 66961958,
    optional: true,
  },
  {
    id: 'wan22-t2v-lightx2v-high',
    name: 'LightX2V 4-step LoRA · T2V High-Noise',
    category: 'LoRA · Турбо ×3 (Доп.)',
    description: 'Ускоряет генерацию Wan 2.2 T2V в 3–4× раза (4–8 шагов вместо 28) для High-Noise эксперта.',
    filename: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
    targetSubfolder: 'models/loras',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
    expectedSizeBytes: 1226977424,
    optional: true,
  },
  {
    id: 'wan22-t2v-lightx2v-low',
    name: 'LightX2V 4-step LoRA · T2V Low-Noise',
    category: 'LoRA · Турбо ×3 (Доп.)',
    description: 'Вторая половинка ускоряющей LoRA для Low-Noise эксперта Wan 2.2 T2V (4–8 шагов).',
    filename: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
    targetSubfolder: 'models/loras',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
    expectedSizeBytes: 1226977424,
    optional: true,
  },
  {
    id: 'wan22-i2v-lightx2v-high',
    name: 'LightX2V 4-step LoRA · I2V High-Noise',
    category: 'LoRA · Турбо ×3 (Доп.)',
    description: 'Ускоряет «Оживление фото» и цепочки 10–30 сек в 3–4× раза (High-Noise эксперт I2V).',
    filename: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
    targetSubfolder: 'models/loras',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
    expectedSizeBytes: 1226977424,
    optional: true,
  },
  {
    id: 'wan22-i2v-lightx2v-low',
    name: 'LightX2V 4-step LoRA · I2V Low-Noise',
    category: 'LoRA · Турбо ×3 (Доп.)',
    description: 'Вторая половинка ускоряющей LoRA для Low-Noise эксперта Wan 2.2 I2V (4–8 шагов).',
    filename: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
    targetSubfolder: 'models/loras',
    repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    downloadUrl:
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
    expectedSizeBytes: 1226977424,
    optional: true,
  },
];

/**
 * Evaluates installation status from disk stats of the target file and any resumable .part file.
 * For large model weights (>= 1 MB), allows a small metadata tolerance (0.5% capped at 16 MiB)
 * so valid upstream safetensors revisions are not mistakenly deleted, while truncated files are still caught.
 */
export function evaluateModelFileStatus(
  expectedSizeBytes,
  existingSizeBytes,
  partialSizeBytes = 0,
) {
  if (typeof existingSizeBytes === 'number' && existingSizeBytes >= 0) {
    const tolerance =
      expectedSizeBytes >= 1_000_000
        ? Math.min(16 * 1024 * 1024, Math.floor(expectedSizeBytes * 0.005))
        : 0;
    if (Math.abs(existingSizeBytes - expectedSizeBytes) <= tolerance) {
      return 'installed';
    }
    return 'size_mismatch';
  }
  if (typeof partialSizeBytes === 'number' && partialSizeBytes > 0) {
    return 'partial';
  }
  return 'missing';
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exp;
  const decimals = exp >= 3 ? 2 : exp === 2 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[exp]}`;
}

export function formatSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 МБ/с';
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} МБ/с`;
  }
  return `${Math.round(bytesPerSec / 1024)} КБ/с`;
}

export function formatEta(etaSeconds) {
  if (!Number.isFinite(etaSeconds) || etaSeconds < 0) return 'расчёт...';
  if (etaSeconds < 60) {
    return `${Math.max(1, Math.round(etaSeconds))} сек`;
  }
  const totalMin = Math.floor(etaSeconds / 60);
  const remSec = Math.round(etaSeconds % 60);
  if (totalMin < 60) {
    return `${totalMin} мин ${remSec} сек`;
  }
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  return `${hours} ч ${remMin} мин`;
}
