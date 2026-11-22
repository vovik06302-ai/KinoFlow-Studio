import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, ShieldCheck, Square, Terminal } from 'lucide-react';
import { checkConnection } from '../services/comfyService';
import {
  describeLauncherExit,
  describeStartupStall,
  isStartupStalled,
} from '../services/launcherDiagnostics';
import type { ComfyInstanceId, GpuUsageSnapshot } from '../types/launcher';
import type { ComfyInstancesSettings, ConnectionStatus } from '../types/video';

interface ComfyLauncherPanelProps {
  comfyDir: string;
  instancesConfig: ComfyInstancesSettings;
  serverUrl: string;
  connectionStatus: ConnectionStatus;
  disabled?: boolean;
  onChangeInstancesConfig: (next: ComfyInstancesSettings) => void;
  onCheckConnection: () => void;
}

interface InstanceUiState {
  running: boolean;
  online: boolean;
  activePort: number;
  logs: string[];
  showLog: boolean;
  error: string;
  /** When the process was started (ms); used to warn if ComfyUI never answers. */
  startedAt: number | null;
  /** True after the user pressed «Остановить», so the exit is not reported as a crash. */
  stopRequested: boolean;
}

const INSTANCE_META: Array<{ id: ComfyInstanceId; title: string }> = [
  { id: '1', title: 'Экземпляр 1' },
  { id: '2', title: 'Экземпляр 2' },
];

const MAX_VISIBLE_LINES = 500;
const POLL_INTERVAL_MS = 3000;

function normalizeUrlNoSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Desktop-only: manages two independent ComfyUI instances (GPU 0/8188 and GPU 1/8189). */
export function ComfyLauncherPanel({
  comfyDir,
  instancesConfig,
  serverUrl,
  connectionStatus,
  disabled = false,
  onChangeInstancesConfig,
  onCheckConnection,
}: ComfyLauncherPanelProps) {
  const bridge = typeof window !== 'undefined' ? window.kinoflowLauncher : undefined;

  const [instances, setInstances] = useState<Record<ComfyInstanceId, InstanceUiState>>(() => ({
    '1': {
      running: false,
      online: false,
      activePort: instancesConfig['1'].port,
      logs: [],
      showLog: false,
      error: '',
      startedAt: null,
      stopRequested: false,
    },
    '2': {
      running: false,
      online: false,
      activePort: instancesConfig['2'].port,
      logs: [],
      showLog: false,
      error: '',
      startedAt: null,
      stopRequested: false,
    },
  }));

  const [drafts, setDrafts] = useState<
    Record<ComfyInstanceId, { gpuText: string; portText: string }>
  >(() => ({
    '1': {
      gpuText: String(instancesConfig['1'].gpuIndex),
      portText: String(instancesConfig['1'].port),
    },
    '2': {
      gpuText: String(instancesConfig['2'].gpuIndex),
      portText: String(instancesConfig['2'].port),
    },
  }));

  const [patchNotice, setPatchNotice] = useState('');
  const [patchError, setPatchError] = useState('');
  const [isPatching, setIsPatching] = useState(false);
  const [gpuSnapshot, setGpuSnapshot] = useState<GpuUsageSnapshot | null>(null);

  const logRefs = useRef<Record<ComfyInstanceId, HTMLPreElement | null>>({
    '1': null,
    '2': null,
  });
  const checkMainConnectionRef = useRef(onCheckConnection);
  checkMainConnectionRef.current = onCheckConnection;
  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;
  const instancesConfigRef = useRef(instancesConfig);
  instancesConfigRef.current = instancesConfig;
  const instancesRef = useRef(instances);
  instancesRef.current = instances;

  // Sync draft inputs if settings changed externally
  useEffect(() => {
    setDrafts((prev) => ({
      '1': {
        gpuText:
          Number(prev['1'].gpuText) === instancesConfig['1'].gpuIndex
            ? prev['1'].gpuText
            : String(instancesConfig['1'].gpuIndex),
        portText:
          Number(prev['1'].portText) === instancesConfig['1'].port
            ? prev['1'].portText
            : String(instancesConfig['1'].port),
      },
      '2': {
        gpuText:
          Number(prev['2'].gpuText) === instancesConfig['2'].gpuIndex
            ? prev['2'].gpuText
            : String(instancesConfig['2'].gpuIndex),
        portText:
          Number(prev['2'].portText) === instancesConfig['2'].port
            ? prev['2'].portText
            : String(instancesConfig['2'].port),
      },
    }));
  }, [instancesConfig]);

  // Initial state load + subscribe to multi-instance launcher events
  useEffect(() => {
    if (!bridge) return undefined;

    const loadInitialStates = async () => {
      try {
        if (bridge.getAllStates) {
          const all = await bridge.getAllStates();
          setInstances((prev) => {
            const next = { ...prev };
            for (const { id } of INSTANCE_META) {
              const st = all?.[id];
              if (!st) continue;
              next[id] = {
                ...prev[id],
                running: Boolean(st.running),
                startedAt: st.running ? Date.now() : null,
                activePort:
                  typeof st.port === 'number' ? st.port : instancesConfigRef.current[id].port,
                logs: Array.isArray(st.logs) ? st.logs.slice(-MAX_VISIBLE_LINES) : [],
              };
            }
            return next;
          });
        } else {
          const st1 = await bridge.getState('1');
          setInstances((prev) => ({
            ...prev,
            '1': {
              ...prev['1'],
              running: Boolean(st1.running),
              activePort:
                typeof st1.port === 'number' ? st1.port : instancesConfigRef.current['1'].port,
              logs: Array.isArray(st1.logs) ? st1.logs.slice(-MAX_VISIBLE_LINES) : [],
            },
          }));
        }
      } catch {
        // Ignore initial fetch errors
      }
    };

    void loadInitialStates();

    // Probe each configured port once on mount so already-running instances show "отвечает"
    for (const { id } of INSTANCE_META) {
      const port = instancesConfigRef.current[id].port;
      void checkConnection(`http://127.0.0.1:${port}`, 2500, { allowAutoProbe: false })
        .then((res) => {
          if (res.status === 'online' && !res.detectedUrl) {
            setInstances((prev) => ({
              ...prev,
              [id]: { ...prev[id], online: true },
            }));
          }
        })
        .catch(() => undefined);
    }

    return bridge.onEvent((event) => {
      const targetId: ComfyInstanceId = event.instanceId === '2' ? '2' : '1';
      if (event.type === 'log') {
        setInstances((prev) => ({
          ...prev,
          [targetId]: {
            ...prev[targetId],
            logs: [...prev[targetId].logs.slice(-(MAX_VISIBLE_LINES - 1)), event.line],
          },
        }));
      } else if (event.type === 'started') {
        setInstances((prev) => ({
          ...prev,
          [targetId]: {
            ...prev[targetId],
            running: true,
            online: false,
            error: '',
            startedAt: Date.now(),
            stopRequested: false,
            activePort:
              typeof event.port === 'number' ? event.port : instancesConfigRef.current[targetId].port,
          },
        }));
      } else if (event.type === 'exit') {
        setInstances((prev) => {
          const current = prev[targetId];
          const crashed = !current.stopRequested;
          return {
            ...prev,
            [targetId]: {
              ...current,
              running: false,
              online: false,
              startedAt: null,
              stopRequested: false,
              showLog: crashed ? true : current.showLog,
              error: crashed
                ? describeLauncherExit({
                    instanceId: targetId,
                    port: current.activePort,
                    code: event.code,
                    uptimeMs: event.uptimeMs ?? 0,
                    lastLines: event.lastLines ?? current.logs.slice(-12),
                  })
                : '',
            },
          };
        });
      }
    });
  }, [bridge]);

  // Subscribe to real-time per-GPU utilization snapshots from Electron main process
  useEffect(() => {
    if (!bridge) return undefined;
    let cancelled = false;

    if (bridge.getGpuUsage) {
      void bridge
        .getGpuUsage()
        .then((snapshot) => {
          if (!cancelled && snapshot) {
            setGpuSnapshot(snapshot);
          }
        })
        .catch(() => undefined);
    }

    const unsubscribe = bridge.onGpuUsage
      ? bridge.onGpuUsage((snapshot) => {
          if (!cancelled && snapshot) {
            setGpuSnapshot(snapshot);
          }
        })
      : undefined;

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [bridge]);

  // Reflect top-level connectionStatus changes onto matching instance port
  useEffect(() => {
    const normalizedMain = normalizeUrlNoSlash(serverUrl);
    for (const { id } of INSTANCE_META) {
      const port = instances[id].running ? instances[id].activePort : instancesConfig[id].port;
      if (normalizedMain === `http://127.0.0.1:${port}`) {
        if (connectionStatus === 'online') {
          setInstances((prev) =>
            prev[id].online ? prev : { ...prev, [id]: { ...prev[id], online: true } },
          );
        } else if (connectionStatus === 'offline') {
          setInstances((prev) =>
            !prev[id].online ? prev : { ...prev, [id]: { ...prev[id], online: false } },
          );
        }
      }
    }
  }, [connectionStatus, serverUrl, instances, instancesConfig]);

  // Poll http://127.0.0.1:<port> automatically after start until ComfyUI responds
  const isWaiting1 = instances['1'].running && !instances['1'].online;
  const activePort1 = instances['1'].activePort;
  const isWaiting2 = instances['2'].running && !instances['2'].online;
  const activePort2 = instances['2'].activePort;

  useEffect(() => {
    if (!isWaiting1) return undefined;
    let cancelled = false;
    const targetUrl = `http://127.0.0.1:${activePort1}`;

    const poll = async () => {
      const res = await checkConnection(targetUrl, 3000, { allowAutoProbe: false });
      if (cancelled) return;
      if (res.status === 'online' && !res.detectedUrl) {
        setInstances((prev) => ({
          ...prev,
          '1': { ...prev['1'], online: true },
        }));
        if (normalizeUrlNoSlash(serverUrlRef.current) === targetUrl) {
          checkMainConnectionRef.current();
        }
      }
    };

    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isWaiting1, activePort1]);

  useEffect(() => {
    if (!isWaiting2) return undefined;
    let cancelled = false;
    const targetUrl = `http://127.0.0.1:${activePort2}`;

    const poll = async () => {
      const res = await checkConnection(targetUrl, 3000, { allowAutoProbe: false });
      if (cancelled) return;
      if (res.status === 'online' && !res.detectedUrl) {
        setInstances((prev) => ({
          ...prev,
          '2': { ...prev['2'], online: true },
        }));
        if (normalizeUrlNoSlash(serverUrlRef.current) === targetUrl) {
          checkMainConnectionRef.current();
        }
      }
    };

    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isWaiting2, activePort2]);

  // Warn when a started instance stays silent for too long (alive process, no answer on its port).
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const { id } of INSTANCE_META) {
        const st = instancesRef.current[id];
        if (st.running && !st.online && !st.error && isStartupStalled(st.startedAt, now)) {
          const message = describeStartupStall(id, st.activePort, st.logs.slice(-12));
          setInstances((prev) =>
            prev[id].error ? prev : { ...prev, [id]: { ...prev[id], error: message, showLog: true } },
          );
        }
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  // Auto-scroll open log boxes to bottom
  useEffect(() => {
    for (const { id } of INSTANCE_META) {
      const el = logRefs.current[id];
      if (instances[id].showLog && el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [instances]);

  const handleGpuChange = useCallback(
    (id: ComfyInstanceId, rawValue: string) => {
      setDrafts((prev) => ({
        ...prev,
        [id]: { ...prev[id], gpuText: rawValue },
      }));
      const trimmed = rawValue.trim();
      if (!trimmed) return;
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 7) {
        onChangeInstancesConfig({
          ...instancesConfigRef.current,
          [id]: { ...instancesConfigRef.current[id], gpuIndex: parsed },
        });
      }
    },
    [onChangeInstancesConfig],
  );

  const handlePortChange = useCallback(
    (id: ComfyInstanceId, rawValue: string) => {
      setDrafts((prev) => ({
        ...prev,
        [id]: { ...prev[id], portText: rawValue },
      }));
      const trimmed = rawValue.trim();
      if (!trimmed) return;
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535) {
        onChangeInstancesConfig({
          ...instancesConfigRef.current,
          [id]: { ...instancesConfigRef.current[id], port: parsed },
        });
      }
    },
    [onChangeInstancesConfig],
  );

  const handleFieldBlur = useCallback((id: ComfyInstanceId) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        gpuText: String(instancesConfigRef.current[id].gpuIndex),
        portText: String(instancesConfigRef.current[id].port),
      },
    }));
  }, []);

  const handleStart = useCallback(
    async (id: ComfyInstanceId) => {
      if (!bridge) return;
      setPatchNotice('');
      setPatchError('');

      const gpuVal = Number(drafts[id].gpuText.trim());
      const portVal = Number(drafts[id].portText.trim());

      if (!Number.isInteger(gpuVal) || gpuVal < 0 || gpuVal > 7) {
        setInstances((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            error: 'Номер видеокарты должен быть целым числом от 0 до 7.',
          },
        }));
        return;
      }
      if (!Number.isInteger(portVal) || portVal < 1024 || portVal > 65535) {
        setInstances((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            error: 'Порт должен быть целым числом от 1024 до 65535.',
          },
        }));
        return;
      }

      onChangeInstancesConfig({
        ...instancesConfigRef.current,
        [id]: { gpuIndex: gpuVal, port: portVal },
      });

      setInstances((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          error: '',
          logs: [],
          online: false,
          stopRequested: false,
          activePort: portVal,
        },
      }));

      const result = await bridge.start({
        instanceId: id,
        comfyDir,
        gpuIndex: gpuVal,
        port: portVal,
      });

      if (!result.ok) {
        setInstances((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            error: result.error ?? `Не удалось запустить Экземпляр ${id} ComfyUI.`,
          },
        }));
        return;
      }

      setInstances((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          running: true,
          online: false,
          startedAt: prev[id].startedAt ?? Date.now(),
          activePort: portVal,
          showLog: true,
          error: '',
        },
      }));
    },
    [bridge, comfyDir, drafts, onChangeInstancesConfig],
  );

  const handleStop = useCallback(
    async (id: ComfyInstanceId) => {
      if (!bridge) return;
      setInstances((prev) => ({ ...prev, [id]: { ...prev[id], stopRequested: true } }));
      await bridge.stop(id);
    },
    [bridge],
  );

  const handleToggleLog = useCallback((id: ComfyInstanceId) => {
    setInstances((prev) => ({
      ...prev,
      [id]: { ...prev[id], showLog: !prev[id].showLog },
    }));
  }, []);

  const handleApplyFlushPatch = useCallback(async () => {
    if (!bridge?.installFlushFix) return;
    setPatchError('');
    setPatchNotice('');
    setIsPatching(true);
    try {
      const res = await bridge.installFlushFix(comfyDir);
      if (!res.ok) {
        setPatchError(res.error ?? 'Не удалось установить патч [Errno 22].');
      } else {
        setPatchNotice(
          'Патч custom_nodes/kinoflow_win_flush_fix установлен. Перезапустите экземпляры ComfyUI, чтобы он вступил в силу.',
        );
      }
    } finally {
      setIsPatching(false);
    }
  }, [bridge, comfyDir]);

  if (!bridge) return null;

  return (
    <section aria-label="Запуск ComfyUI" className="mt-4 border-t border-[#1E2330] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold tracking-tight text-[#F1F5F9]">Запуск ComfyUI</h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-[#64748B]" title={comfyDir}>
            {comfyDir}
          </p>
        </div>
        {bridge.installFlushFix && (
          <button
            type="button"
            disabled={disabled || isPatching}
            onClick={() => void handleApplyFlushPatch()}
            title="Устанавливает custom_nodes/kinoflow_win_flush_fix от ошибки Windows [Errno 22] Invalid argument в app/logger.py"
            className="inline-flex items-center gap-1 rounded-md border border-[#2B3242] bg-[#1A1F2B] px-2.5 py-1.5 text-xs text-[#CBD5E1] hover:bg-[#222838] disabled:opacity-50"
          >
            {isPatching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
            )}
            <span>Патч [Errno 22]</span>
          </button>
        )}
      </div>

      {patchNotice && (
        <p role="status" className="mt-2 text-[11px] text-[#9AE6B4]">
          {patchNotice}
        </p>
      )}
      {patchError && (
        <p role="alert" className="mt-2 text-[11px] text-[#FCA5A5]">
          {patchError}
        </p>
      )}

      <div className="mt-3 space-y-2.5">
        {INSTANCE_META.map(({ id, title }) => {
          const state = instances[id];
          const draft = drafts[id];
          const statusKey = state.online ? 'online' : state.running ? 'starting' : 'stopped';
          const statusLabel =
            statusKey === 'online'
              ? 'отвечает'
              : statusKey === 'starting'
                ? 'запускается'
                : 'остановлен';
          const statusColor =
            statusKey === 'online'
              ? 'text-[#4ADE80]'
              : statusKey === 'starting'
                ? 'text-[#F5B461]'
                : 'text-[#64748B]';
          const dotColor =
            statusKey === 'online'
              ? 'bg-[#22C55E]'
              : statusKey === 'starting'
                ? 'bg-[#E58E26]'
                : 'bg-[#475569]';

          return (
            <div
              key={id}
              data-testid={`comfy-instance-${id}`}
              className="rounded-md border border-[#222734] bg-[#121620] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#F1F5F9]">{title}</span>
                  <span
                    data-testid={`comfy-instance-status-${id}`}
                    className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${statusColor}`}
                  >
                    {statusKey === 'starting' ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    ) : (
                      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
                    )}
                    <span>{statusLabel}</span>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleStart(id)}
                    disabled={disabled || state.running}
                    className="inline-flex items-center gap-1 rounded-md border border-[#E58E26] bg-[#2A1D0B] px-2.5 py-1 text-xs font-semibold text-[#F5B461] hover:bg-[#3A2810] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Play className="h-3 w-3" aria-hidden="true" />
                    <span>Запустить</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStop(id)}
                    disabled={!state.running}
                    className="inline-flex items-center gap-1 rounded-md border border-[#7F1D1D] bg-[#2A1215] px-2.5 py-1 text-xs font-medium text-[#FCA5A5] hover:bg-[#3A191D] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Square className="h-3 w-3" aria-hidden="true" />
                    <span>Остановить</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleLog(id)}
                    aria-expanded={state.showLog}
                    className="inline-flex items-center gap-1 rounded-md border border-[#2B3242] bg-[#1A1F2B] px-2 py-1 text-xs text-[#E2E8F0] hover:bg-[#222838]"
                  >
                    <Terminal className="h-3 w-3" aria-hidden="true" />
                    <span>Журнал</span>
                  </button>
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor={`comfy-instance-gpu-${id}`}
                    className="mb-1 block text-[11px] text-[#94A3B8]"
                  >
                    Видеокарта
                  </label>
                  <input
                    id={`comfy-instance-gpu-${id}`}
                    type="number"
                    min={0}
                    max={7}
                    step={1}
                    value={draft.gpuText}
                    disabled={disabled || state.running}
                    onChange={(e) => handleGpuChange(id, e.target.value)}
                    onBlur={() => handleFieldBlur(id)}
                    className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1 font-mono text-xs tabular-nums text-[#F1F5F9] focus:border-[#E58E26] focus:outline-none disabled:opacity-55"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`comfy-instance-port-${id}`}
                    className="mb-1 block text-[11px] text-[#94A3B8]"
                  >
                    Порт
                  </label>
                  <input
                    id={`comfy-instance-port-${id}`}
                    type="number"
                    min={1024}
                    max={65535}
                    step={1}
                    value={draft.portText}
                    disabled={disabled || state.running}
                    onChange={(e) => handlePortChange(id, e.target.value)}
                    onBlur={() => handleFieldBlur(id)}
                    className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1 font-mono text-xs tabular-nums text-[#F1F5F9] focus:border-[#E58E26] focus:outline-none disabled:opacity-55"
                  />
                </div>
              </div>

              {(() => {
                const targetGpuIndex = instancesConfig[id].gpuIndex;
                const gpuEntry = gpuSnapshot?.available
                  ? gpuSnapshot.gpus.find((gpu) => gpu.index === targetGpuIndex)
                  : undefined;
                const gpuUsage =
                  typeof gpuEntry?.utilizationPercent === 'number'
                    ? gpuEntry.utilizationPercent
                    : null;
                const vramUsedMb =
                  typeof gpuEntry?.vramUsedMb === 'number' ? gpuEntry.vramUsedMb : null;
                const vramTotalMb =
                  typeof gpuEntry?.vramTotalMb === 'number' ? gpuEntry.vramTotalMb : null;
                const vramUsage =
                  typeof gpuEntry?.vramUsagePercent === 'number'
                    ? gpuEntry.vramUsagePercent
                    : null;

                const pickBarColor = (pct: number | null) =>
                  pct === null
                    ? 'bg-[#334155]'
                    : pct >= 90
                      ? 'bg-[#EF4444]'
                      : pct >= 70
                        ? 'bg-[#E58E26]'
                        : 'bg-[#22C55E]';

                const vramLabel =
                  vramUsedMb !== null && vramTotalMb !== null && vramUsage !== null
                    ? `${(vramUsedMb / 1024).toFixed(1)} / ${(vramTotalMb / 1024).toFixed(1)} ГБ (${vramUsage}%)`
                    : 'н/д';

                return (
                  <div
                    data-testid={`comfy-instance-gpu-usage-${id}`}
                    title={gpuEntry?.name ? `GPU ${targetGpuIndex}: ${gpuEntry.name}` : undefined}
                    className="mt-2.5 space-y-2 rounded border border-[#1C2230] bg-[#0F131C] px-2.5 py-2"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-[#94A3B8]">
                          Загрузка GPU {targetGpuIndex}
                          {gpuEntry?.name ? (
                            <span className="ml-1 text-[#64748B]">· {gpuEntry.name}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 font-mono font-medium tabular-nums text-[#E2E8F0]">
                          {gpuUsage !== null ? `${gpuUsage}%` : 'н/д'}
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`Загрузка GPU ${targetGpuIndex}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={gpuUsage ?? 0}
                        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#1C2230]"
                      >
                        <div
                          className={`h-full transition-[width] duration-300 ${pickBarColor(gpuUsage)}`}
                          style={{ width: `${gpuUsage ?? 0}%` }}
                        />
                      </div>
                    </div>

                    <div data-testid={`comfy-instance-vram-usage-${id}`}>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-[#94A3B8]">VRAM</span>
                        <span className="shrink-0 font-mono font-medium tabular-nums text-[#CBD5E1]">
                          {vramLabel}
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`Использование VRAM GPU ${targetGpuIndex}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={vramUsage ?? 0}
                        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#1C2230]"
                      >
                        <div
                          className={`h-full transition-[width] duration-300 ${pickBarColor(vramUsage)}`}
                          style={{ width: `${vramUsage ?? 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {state.error && (
                <p
                  role="alert"
                  className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#FCA5A5]"
                >
                  {state.error}
                </p>
              )}

              {state.showLog && (
                <pre
                  ref={(el) => {
                    logRefs.current[id] = el;
                  }}
                  data-testid={`comfy-log-${id}`}
                  className="mt-2 max-h-48 overflow-auto rounded-md border border-[#222734] bg-[#0B0D11] p-2 font-mono text-[10.5px] leading-relaxed text-[#A8B3C7]"
                >
                  {state.logs.length > 0 ? state.logs.join('\n') : 'Журнал пуст.'}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
