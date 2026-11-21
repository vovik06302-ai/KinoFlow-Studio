import { REQUIRED_MODELS } from '../../electron/modelCatalog.js';

/**
 * Pre-flight check: before a workflow is queued, ask ComfyUI (GET /object_info/<node>) whether
 * every node class exists and every model file referenced by a loader is installed. This turns
 * "node X does not exist" errors in the middle of a render into a clear checklist up front.
 */

interface GraphNodeLike {
  class_type: string;
  inputs: Record<string, unknown>;
}
export type GraphLike = Record<string, GraphNodeLike>;

export interface NodePackHint {
  pack: string;
  url: string;
}

export const NODE_PACK_HINTS: Record<string, NodePackHint> = {
  UnetLoaderGGUF: { pack: 'ComfyUI-GGUF', url: 'https://github.com/city96/ComfyUI-GGUF' },
  CLIPLoaderGGUF: { pack: 'ComfyUI-GGUF', url: 'https://github.com/city96/ComfyUI-GGUF' },
  VHS_VideoCombine: {
    pack: 'ComfyUI-VideoHelperSuite',
    url: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite',
  },
  'RIFE VFI': {
    pack: 'ComfyUI-Frame-Interpolation',
    url: 'https://github.com/Fannovel16/ComfyUI-Frame-Interpolation',
  },
};

/** Loader nodes whose combo input lists files installed on the server. */
const MODEL_INPUTS: Array<{ classType: string; field: string; folder: string }> = [
  { classType: 'UNETLoader', field: 'unet_name', folder: 'models/diffusion_models' },
  { classType: 'UnetLoaderGGUF', field: 'unet_name', folder: 'models/diffusion_models' },
  { classType: 'CLIPLoader', field: 'clip_name', folder: 'models/text_encoders' },
  { classType: 'CLIPLoaderGGUF', field: 'clip_name', folder: 'models/text_encoders' },
  { classType: 'VAELoader', field: 'vae_name', folder: 'models/vae' },
  { classType: 'CLIPVisionLoader', field: 'clip_name', folder: 'models/clip_vision' },
  { classType: 'UpscaleModelLoader', field: 'model_name', folder: 'models/upscale_models' },
  {
    classType: 'RIFE VFI',
    field: 'ckpt_name',
    folder: 'custom_nodes/ComfyUI-Frame-Interpolation/ckpts/rife',
  },
];

export interface MissingNode {
  classType: string;
  nodeIds: string[];
  pack?: string;
  url?: string;
}

export interface MissingFile {
  nodeId: string;
  classType: string;
  field: string;
  value: string;
  folder: string;
  /** Set when the Models manager can download this exact file. */
  catalogModelId?: string;
  catalogName?: string;
}

export type VideoExportBackend = 'vhs' | 'core';

export interface PreflightReport {
  ok: boolean;
  missingNodes: MissingNode[];
  missingFiles: MissingFile[];
  /** Set to 'core' when VHS_VideoCombine is absent but ComfyUI's built-in CreateVideo + SaveVideo nodes are installed. */
  videoExportBackend?: VideoExportBackend;
  /** Exact option strings reported by ComfyUI when a model lives in a subfolder (e.g. "wan/model.safetensors"). */
  resolvedModelNames?: Record<string, string>;
  /** Validated SaveVideo format/codec strings reported by ComfyUI /object_info/SaveVideo. */
  coreVideoFormat?: string;
  coreVideoCodec?: string;
}

export class PreflightError extends Error {
  report: PreflightReport;

  constructor(report: PreflightReport) {
    super(formatPreflightReport(report));
    this.name = 'PreflightError';
    this.report = report;
  }
}

/** Combo options come as `[["a","b"], {...}]` (old) or `["COMBO", {options:["a","b"]}]` (new). */
export function extractComboOptions(spec: unknown): string[] | null {
  if (!Array.isArray(spec) || spec.length === 0) return null;
  const first = spec[0];
  if (Array.isArray(first)) return first.map(String);
  if (first === 'COMBO' && spec[1] && typeof spec[1] === 'object') {
    const options = (spec[1] as { options?: unknown }).options;
    if (Array.isArray(options)) return options.map(String);
  }
  return null;
}

function normalizeName(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

export function buildModelResolutionKey(classType: string, field: string, value: string): string {
  return `${classType}:${field}:${value}`;
}

/**
 * ComfyUI may list files inside sub-folders ("wan/model.safetensors" or "wan\\model.safetensors").
 * Returns the exact string listed by ComfyUI so POST /prompt passes strict combo validation.
 */
export function findInstalledOption(value: string, options: string[]): string | null {
  const wanted = normalizeName(value);
  const exact = options.find((option) => normalizeName(option) === wanted);
  if (exact) return exact;

  const wantedBase = wanted.split('/').pop();
  const byBase = options.find((option) => normalizeName(option).split('/').pop() === wantedBase);
  return byBase ?? null;
}

function pickPreferredOption(
  spec: unknown,
  preferred: string[],
  fallback: string,
): string {
  const options = extractComboOptions(spec);
  if (!options || options.length === 0) return fallback;
  for (const candidate of preferred) {
    const exact = options.find((opt) => opt.toLowerCase() === candidate.toLowerCase());
    if (exact) return exact;
  }
  return options[0];
}

export function collectGraphClassTypes(graphs: GraphLike[]): string[] {
  const classTypes = new Set<string>();
  for (const graph of graphs) {
    for (const node of Object.values(graph)) {
      if (node?.class_type) classTypes.add(node.class_type);
    }
  }
  // When a graph uses VHS_VideoCombine, also probe ComfyUI's built-in CreateVideo + SaveVideo nodes
  // so stock ComfyUI installs work without requiring ComfyUI-VideoHelperSuite.
  if (classTypes.has('VHS_VideoCombine')) {
    classTypes.add('CreateVideo');
    classTypes.add('SaveVideo');
  }
  return [...classTypes];
}

export function analyzePreflight(
  graphs: GraphLike[],
  objectInfo: Record<string, any>,
): PreflightReport {
  const missingNodeMap = new Map<string, Set<string>>();
  const missingFiles: MissingFile[] = [];
  const seenFiles = new Set<string>();
  const resolvedModelNames: Record<string, string> = {};
  const canUseCoreVideoExport =
    !objectInfo.VHS_VideoCombine && Boolean(objectInfo.CreateVideo && objectInfo.SaveVideo);
  let usesCoreVideoFallback = false;

  for (const graph of graphs) {
    for (const [nodeId, node] of Object.entries(graph)) {
      if (!node?.class_type) continue;
      if (node.class_type === 'VHS_VideoCombine' && canUseCoreVideoExport) {
        usesCoreVideoFallback = true;
        continue;
      }
      const info = objectInfo[node.class_type];

      if (!info) {
        if (!missingNodeMap.has(node.class_type)) missingNodeMap.set(node.class_type, new Set());
        missingNodeMap.get(node.class_type)!.add(nodeId);
        continue;
      }

      for (const rule of MODEL_INPUTS) {
        if (rule.classType !== node.class_type) continue;
        const value = node.inputs[rule.field];
        if (typeof value !== 'string' || !value || value.startsWith('{{')) continue;

        const options = extractComboOptions(info?.input?.required?.[rule.field]);
        if (!options) continue;

        const matchedOption = findInstalledOption(value, options);
        if (matchedOption) {
          if (matchedOption !== value) {
            resolvedModelNames[buildModelResolutionKey(rule.classType, rule.field, value)] =
              matchedOption;
          }
          continue;
        }

        const key = buildModelResolutionKey(rule.classType, rule.field, value);
        if (seenFiles.has(key)) continue;
        seenFiles.add(key);

        const catalog = REQUIRED_MODELS.find((model) => model.filename === value);
        missingFiles.push({
          nodeId,
          classType: node.class_type,
          field: rule.field,
          value,
          folder: rule.folder,
          catalogModelId: catalog?.id,
          catalogName: catalog?.name,
        });
      }
    }
  }

  const missingNodes: MissingNode[] = [...missingNodeMap.entries()].map(([classType, ids]) => ({
    classType,
    nodeIds: [...ids],
    pack: NODE_PACK_HINTS[classType]?.pack,
    url: NODE_PACK_HINTS[classType]?.url,
  }));

  const report: PreflightReport = {
    ok: missingNodes.length === 0 && missingFiles.length === 0,
    missingNodes,
    missingFiles,
  };
  if (Object.keys(resolvedModelNames).length > 0) {
    report.resolvedModelNames = resolvedModelNames;
  }
  if (usesCoreVideoFallback) {
    report.videoExportBackend = 'core';
    const saveVideoRequired = objectInfo.SaveVideo?.input?.required;
    if (saveVideoRequired) {
      report.coreVideoFormat = pickPreferredOption(
        saveVideoRequired.format,
        ['mp4', 'auto'],
        'mp4',
      );
      report.coreVideoCodec = pickPreferredOption(
        saveVideoRequired.codec,
        ['h264', 'auto'],
        'h264',
      );
    }
  }
  return report;
}

export function formatPreflightReport(report: PreflightReport): string {
  const lines: string[] = ['ComfyUI ещё не готов к этой генерации.'];
  if (report.missingNodes.length > 0) {
    lines.push('Не установлены ноды:');
    for (const node of report.missingNodes) {
      lines.push(
        node.pack
          ? `• ${node.classType} — установите «${node.pack}» (${node.url})`
          : `• ${node.classType}`,
      );
    }
  }
  if (report.missingFiles.length > 0) {
    lines.push('Не найдены файлы моделей:');
    for (const file of report.missingFiles) {
      const hint = file.catalogModelId
        ? 'можно скачать во вкладке «Модели и установка»'
        : file.value.toLowerCase().endsWith('.gguf')
          ? 'GGUF-файл нужно скачать вручную'
          : 'скачайте файл вручную';
      lines.push(`• ${file.value} → ${file.folder} (${hint})`);
    }
  }
  lines.push('После установки перезапустите ComfyUI и повторите генерацию.');
  return lines.join('\n');
}

export async function fetchObjectInfo(
  serverUrl: string,
  classTypes: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, any>> {
  const base = serverUrl.replace(/\/+$/, '');
  const merged: Record<string, any> = {};
  let receivedAnyHttpResponse = false;
  let lastNetworkError: unknown = null;

  await Promise.allSettled(
    classTypes.map(async (classType) => {
      try {
        const response = await fetchImpl(`${base}/object_info/${encodeURIComponent(classType)}`, {
          method: 'GET',
          mode: 'cors',
        });
        receivedAnyHttpResponse = true;
        if (!response.ok) {
          // Unknown/unsupported node classes may return 404 or 400 depending on ComfyUI version;
          // treat as absent rather than aborting the whole preflight check.
          return;
        }
        const payload = (await response.json()) as Record<string, any>;
        if (payload && payload[classType]) merged[classType] = payload[classType];
      } catch (err) {
        lastNetworkError = err;
      }
    }),
  );

  if (classTypes.length > 0 && !receivedAnyHttpResponse) {
    throw lastNetworkError ?? new Error('Не удалось связаться с /object_info ComfyUI.');
  }

  return merged;
}

/**
 * Runs the check. Never blocks on its own failures (unreachable server, odd response shape):
 * only a definite "node/file is missing" answer produces a report with ok === false.
 */
export async function runPreflight(
  serverUrl: string,
  graphs: GraphLike[],
  fetchImpl: typeof fetch = fetch,
): Promise<PreflightReport | null> {
  try {
    const objectInfo = await fetchObjectInfo(serverUrl, collectGraphClassTypes(graphs), fetchImpl);
    return analyzePreflight(graphs, objectInfo);
  } catch {
    return null;
  }
}
