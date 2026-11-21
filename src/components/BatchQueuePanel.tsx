import { CheckCircle2, Clock, ListVideo, Loader2, Play, Square, Trash2, XCircle } from 'lucide-react';
import type { BatchQueueItem } from '../services/batchQueue';

interface BatchQueuePanelProps {
  items: BatchQueueItem[];
  isRunningQueue: boolean;
  isGenerating: boolean;
  onStartQueue: () => void;
  onStopQueue: () => void;
  onRemoveItem: (id: string) => void;
  onClearFinished: () => void;
}

export function BatchQueuePanel({
  items,
  isRunningQueue,
  isGenerating,
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
