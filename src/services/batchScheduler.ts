/**
 * Worker pool for the generation queue: one worker per ComfyUI server (for example port 8188
 * on GPU 0 and port 8189 on GPU 1). Every worker takes the next pending job, so independent
 * scenes render on several graphics cards at the same time, while the segments of one scene
 * stay sequential (the last frame of a segment is the first frame of the next one).
 */

export class WorkerUnavailableError extends Error {
  constructor(message = 'Сервер ComfyUI недоступен для этой задачи.') {
    super(message);
    this.name = 'WorkerUnavailableError';
  }
}

export interface PoolJob {
  id: string;
}

export interface WorkerPoolOptions<TJob extends PoolJob, TWorker> {
  workers: TWorker[];
  /** Next job that is still pending and not in `claimed`, or null. Must not mutate anything. */
  pickNext: (claimed: ReadonlySet<string>) => TJob | null;
  /** Runs one job on one worker. Throw WorkerUnavailableError to hand the job to another worker. */
  runJob: (job: TJob, worker: TWorker) => Promise<void>;
  shouldStop: () => boolean;
  onJobStarted?: (job: TJob, worker: TWorker) => void;
  /** The job goes back to the queue because its worker cannot work (server down, missing nodes). */
  onJobReleased?: (job: TJob, worker: TWorker, error: WorkerUnavailableError) => void;
  onWorkerRetired?: (worker: TWorker, error: WorkerUnavailableError) => void;
}

export interface WorkerPoolResult {
  startedJobIds: string[];
  retiredWorkers: number;
}

export async function runWorkerPool<TJob extends PoolJob, TWorker>(
  options: WorkerPoolOptions<TJob, TWorker>,
): Promise<WorkerPoolResult> {
  const claimed = new Set<string>();
  const startedJobIds: string[] = [];
  let running = 0;
  let retiredWorkers = 0;
  const waiters: Array<() => void> = [];

  const wake = () => {
    while (waiters.length > 0) waiters.shift()?.();
  };

  const loop = async (worker: TWorker): Promise<void> => {
    while (!options.shouldStop()) {
      const job = options.pickNext(claimed);
      if (!job) {
        // Nothing to take now; another worker may still hand a job back, so wait for it.
        if (running === 0) break;
        await new Promise<void>((resolve) => waiters.push(resolve));
        continue;
      }

      claimed.add(job.id);
      startedJobIds.push(job.id);
      running += 1;
      options.onJobStarted?.(job, worker);
      try {
        await options.runJob(job, worker);
      } catch (error) {
        if (error instanceof WorkerUnavailableError) {
          claimed.delete(job.id);
          running -= 1;
          retiredWorkers += 1;
          options.onJobReleased?.(job, worker, error);
          options.onWorkerRetired?.(worker, error);
          wake();
          return;
        }
        // Any other error is the job's own failure: runJob already recorded it.
      }
      running -= 1;
      wake();
    }
    wake();
  };

  await Promise.all(options.workers.map((worker) => loop(worker)));
  return { startedJobIds, retiredWorkers };
}

/**
 * Keeps only the servers that answered, in the order the user selected them, without duplicates.
 * With an empty selection the current server is used (the old one-at-a-time behaviour).
 */
export function chooseQueueServers(
  selected: string[],
  currentServerUrl: string,
  isOnline: (url: string) => boolean,
): string[] {
  const normalize = (url: string) => url.trim().replace(/\/+$/, '');
  const wanted = selected.length > 0 ? selected : [currentServerUrl];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of wanted) {
    const url = normalize(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (isOnline(url)) result.push(url);
  }
  return result;
}

export interface QueueWorkerProgress {
  percent: number;
  message: string;
}

/**
 * Summary of several workers for the single progress bar: average percent and one short line
 * per server. The result for one worker is that worker's own text.
 */
export function aggregateWorkerProgress(
  workers: Array<{ label: string; progress: QueueWorkerProgress }>,
): QueueWorkerProgress {
  if (workers.length === 0) return { percent: 0, message: '' };
  if (workers.length === 1) return workers[0].progress;
  const percent = Math.round(
    workers.reduce((sum, worker) => sum + worker.progress.percent, 0) / workers.length,
  );
  const message = workers
    .map((worker) => `${worker.label}: ${Math.round(worker.progress.percent)}%`)
    .join(' · ');
  return { percent, message: `Параллельно на ${workers.length} видеокартах — ${message}` };
}

/** Short label for a server in the UI: the port (and host when it is not local). */
export function describeQueueServer(url: string): string {
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    return local ? `порт ${parsed.port || '80'}` : `${parsed.hostname}:${parsed.port || '80'}`;
  } catch {
    return url;
  }
}
