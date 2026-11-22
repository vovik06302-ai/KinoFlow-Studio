import { CheckCircle2, Clock, ListVideo, Loader2, Play, Square, Trash2, XCircle } from 'lucide-react';
import type { BatchQueueItem, QueueItemLiveProgress } from '../services/batchQueue';
import { describeQueueServer } from '../services/batchScheduler';

interface BatchQueuePanelProps {
  items: BatchQueueItem[];
  isRunningQueue: boolean;
  isGenerating: boolean;
  serverChoices: Array<{ url: string; label: string }>;
  selectedServers: string[];
  onToggleServer: (url: string) => void;
  itemProgress: Record<string, QueueItemLiveProgress>;
  onStartQueue: () => void;
  onStopQueue: () => void;
  onRemoveItem: (id: string) => void;
  onClearFinished: () => void;
}

export function BatchQueuePanel({
  items,
  isRunningQueue,
  isGenerating,
  serverChoices,
  selectedServers,
  onToggleServer,
  itemProgress,
  onStartQueue,
  onStopQueue,
  onRemoveItem,
  onClearFinished,
}: BatchQueuePanelProps) {
  const pendingCount = items.filter((item) => item.status === 'pending').length;
  const finishedCount = items.filter(
    (item) => item.status === 'completed' || item.status === 'failed',
  ).length;

  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="batch-queue-heading"
      data-testid="batch-queue-section"
      className="border-b border-[#222734] pb-6"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListVideo className="h-4 w-4 text-[#F6AD55]" aria-hidden="true" />
          <h2
            id="batch-queue-heading"
            className="text-sm font-semibold tracking-tight text-[#F1F5F9]"
          >
            Очередь генерации (Batch)
          </h2>
          <span className="font-mono text-xs tabular-nums text-[#64748B]">
            {pendingCount} в ожидании · всего {items.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {finishedCount > 0 && !isRunningQueue && (
            <button
              type="button"
              onClick={onClearFinished}
              className="text-xs font-medium text-[#64748B] transition-colors hover:text-[#CBD5E1] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
            >
              Очистить завершённые
            </button>
          )}
          {isRunningQueue ? (
            <button
              type="button"
              onClick={onStopQueue}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#7F1D1D] bg-[#2A1215] px-3 py-1.5 text-xs font-medium text-[#FCA5A5] transition-colors hover:bg-[#3A191D]"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              <span>Остановить очередь</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={pendingCount === 0 || isGenerating}
              onClick={onStartQueue}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#E58E26]/60 bg-[#E58E26]/15 px-3 py-1.5 text-xs font-semibold text-[#F6AD55] transition-colors hover:bg-[#E58E26]/25 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              <span>Запустить очередь ({pendingCount})</span>
            </button>
          )}
        </div>
      </div>

      <fieldset
        disabled={isRunningQueue}
        className="mb-3 rounded-lg border border-[#222734] bg-[#10141C] px-4 py-3"
        data-testid="queue-servers"
      >
        <legend className="px-1 text-[11px] font-medium text-[#94A3B8]">
          Где выполнять сцены
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {serverChoices.map((choice) => (
            <label
              key={choice.url}
              className="flex cursor-pointer items-center gap-2 text-xs text-[#E2E8F0] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
            >
              <input
                type="checkbox"
                checked={selectedServers.includes(choice.url)}
                onChange={() => onToggleServer(choice.url)}
                className="h-4 w-4 cursor-pointer rounded border-[#3A4358] bg-[#0D1017] accent-[#E58E26]"
              />
              <span>{choice.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[#64748B]">
          {selectedServers.length > 1
            ? 'Разные сцены пойдут параллельно на каждом отвечающем сервере. Сегменты одной сцены идут по очереди.'
            : 'Отметьте оба сервера, чтобы две сцены считались одновременно на двух видеокартах.'}
        </p>
      </fieldset>

      <ul className="divide-y divide-[#1E2330] rounded-lg border border-[#222734] bg-[#10141C]">
        {items.map((item, idx) => (
          <li
            key={item.id}
            className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <span className="mt-0.5 shrink-0" aria-hidden="true">
                {item.status === 'running' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#F6AD55]" />
                ) : item.status === 'completed' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E]" />
                ) : item.status === 'failed' ? (
                  <XCircle className="h-3.5 w-3.5 text-[#EF4444]" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-[#64748B]" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[#E2E8F0]">
                  #{idx + 1}. {item.prompt}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] tabular-nums text-[#64748B]">
                  <span>{item.settings.mode === 'i2v' ? 'I2V' : 'T2V'}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {item.settings.width}×{item.settings.height}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{item.settings.durationSec}с</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.settings.steps} шагов</span>
                  {item.settings.fastLightX2V && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#F6AD55]">LightX2V</span>
                    </>
                  )}
                </div>
                {item.status === 'running' && itemProgress[item.id] && (
                  <div className="mt-1.5" data-testid="queue-item-progress">
                    <div className="flex items-center gap-2">
                      <div
                        role="progressbar"
                        aria-label={`Ход сцены #${idx + 1}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(itemProgress[item.id].percent)}
                        className="h-1.5 w-28 overflow-hidden rounded-full bg-[#222734] sm:w-40"
                      >
                        <div
                          className="h-full rounded-full bg-[#E58E26] transition-[width] duration-200"
                          style={{ width: `${Math.min(100, Math.max(0, itemProgress[item.id].percent))}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] tabular-nums text-[#E2E8F0]">
                        {Math.round(itemProgress[item.id].percent)}%
                      </span>
                      <span className="rounded border border-[#2B3242] px-1.5 py-0.5 font-mono text-[10px] text-[#94A3B8]">
                        {describeQueueServer(itemProgress[item.id].serverUrl)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-[#64748B]">
                      {itemProgress[item.id].text}
                    </p>
                  </div>
                )}
                {item.error && (
                  <p className="mt-1 text-[11px] text-[#FCA5A5]">{item.error}</p>
                )}
              </div>
            </div>

            {item.status !== 'running' && (
              <button
                type="button"
                onClick={() => onRemoveItem(item.id)}
                aria-label={`Удалить задачу #${idx + 1} из очереди`}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#64748B] transition-colors hover:bg-[#2A1519] hover:text-[#F87171]"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
