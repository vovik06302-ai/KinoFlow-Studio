/**
 * Plain-language diagnostics for a ComfyUI instance started from the app: why did it stop,
 * and what to do when it is running but never starts answering.
 */

/** How long a started instance may stay silent before the user is warned. */
export const STARTUP_STALL_MS = 180_000;

export interface LauncherExitInfo {
  instanceId: string;
  port: number;
  code: number | null;
  uptimeMs: number;
  lastLines: string[];
}

/** Maps typical ComfyUI error lines to a short, actionable hint (Russian). */
export function diagnoseLogLines(lines: string[], port: number): string | null {
  const text = lines.join('\n');
  if (/Another ComfyUI is already using this database|ASSETS_STARTUP_FAILED|Database lock is held/i.test(text)) {
    return 'Другой ComfyUI уже работает и держит общую базу данных (скорее всего, запущенный вручную или оставшийся с прошлого раза). Закройте все окна ComfyUI и процессы python.exe в диспетчере задач и запустите снова.';
  }
  if (/only one usage of each socket address|address already in use|WinError 10048|errno 98/i.test(text)) {
    return `Порт ${port} уже занят другой программой или другим ComfyUI. Закройте его (диспетчер задач → python.exe) или укажите другой порт.`;
  }
  if (/Errno 22|Invalid argument.*flush|logger\.py/i.test(text)) {
    return 'Сбой вывода консоли Windows. Нажмите «Патч [Errno 22]» и запустите заново.';
  }
  if (/ModuleNotFoundError|ImportError|No module named/i.test(text)) {
    return 'Не хватает Python-пакета или он повреждён (часто после установки custom-нод). Проверьте последние строки журнала.';
  }
  if (/out of memory|CUDA error|cudaMalloc|CUDA_ERROR|no CUDA GPUs|Torch not compiled with CUDA/i.test(text)) {
    return 'Проблема с видеокартой или драйвером CUDA. Проверьте номер видеокарты (0 или 1) и обновите драйвер NVIDIA.';
  }
  if (/PermissionError|Access is denied|Отказано в доступе/i.test(text)) {
    return 'Нет доступа к файлам. Проверьте, не блокирует ли папку антивирус, и не лежит ли ComfyUI в защищённой папке.';
  }
  return null;
}

/** Message shown when an instance stops on its own (not by the user's «Остановить»). */
export function describeLauncherExit(info: LauncherExitInfo): string {
  const seconds = Math.max(0, Math.round(info.uptimeMs / 1000));
  const codePart = info.code === null ? '' : ` (код ${info.code})`;
  const head =
    seconds < 90
      ? `Экземпляр ${info.instanceId} остановился${codePart} через ${seconds} с после запуска, то есть ComfyUI не смог стартовать.`
      : `Экземпляр ${info.instanceId} остановился${codePart} через ${Math.round(seconds / 60)} мин работы.`;

  const hint = diagnoseLogLines(info.lastLines, info.port);
  const tail = info.lastLines.filter((line) => line.trim()).slice(-6);
  const parts = [head];
  if (hint) parts.push(hint);
  if (tail.length > 0) parts.push(`Последние строки журнала:\n${tail.join('\n')}`);
  return parts.join('\n');
}

export function isStartupStalled(startedAt: number | null, now: number, limitMs = STARTUP_STALL_MS): boolean {
  return startedAt !== null && now - startedAt >= limitMs;
}

export function describeStartupStall(instanceId: string, port: number, lastLines: string[]): string {
  const hint = diagnoseLogLines(lastLines, port);
  const tail = lastLines.filter((line) => line.trim()).slice(-4);
  const parts = [
    `Экземпляр ${instanceId} запущен, но на порту ${port} так и не ответил за ${Math.round(STARTUP_STALL_MS / 60000)} мин. Процесс жив, значит, он завис или слушает другой порт.`,
  ];
  if (hint) parts.push(hint);
  if (tail.length > 0) parts.push(`Последние строки журнала:\n${tail.join('\n')}`);
  return parts.join('\n');
}
