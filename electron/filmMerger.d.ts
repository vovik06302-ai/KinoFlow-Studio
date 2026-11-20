export declare function ffmpegCandidates(options?: {
  env?: Record<string, string | undefined>;
  resourcesPath?: string;
}): string[];
export declare function runProcess(
  command: string,
  args: string[],
  spawnImpl?: unknown,
): Promise<{ code: number | null; stderr: string }>;
export declare function findFfmpeg(options?: {
  candidates?: string[];
  spawnImpl?: unknown;
}): Promise<string | null>;
export declare function buildMergeArgs(options: {
  inputs: string[];
  output: string;
  trimDuplicateFirstFrame?: boolean;
  crf?: number;
}): string[];
export declare function isHttpUrl(value: unknown): boolean;
export declare function mergeSegments(options: {
  segmentUrls: string[];
  outputPath: string;
  ffmpegPath: string | null;
  tempRoot?: string;
  spawnImpl?: unknown;
  downloadImpl?: (options: { url: string; destPath: string }) => Promise<unknown>;
  onProgress?: (event: { phase: 'downloading' | 'encoding'; index: number; total: number }) => void;
}): Promise<{ outputPath: string }>;
