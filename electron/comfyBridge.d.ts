export const DEFAULT_COMFY_PROBE_PORTS: number[];

export interface ComfyBridgeRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  multipart?: {
    fieldName: string;
    fileName: string;
    contentType: string;
    bytesBase64: string;
    fields?: Record<string, string>;
  };
}

export interface ComfyBridgeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  bodyText: string;
  networkError: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface ComfyProbeHit {
  baseUrl: string;
  systemStats: {
    system?: { comfyui_version?: string };
    devices?: Array<{ name?: string; vram_total?: number }>;
  };
}

export function extractNetworkErrorCode(err: unknown): string;

export function performComfyRequest(
  options: ComfyBridgeRequestOptions,
): Promise<ComfyBridgeResponse>;

export function probeLocalComfyUrls(
  excludeBaseUrl?: string,
  candidatePorts?: number[],
  timeoutMs?: number,
): Promise<ComfyProbeHit | null>;
