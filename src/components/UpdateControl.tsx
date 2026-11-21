import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { UpdateInfo, UpdateProgressEvent } from '../types/updater';

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 4000;

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error';

interface UpdateControlProps {
  /** Disables updating while a video is being generated (the app restarts to install). */
  busy?: boolean;
  /** When enabled, skips automatic background checks against GitHub API. */
  offlineMode?: boolean;
}

function formatMegabytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(0)} МБ`;
}

export function UpdateControl({ busy = false, offlineMode = false }: UpdateControlProps) {
  const bridge = typeof window !== 'undefined' ? window.kinoflowUpdater : undefined;
  const [version, setVersion] = useState<string>(
    typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
  );
  const [phase, setPhase] = useState<Phase>('idle');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [percent, setPercent] = useState(0);
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [errorText, setErrorText] = useState('');
  const [upToDate, setUpToDate] = useState(false);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  const runCheck = useCallback(async () => {
    if (!bridge) return;
    if (phaseRef.current === 'downloading' || phaseRef.current === 'installing') return;
    setPhase('checking');
    setErrorText('');
    try {
      const result = await bridge.checkForUpdate();
      setInfo(result);
      setTotal(result.size ?? null);
      if (result.available) {
        setUpToDate(false);
        setPhase('available');
      } else {
        setUpToDate(!result.error);
        setPhase('idle');
      }
    } catch {
      setPhase('idle');
    }
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return undefined;
    void bridge
      .getVersion()
      .then((value) => setVersion(value))
      .catch(() => undefined);

    const firstCheck = offlineMode
      ? null
      : window.setTimeout(() => void runCheck(), FIRST_CHECK_DELAY_MS);
    const interval = offlineMode
      ? null
      : window.setInterval(() => void runCheck(), RECHECK_INTERVAL_MS);
    const unsubscribe = bridge.onProgress((event: UpdateProgressEvent) => {
      if (event.phase === 'downloading') {
        setPhase('downloading');
        setPercent(event.percent ?? 0);
        setReceived(event.received ?? 0);
        if (event.total) setTotal(event.total);
      } else if (event.phase === 'downloaded') {
        setPercent(100);
      } else if (event.phase === 'error') {
        setErrorText(event.message ?? 'Ошибка загрузки.');
        setPhase('error');
      } else if (event.phase === 'cancelled') {
        setPhase('available');
        setPercent(0);
      }
    });

    return () => {
      if (firstCheck !== null) window.clearTimeout(firstCheck);
      if (interval !== null) window.clearInterval(interval);
      unsubscribe();
    };
  }, [bridge, runCheck, offlineMode]);

  const handleUpdate = useCallback(async () => {
    if (!bridge || busy) return;
    setPercent(0);
    setReceived(0);
    setErrorText('');
    setPhase('downloading');
    const downloaded = await bridge.downloadUpdate();
    if (!downloaded.ok) {
      if (phaseRef.current !== 'available') {
        setErrorText(downloaded.error ?? 'Не удалось загрузить обновление.');
        setPhase('error');
      }
      return;
    }
    setPhase('installing');
    const installed = await bridge.installUpdate();
    if (!installed.ok) {
      setErrorText(installed.error ?? 'Не удалось запустить установщик.');
      setPhase('error');
    }
  }, [bridge, busy]);

  const handleCancel = useCallback(() => {
    void bridge?.cancelDownload();
  }, [bridge]);

  const versionLabel = version ? `v${version}` : '';

  return (
    <div className="flex shrink-0 items-center gap-2" data-testid="update-control">
      {versionLabel ? (
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={!bridge || phase === 'downloading' || phase === 'installing'}
          title={
            !bridge
              ? `Текущая версия ${versionLabel}`
              : upToDate
                ? 'Установлена последняя версия. Нажмите, чтобы проверить снова.'
                : 'Нажмите, чтобы проверить обновления'
          }
          className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[11px] text-[#94A3B8] transition-colors enabled:hover:text-[#E2E8F0] disabled:cursor-default"
        >
          {phase === 'checking' ? (
            <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : null}
          <span>{versionLabel}</span>
        </button>
      ) : null}

      {phase === 'available' && info?.available ? (
        <button
          type="button"
          onClick={() => void handleUpdate()}
          disabled={busy}
          title={busy ? 'Дождитесь окончания генерации — для установки приложение перезапустится.' : undefined}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#E58E26] bg-[#2A1D0B] px-3 py-1.5 text-xs font-semibold text-[#F5B461] transition-colors enabled:hover:bg-[#3A2810] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Обновить до v{info.latestVersion}</span>
        </button>
      ) : null}

      {phase === 'downloading' ? (
        <div className="flex items-center gap-2" data-testid="update-progress">
          <div
            role="progressbar"
            aria-label="Загрузка обновления"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 w-28 overflow-hidden rounded-full bg-[#222734] sm:w-40"
          >
            <div
              className="h-full rounded-full bg-[#E58E26] transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="w-9 text-right font-mono text-[11px] text-[#E2E8F0]">{percent}%</span>
          {total ? (
            <span className="hidden font-mono text-[10px] text-[#64748B] lg:inline">
              {formatMegabytes(received)} / {formatMegabytes(total)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleCancel}
            className="text-[11px] text-[#94A3B8] underline-offset-2 hover:text-[#E2E8F0] hover:underline"
          >
            Отмена
          </button>
        </div>
      ) : null}

      {phase === 'installing' ? (
        <span className="whitespace-nowrap text-xs text-[#F5B461]">Запуск установщика…</span>
      ) : null}

      {phase === 'error' ? (
        <button
          type="button"
          onClick={() => void (info?.available ? handleUpdate() : runCheck())}
          title={errorText}
          className="whitespace-nowrap rounded-md border border-[#7F1D1D] bg-[#2A1215] px-2.5 py-1 text-[11px] font-semibold text-[#FCA5A5] hover:bg-[#3A191D]"
        >
          Ошибка обновления · повторить
        </button>
      ) : null}
    </div>
  );
}
