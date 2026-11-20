import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square, Terminal } from 'lucide-react';
import type { ConnectionStatus } from '../types/video';

interface ComfyLauncherPanelProps {
  comfyDir: string;
  connectionStatus: ConnectionStatus;
  disabled?: boolean;
  onCheckConnection: () => void;
}

const MAX_VISIBLE_LINES = 300;
const POLL_INTERVAL_MS = 3000;

/** Desktop-only: starts ComfyUI from its folder and shows the console output. */
export function ComfyLauncherPanel({
  comfyDir,
  connectionStatus,
  disabled = false,
  onCheckConnection,
}: ComfyLauncherPanelProps) {
  const bridge = typeof window !== 'undefined' ? window.kinoflowLauncher : undefined;
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLPreElement | null>(null);
  const checkRef = useRef(onCheckConnection);
  checkRef.current = onCheckConnection;

  useEffect(() => {
    if (!bridge) return undefined;
    void bridge
      .getState()
      .then((state) => {
        setRunning(state.running);
        setLogs(state.logs.slice(-MAX_VISIBLE_LINES));
      })
      .catch(() => undefined);

    return bridge.onEvent((event) => {
      if (event.type === 'log') {
        setLogs((prev) => [...prev.slice(-(MAX_VISIBLE_LINES - 1)), event.line]);
      } else if (event.type === 'started') {
        setRunning(true);
      } else if (event.type === 'exit') {
        setRunning(false);
      }
    });
  }, [bridge]);

  // After the start, poll the connection until ComfyUI answers.
  useEffect(() => {
    if (!running || connectionStatus === 'online') return undefined;
    const timer = window.setInterval(() => checkRef.current(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, connectionStatus]);

  useEffect(() => {
    if (showLog && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, showLog]);

  const handleStart = useCallback(async () => {
    if (!bridge) return;
    setError('');
    setLogs([]);
    const result = await bridge.start(comfyDir);
    if (!result.ok) {
      setError(result.error ?? 'Не удалось запустить ComfyUI.');
      return;
    }
    setRunning(true);
    setShowLog(true);
  }, [bridge, comfyDir]);

  const handleStop = useCallback(async () => {
    await bridge?.stop();
  }, [bridge]);

  if (!bridge) return null;

  const waiting = running && connectionStatus !== 'online';

  return (
    <section aria-label="Запуск ComfyUI" className="mt-4 border-t border-[#1E2330] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold tracking-tight text-[#F1F5F9]">Запуск ComfyUI</h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-[#64748B]" title={comfyDir}>
            {comfyDir}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <button
              type="button"
              onClick={() => void handleStop()}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#7F1D1D] bg-[#2A1215] px-3 py-1.5 text-xs font-medium text-[#FCA5A5] hover:bg-[#3A191D]"
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Остановить</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={disabled || connectionStatus === 'online'}
              title={
                connectionStatus === 'online'
                  ? 'ComfyUI уже отвечает по указанному адресу'
                  : 'Запустит run_nvidia_gpu.bat из папки ComfyUI'
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E58E26] bg-[#2A1D0B] px-3 py-1.5 text-xs font-semibold text-[#F5B461] hover:bg-[#3A2810] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Запустить ComfyUI</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowLog((prev) => !prev)}
            aria-expanded={showLog}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2B3242] bg-[#1A1F2B] px-2.5 py-1.5 text-xs text-[#E2E8F0] hover:bg-[#222838]"
          >
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Журнал</span>
          </button>
        </div>
      </div>

      {waiting && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#F5B461]">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ComfyUI запускается, это занимает до минуты. Подключение проверяется само.
        </p>
      )}
      {running && connectionStatus === 'online' && (
        <p className="mt-2 text-[11px] text-[#9AE6B4]">ComfyUI запущен и отвечает.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[11px] text-[#FCA5A5]">
          {error} Укажите папку ComfyUI на вкладке «Модели и установка».
        </p>
      )}

      {showLog && (
        <pre
          ref={logRef}
          data-testid="comfy-log"
          className="mt-2 max-h-52 overflow-auto rounded-md border border-[#222734] bg-[#0B0D11] p-2.5 font-mono text-[10.5px] leading-relaxed text-[#A8B3C7]"
        >
          {logs.length > 0 ? logs.join('\n') : 'Журнал пуст.'}
        </pre>
      )}
    </section>
  );
}
