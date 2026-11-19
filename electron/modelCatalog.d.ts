import type { RequiredModelDefinition } from '../src/types/models';

export declare const DEFAULT_COMFY_DIR: string;
export declare const REQUIRED_MODELS: RequiredModelDefinition[];

export declare function evaluateModelFileStatus(
  expectedSizeBytes: number,
  existingSizeBytes: number | null,
  partialSizeBytes?: number,
): 'installed' | 'missing' | 'partial' | 'size_mismatch';

export declare function formatBytes(bytes: number): string;
export declare function formatSpeed(bytesPerSec: number): string;
export declare function formatEta(etaSeconds: number | null | undefined): string;
