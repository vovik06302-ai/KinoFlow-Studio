/**
 * Browser-side HTML5 <video> + <canvas> utilities for extracting the last frame
 * of a generated clip (for chained I2V generation & Extend Scene) and merging
 * multi-segment clips into a single downloadable video file.
 */

export interface ExtractedFrameResult {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

function loadVideoElement(videoUrl: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    if (!videoUrl.startsWith('blob:') && !videoUrl.startsWith('data:')) {
      video.crossOrigin = 'anonymous';
    }

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };

    const onLoaded = () => {
      cleanup();
      resolve(video);
    };

    const onError = () => {
      cleanup();
      reject(
        new Error(
          'Не удалось загрузить видео для извлечения последнего кадра. Проверьте CORS-заголовки ComfyUI (--enable-cors-header "*").',
        ),
      );
    };

    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.src = videoUrl;
    video.load();
  });
}

function seekVideoTo(video: HTMLVideoElement, targetTime: number, timeoutMs: number = 2500): Promise<void> {
  return new Promise((resolve, reject) => {
    const clamped = Math.max(0, targetTime);

    if (video.readyState >= 2 && Math.abs(video.currentTime - clamped) < 0.015) {
      resolve();
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onSeeked = () => finish(resolve);
    const onError = () =>
      finish(() => reject(new Error('Не удалось перемотать видео к последнему кадру.')));

    const timer = window.setTimeout(() => {
      finish(resolve);
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });

    try {
      video.currentTime = clamped;
    } catch (err) {
      finish(() =>
        reject(err instanceof Error ? err : new Error('Ошибка позиционирования видео.')),
      );
    }
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(
            new Error(
              'Не удалось сформировать PNG-кадр из canvas (возможно, источник видео не отдаёт CORS-заголовки).',
            ),
          );
          return;
        }
        resolve(blob);
      }, 'image/png');
    } catch {
      reject(
        new Error(
          'Canvas заблокирован политикой CORS. Запустите ComfyUI с --enable-cors-header "*".',
        ),
      );
    }
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

interface ElectronVideoBridge {
  request?: (options: {
    url: string;
    method?: string;
    timeoutMs?: number;
    responseType?: 'text' | 'base64';
  }) => Promise<{ ok: boolean; bodyBase64?: string; contentType?: string }>;
}

/**
 * Extracts the final frame of a video (either from an already-loaded HTMLVideoElement
 * or from a URL) via HTML5 <canvas> and returns a PNG File + Object URL preview.
 */
export async function extractLastFrameFromVideo(
  source: HTMLVideoElement | string,
  filename: string = 'last_frame.png',
): Promise<ExtractedFrameResult> {
  let video: HTMLVideoElement;
  let ownsVideo = false;
  let blobUrlToRevoke: string | null = null;

  if (typeof source === 'string') {
    let resolvedUrl = source;
    if (!source.startsWith('blob:') && !source.startsWith('data:')) {
      const electronBridge =
        typeof window !== 'undefined'
          ? (window as unknown as { kinoflowComfy?: ElectronVideoBridge }).kinoflowComfy
          : undefined;
      if (electronBridge && typeof electronBridge.request === 'function') {
        try {
          const res = await electronBridge.request({
            url: source,
            method: 'GET',
            timeoutMs: 30000,
            responseType: 'base64',
          });
          if (res.ok && res.bodyBase64) {
            const blob = base64ToBlob(res.bodyBase64, res.contentType || 'video/mp4');
            resolvedUrl = URL.createObjectURL(blob);
            blobUrlToRevoke = resolvedUrl;
          }
        } catch {
          // Fall back to direct fetch / <video> loading
        }
      }

      if (!blobUrlToRevoke) {
        try {
          const resp = await fetch(source, { mode: 'cors' });
          if (resp.ok) {
            const blob = await resp.blob();
            resolvedUrl = URL.createObjectURL(blob);
            blobUrlToRevoke = resolvedUrl;
          }
        } catch {
          // Fall back to direct <video crossOrigin="anonymous"> loading
        }
      }
    }
    video = await loadVideoElement(resolvedUrl);
    ownsVideo = true;
  } else {
    video = source;
    if (video.readyState < 2) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => resolve(), 2500);
        const done = () => {
          window.clearTimeout(timer);
          resolve();
        };
        video.addEventListener('loadeddata', done, { once: true });
        video.addEventListener(
          'error',
          () => {
            window.clearTimeout(timer);
            reject(new Error('Видеоплеер не загрузил метаданные клипа.'));
          },
          { once: true },
        );
      });
    }
  }

  try {
    // Handle MediaRecorder/WebM files whose initial duration is Infinity by seeking to end
    if (!Number.isFinite(video.duration) || video.duration === 0) {
      await seekVideoTo(video, 1e6, 2000);
    }

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const seekTarget = Math.max(0, duration > 0.08 ? duration - 0.04 : duration);
    await seekVideoTo(video, seekTarget, 2000);

    // Wait one animation frame so decoded frame is painted before drawImage
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const width = video.videoWidth || 832;
    const height = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Браузер не смог инициализировать 2D-контекст <canvas>.');
    }

    ctx.drawImage(video, 0, 0, width, height);
    const pngBlob = await canvasToPngBlob(canvas);
    const file = new File([pngBlob], filename, { type: 'image/png' });
    const previewUrl = URL.createObjectURL(file);

    return { file, previewUrl, width, height };
  } finally {
    if (ownsVideo) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    if (blobUrlToRevoke) {
      URL.revokeObjectURL(blobUrlToRevoke);
    }
  }
}

/**
 * Stitches multiple sequential video segment URLs into a single downloadable video
 * in the browser using HTML5 <canvas> + MediaRecorder.
 */
export async function mergeVideoSegments(
  segmentUrls: string[],
  fps: number = 24,
): Promise<{ blob: Blob; extension: string }> {
  if (segmentUrls.length === 0) {
    throw new Error('Нет сегментов для склейки.');
  }

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder не поддерживается этим браузером для склейки отрезков.');
  }

  const firstVideo = await loadVideoElement(segmentUrls[0]);
  const width = firstVideo.videoWidth || 832;
  const height = firstVideo.videoHeight || 480;
  firstVideo.pause();
  firstVideo.removeAttribute('src');
  firstVideo.load();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Не удалось создать <canvas> для склейки видео.');
  }

  const mimeCandidates = [
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const selectedMime =
    mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const extension = selectedMime.includes('mp4') ? 'mp4' : 'webm';

  const stream = canvas.captureStream(fps);
  const recorder = selectedMime
    ? new MediaRecorder(stream, { mimeType: selectedMime, videoBitsPerSecond: 6_000_000 })
    : new MediaRecorder(stream);

  const chunks: Blob[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: selectedMime || 'video/webm' }));
    };
    recorder.onerror = () => reject(new Error('Ошибка записи склеенного видео.'));
  });

  recorder.start(250);

  for (const url of segmentUrls) {
    const vid = await loadVideoElement(url);
    try {
      await new Promise<void>((resolve, reject) => {
        let rafId = 0;
        const draw = () => {
          if (vid.paused || vid.ended) return;
          ctx.drawImage(vid, 0, 0, width, height);
          rafId = requestAnimationFrame(draw);
        };

        vid.onended = () => {
          cancelAnimationFrame(rafId);
          ctx.drawImage(vid, 0, 0, width, height);
          resolve();
        };
        vid.onerror = () => {
          cancelAnimationFrame(rafId);
          reject(new Error('Ошибка воспроизведения сегмента при склейке.'));
        };

        vid
          .play()
          .then(() => {
            draw();
          })
          .catch((err) => {
            reject(err instanceof Error ? err : new Error('Не удалось запустить сегмент.'));
          });
      });
    } finally {
      vid.pause();
      vid.removeAttribute('src');
      vid.load();
    }
  }

  recorder.stop();
  const blob = await stopPromise;
  return { blob, extension };
}
