import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { downloadToFile } from './appUpdater.js';

/**
 * Joins the 5-second segments of a long generation into one MP4 using a local FFmpeg.
 * Segments 2..N start from the last frame of the previous one (I2V chaining), so their first
 * frame duplicates the previous clip's last frame; it is trimmed to avoid a visible stutter.
 */

export function ffmpegCandidates({ env = process.env, resourcesPath = process.resourcesPath } = {}) {
  const list = [];
  if (env.FFMPEG_PATH) list.push(env.FFMPEG_PATH);
  if (resourcesPath) {
    list.push(path.join(resourcesPath, 'ffmpeg.exe'), path.join(resourcesPath, 'ffmpeg'));
  }
  list.push('ffmpeg', 'C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe');
  return list;
}

export function runProcess(command, args, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let child;
    try {
      child = spawnImpl(command, args, { windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

/** Returns the first FFmpeg executable that answers `-version`, or null. */
export async function findFfmpeg({ candidates = ffmpegCandidates(), spawnImpl = spawn } = {}) {
  for (const candidate of candidates) {
    try {
      const { code } = await runProcess(candidate, ['-version'], spawnImpl);
      if (code === 0) return candidate;
    } catch {
      // not available, try the next one
    }
  }
  return null;
}

export function buildMergeArgs({ inputs, output, trimDuplicateFirstFrame = true, crf = 17 }) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('Нет сегментов для склейки.');
  }
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const input of inputs) {
    args.push('-i', input);
  }
  const chains = inputs.map((_, index) =>
    index > 0 && trimDuplicateFirstFrame
      ? `[${index}:v]trim=start_frame=1,setpts=PTS-STARTPTS[v${index}]`
      : `[${index}:v]setpts=PTS-STARTPTS[v${index}]`,
  );
  const labels = inputs.map((_, index) => `[v${index}]`).join('');
  const filter = `${chains.join(';')};${labels}concat=n=${inputs.length}:v=1:a=0[outv]`;
  args.push(
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  );
  return args;
}

export function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function mergeSegments({
  segmentUrls,
  outputPath,
  ffmpegPath,
  tempRoot = os.tmpdir(),
  spawnImpl = spawn,
  downloadImpl = downloadToFile,
  onProgress,
}) {
  if (!ffmpegPath) {
    const error = new Error('FFmpeg не найден.');
    error.code = 'FFMPEG_NOT_FOUND';
    throw error;
  }
  if (!Array.isArray(segmentUrls) || segmentUrls.length === 0 || !segmentUrls.every(isHttpUrl)) {
    throw new Error('Некорректный список сегментов для склейки.');
  }

  const workDir = fs.mkdtempSync(path.join(tempRoot, 'kinoflow-merge-'));
  try {
    const inputs = [];
    for (let index = 0; index < segmentUrls.length; index += 1) {
      const target = path.join(workDir, `seg_${index + 1}.mp4`);
      onProgress?.({ phase: 'downloading', index: index + 1, total: segmentUrls.length });
      await downloadImpl({ url: segmentUrls[index], destPath: target });
      inputs.push(target);
    }

    onProgress?.({ phase: 'encoding', index: segmentUrls.length, total: segmentUrls.length });
    const args = buildMergeArgs({ inputs, output: outputPath });
    const { code, stderr } = await runProcess(ffmpegPath, args, spawnImpl);
    if (code !== 0) {
      throw new Error(`FFmpeg завершился с кодом ${code}. ${stderr.trim().split('\n').slice(-3).join(' ')}`);
    }
    return { outputPath };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export function buildExtractLastFrameArgs({ inputPath, outputPath }) {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-sseof',
    '-0.5',
    '-i',
    inputPath,
    '-update',
    '1',
    '-frames:v',
    '1',
    outputPath,
  ];
}

/**
 * Extracts the exact final frame of an HTTP video URL as PNG bytes using local FFmpeg.
 * Avoids transferring full MP4s over IPC or hitting browser <video>/<canvas> codec quirks.
 */
export async function extractLastFrameWithFfmpeg({
  videoUrl,
  ffmpegPath,
  tempRoot = os.tmpdir(),
  spawnImpl = spawn,
  downloadImpl = downloadToFile,
}) {
  if (!ffmpegPath) {
    const error = new Error('FFmpeg не найден.');
    error.code = 'FFMPEG_NOT_FOUND';
    throw error;
  }
  if (!isHttpUrl(videoUrl)) {
    throw new Error('Некорректный адрес видео для извлечения кадра.');
  }

  const workDir = fs.mkdtempSync(path.join(tempRoot, 'kinoflow-frame-'));
  try {
    const videoPath = path.join(workDir, 'clip.mp4');
    const framePath = path.join(workDir, 'last_frame.png');
    await downloadImpl({ url: videoUrl, destPath: videoPath });

    // Extract the final frame robustly: -sseof -0.5 seeks near the end and outputs the last frame.
    let { code, stderr } = await runProcess(
      ffmpegPath,
      buildExtractLastFrameArgs({ inputPath: videoPath, outputPath: framePath }),
      spawnImpl,
    );

    if (code !== 0 || !fs.existsSync(framePath)) {
      // Fallback for ultra-short (<0.5s) clips: read from start and take the last decoded frame.
      ({ code, stderr } = await runProcess(
        ffmpegPath,
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          videoPath,
          '-update',
          '1',
          framePath,
        ],
        spawnImpl,
      ));
    }

    if (code !== 0 || !fs.existsSync(framePath)) {
      throw new Error(
        `FFmpeg не смог извлечь последний кадр (код ${code}). ${stderr.trim().split('\n').slice(-2).join(' ')}`,
      );
    }

    const bytes = fs.readFileSync(framePath);
    return {
      pngBase64: bytes.toString('base64'),
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Saves a generated ComfyUI segment clip to a persistent local directory on disk
 * so videos remain safely archived even if ComfyUI output is cleared or offline.
 */
export async function archiveVideoClip({
  videoUrl,
  archiveDir,
  filename,
  downloadImpl = downloadToFile,
}) {
  if (!isHttpUrl(videoUrl)) {
    throw new Error('Некорректный URL клипа для локального архива.');
  }
  fs.mkdirSync(archiveDir, { recursive: true });
  const safeName = path
    .basename(String(filename || `kinoflow_${Date.now()}.mp4`))
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  const finalName = /\.(mp4|webm|mov)$/i.test(safeName) ? safeName : `${safeName}.mp4`;
  const destPath = path.join(archiveDir, finalName);
  await downloadImpl({ url: videoUrl, destPath });
  return { localPath: destPath };
}
