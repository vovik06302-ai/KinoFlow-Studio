import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { REQUIRED_MODELS, evaluateModelFileStatus } from './modelCatalog.js';

const MAX_REDIRECTS = 10;

export function resolveModelPaths(comfyDir, model) {
  const normalizedRoot = path.resolve(comfyDir.trim());
  const subfolderParts = model.targetSubfolder.split('/').filter(Boolean);
  const targetDir = path.join(normalizedRoot, ...subfolderParts);
  const finalPath = path.join(targetDir, model.filename);
  const partPath = `${finalPath}.part`;
  return { normalizedRoot, targetDir, finalPath, partPath };
}

async function safeFileSize(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return null;
    return stat.size;
  } catch {
    return null;
  }
}

export async function scanModelsDirectory(comfyDir, catalog = REQUIRED_MODELS) {
  const trimmed = typeof comfyDir === 'string' ? comfyDir.trim() : '';
  if (!trimmed) {
    return {
      comfyDir: '',
      directoryExists: false,
      models: catalog.map((model) => ({
        ...model,
        status: 'missing',
        existingSizeBytes: null,
        partialSizeBytes: 0,
        targetPath: path.join(model.targetSubfolder, model.filename),
      })),
    };
  }

  const normalizedRoot = path.resolve(trimmed);
  let directoryExists = false;
  try {
    const stat = await fsp.stat(normalizedRoot);
    directoryExists = stat.isDirectory();
  } catch {
    directoryExists = false;
  }

  const models = await Promise.all(
    catalog.map(async (model) => {
      const { finalPath, partPath } = resolveModelPaths(normalizedRoot, model);
      const existingSizeBytes = await safeFileSize(finalPath);
      const partialSizeBytes = (await safeFileSize(partPath)) ?? 0;
      const status = evaluateModelFileStatus(
        model.expectedSizeBytes,
        existingSizeBytes,
        partialSizeBytes,
      );

      return {
        ...model,
        status,
        existingSizeBytes,
        partialSizeBytes,
        targetPath: finalPath,
      };
    }),
  );

  return {
    comfyDir: normalizedRoot,
    directoryExists,
    models,
  };
}

/**
 * Opens an HTTP/HTTPS GET stream with redirect handling and optional HTTP Range resume.
 */
function openResumableHttpStream(urlString, startByte, signal, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Загрузка отменена пользователем.'));
      return;
    }

    if (redirectDepth > MAX_REDIRECTS) {
      reject(new Error('Слишком много HTTP-перенаправлений при обращении к Hugging Face.'));
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(new Error(`Некорректный URL загрузки: ${urlString}`));
      return;
    }

    const client = parsedUrl.protocol === 'http:' ? http : https;
    const headers = {
      'User-Agent': 'KinoFlowStudio-ModelManager/1.0',
      Accept: '*/*',
    };
    if (startByte > 0) {
      headers.Range = `bytes=${startByte}-`;
    }

    const req = client.get(
      parsedUrl,
      {
        headers,
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;

        if (
          (statusCode === 301 ||
            statusCode === 302 ||
            statusCode === 303 ||
            statusCode === 307 ||
            statusCode === 308) &&
          res.headers.location
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, parsedUrl).toString();
          openResumableHttpStream(nextUrl, startByte, signal, redirectDepth + 1).then(
            resolve,
            reject,
          );
          return;
        }

        resolve({ req, res, statusCode });
      },
    );

    const onAbort = () => {
      req.destroy(new Error('Загрузка отменена пользователем.'));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    req.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    req.on('close', () => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

export class ModelDownloadManager {
  constructor(catalog = REQUIRED_MODELS) {
    this.catalog = catalog;
    this.listeners = new Set();
    this.activeAbortController = null;
    this.isRunning = false;
    this.currentModelId = null;
    this.activeProgressById = new Map();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event) {
    if (event && event.modelId) {
      if (event.state === 'downloading' || event.state === 'queued') {
        this.activeProgressById.set(event.modelId, event);
      } else {
        this.activeProgressById.delete(event.modelId);
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  getSnapshot() {
    return {
      isRunning: this.isRunning,
      currentModelId: this.currentModelId,
      active: Array.from(this.activeProgressById.values()),
    };
  }

  cancel(modelId) {
    if (!this.activeAbortController) {
      return { cancelled: false };
    }
    if (modelId && this.currentModelId && modelId !== this.currentModelId) {
      return { cancelled: false };
    }
    this.activeAbortController.abort();
    return { cancelled: true };
  }

  async startQueue(comfyDir, modelIds) {
    const trimmedDir = typeof comfyDir === 'string' ? comfyDir.trim() : '';
    if (!trimmedDir) {
      throw new Error('Укажите путь к папке ComfyUI перед началом загрузки.');
    }

    if (this.isRunning) {
      throw new Error('Загрузка моделей уже выполняется. Дождитесь завершения или отмените её.');
    }

    const requestedSet =
      Array.isArray(modelIds) && modelIds.length > 0 ? new Set(modelIds) : null;
    const scan = await scanModelsDirectory(trimmedDir, this.catalog);

    const queue = scan.models.filter((item) => {
      if (requestedSet && !requestedSet.has(item.id)) return false;
      return item.status !== 'installed';
    });

    if (queue.length === 0) {
      return { started: false, queue: [] };
    }

    this.isRunning = true;
    const controller = new AbortController();
    this.activeAbortController = controller;

    for (const model of queue) {
      this.emit({
        type: 'model-progress',
        modelId: model.id,
        state: 'queued',
        percent:
          model.partialSizeBytes > 0 && model.expectedSizeBytes > 0
            ? Math.min(99, (model.partialSizeBytes / model.expectedSizeBytes) * 100)
            : 0,
        downloadedBytes: model.partialSizeBytes,
        totalBytes: model.expectedSizeBytes,
        speedBytesPerSec: 0,
        etaSec: null,
        resumedFromBytes: model.partialSizeBytes,
      });
    }

    void this.#runQueueLoop(trimmedDir, queue, controller.signal);

    return {
      started: true,
      queue: queue.map((m) => m.id),
    };
  }

  async #runQueueLoop(comfyDir, queue, signal) {
    try {
      for (const model of queue) {
        if (signal.aborted) {
          this.emit({
            type: 'model-progress',
            modelId: model.id,
            state: 'cancelled',
            percent: 0,
            downloadedBytes: 0,
            totalBytes: model.expectedSizeBytes,
            speedBytesPerSec: 0,
            etaSec: null,
            message: 'Загрузка приостановлена (можно докачать позже)',
          });
          continue;
        }

        this.currentModelId = model.id;
        try {
          await this.downloadSingleModel(comfyDir, model, signal);
        } catch (err) {
          const isCancelled = signal.aborted;
          const message =
            err instanceof Error ? err.message : 'Ошибка загрузки файла модели.';
          const { partPath } = resolveModelPaths(comfyDir, model);
          const partialBytes = (await safeFileSize(partPath)) ?? 0;
          this.emit({
            type: 'model-progress',
            modelId: model.id,
            state: isCancelled ? 'cancelled' : 'error',
            percent:
              model.expectedSizeBytes > 0
                ? Math.min(99, (partialBytes / model.expectedSizeBytes) * 100)
                : 0,
            downloadedBytes: partialBytes,
            totalBytes: model.expectedSizeBytes,
            speedBytesPerSec: 0,
            etaSec: null,
            error: isCancelled ? undefined : message,
            message: isCancelled
              ? 'Загрузка остановлена · прогресс сохранён для докачки'
              : message,
          });
          if (isCancelled) {
            break;
          }
        }
      }
    } finally {
      this.currentModelId = null;
      this.activeAbortController = null;
      this.isRunning = false;
      this.activeProgressById.clear();
      this.emit({ type: 'queue-finished' });
    }
  }

  async downloadSingleModel(comfyDir, model, signal) {
    const { targetDir, finalPath, partPath } = resolveModelPaths(comfyDir, model);
    await fsp.mkdir(targetDir, { recursive: true });

    // Already installed and passes size check?
    const existingSize = await safeFileSize(finalPath);
    const existingStatus = evaluateModelFileStatus(model.expectedSizeBytes, existingSize, 0);
    if (existingStatus === 'installed' && existingSize !== null) {
      this.emit({
        type: 'model-progress',
        modelId: model.id,
        state: 'installed',
        percent: 100,
        downloadedBytes: existingSize,
        totalBytes: existingSize,
        speedBytesPerSec: 0,
        etaSec: 0,
      });
      return;
    }

    // If a corrupted/truncated final file exists, remove it so the fresh download replaces it cleanly
    if (existingStatus === 'size_mismatch' && existingSize !== null) {
      await fsp.unlink(finalPath).catch(() => {});
    }

    let startByte = (await safeFileSize(partPath)) ?? 0;
    if (startByte > model.expectedSizeBytes) {
      await fsp.unlink(partPath).catch(() => {});
      startByte = 0;
    }

    // If the .part file already reached exact expected size from a previous interrupted rename, promote it
    if (startByte > 0 && startByte === model.expectedSizeBytes) {
      await fsp.rename(partPath, finalPath);
      this.emit({
        type: 'model-progress',
        modelId: model.id,
        state: 'installed',
        percent: 100,
        downloadedBytes: startByte,
        totalBytes: startByte,
        speedBytesPerSec: 0,
        etaSec: 0,
      });
      return;
    }

    let connection = await openResumableHttpStream(model.downloadUrl, startByte, signal);

    // Handle 416 Range Not Satisfiable by restarting from byte 0
    if (connection.statusCode === 416 && startByte > 0) {
      connection.res.resume();
      await fsp.unlink(partPath).catch(() => {});
      startByte = 0;
      connection = await openResumableHttpStream(model.downloadUrl, 0, signal);
    }

    const { res, statusCode } = connection;

    if (statusCode !== 200 && statusCode !== 206) {
      res.resume();
      throw new Error(`Сервер вернул HTTP ${statusCode} при скачивании ${model.filename}.`);
    }

    const isResumed = statusCode === 206 && startByte > 0;
    const effectiveOffset = isResumed ? startByte : 0;
    const contentLengthHeader = Number(res.headers['content-length'] ?? 0);
    const totalBytes =
      contentLengthHeader > 0
        ? effectiveOffset + contentLengthHeader
        : model.expectedSizeBytes;

    const writeStream = fs.createWriteStream(partPath, {
      flags: isResumed ? 'a' : 'w',
    });

    let downloadedBytes = effectiveOffset;
    let windowStartMs = Date.now();
    let windowBytes = 0;
    let smoothedSpeed = 0;
    let lastEmitMs = 0;

    const emitProgress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmitMs < 180) return;

      const elapsedSec = Math.max(0.05, (now - windowStartMs) / 1000);
      if (elapsedSec >= 0.4 || force) {
        const instantSpeed = windowBytes / elapsedSec;
        smoothedSpeed =
          smoothedSpeed > 0 ? smoothedSpeed * 0.65 + instantSpeed * 0.35 : instantSpeed;
        windowStartMs = now;
        windowBytes = 0;
      }

      const remainingBytes = Math.max(0, totalBytes - downloadedBytes);
      const etaSec = smoothedSpeed > 0 ? remainingBytes / smoothedSpeed : null;
      const percent = totalBytes > 0 ? Math.min(99.9, (downloadedBytes / totalBytes) * 100) : 0;

      lastEmitMs = now;
      this.emit({
        type: 'model-progress',
        modelId: model.id,
        state: 'downloading',
        percent: Number(percent.toFixed(1)),
        downloadedBytes,
        totalBytes,
        speedBytesPerSec: Math.round(smoothedSpeed),
        etaSec: etaSec !== null ? Math.round(etaSec) : null,
        resumedFromBytes: effectiveOffset,
      });
    };

    emitProgress(true);

    await new Promise((resolve, reject) => {
      let settled = false;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        res.destroy();
        writeStream.destroy();
        reject(err);
      };

      const onAbort = () => {
        fail(new Error('Загрузка отменена пользователем.'));
      };

      signal.addEventListener('abort', onAbort, { once: true });

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        windowBytes += chunk.length;
        emitProgress(false);
      });

      res.on('error', fail);
      writeStream.on('error', fail);

      writeStream.on('finish', () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve();
      });

      res.pipe(writeStream);
    });

    const finalPartSize = (await safeFileSize(partPath)) ?? 0;
    if (totalBytes > 0 && finalPartSize < totalBytes) {
      throw new Error(
        `Соединение прервано на ${finalPartSize} из ${totalBytes} байт. Нажмите «Докачать», чтобы продолжить с места обрыва.`,
      );
    }

    await fsp.rename(partPath, finalPath);

    this.emit({
      type: 'model-progress',
      modelId: model.id,
      state: 'installed',
      percent: 100,
      downloadedBytes: finalPartSize,
      totalBytes: finalPartSize,
      speedBytesPerSec: 0,
      etaSec: 0,
    });
  }
}
