export function isLocalComfyHost(hostname: string): boolean;
export function isLocalComfyUrl(urlString: string): boolean;
export function isLocalComfyHttpUrl(urlString: string): boolean;
export function resolveWindowIconPath(
  electronDir: string,
  fsImpl?: { existsSync(target: string): boolean },
): string | null;
export function resolveRendererEntryPath(
  electronDir: string,
  fsImpl?: { existsSync(target: string): boolean },
): string | null;
export function formatErrorForLog(error: unknown): string;
export function appendStartupLog(
  logPath: string | null | undefined,
  label: string,
  error: unknown,
  fsImpl?: {
    mkdirSync(target: string, options?: { recursive?: boolean }): unknown;
    appendFileSync(target: string, data: string, encoding?: string): void;
  },
): void;
