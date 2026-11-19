import type {
  ModelDownloadProgressEvent,
  ModelDownloadSnapshot,
  ModelScanResult,
  RequiredModelDefinition,
} from '../src/types/models';

export declare function resolveModelPaths(
  comfyDir: string,
  model: RequiredModelDefinition,
): {
  normalizedRoot: string;
  targetDir: string;
  finalPath: string;
  partPath: string;
};

export declare function scanModelsDirectory(
  comfyDir: string,
  catalog?: RequiredModelDefinition[],
): Promise<ModelScanResult>;

export declare class ModelDownloadManager {
  constructor(catalog?: RequiredModelDefinition[]);
  subscribe(listener: (event: ModelDownloadProgressEvent) => void): () => void;
  getSnapshot(): ModelDownloadSnapshot;
  cancel(modelId?: string): { cancelled: boolean };
  startQueue(
    comfyDir: string,
    modelIds?: string[],
  ): Promise<{ started: boolean; queue: string[] }>;
}
