import type { GeneratedSegment, GenerationHistoryItem } from '../types/video';

/**
 * Resolves the audio URL for the currently selected segment.
 * For multi-segment videos, strictly checks the active segment's `audioUrl` so
 * switching to a segment without audio does not inherit another segment's track.
 */
export function resolveSegmentAudioUrl(
  activeSegment: GeneratedSegment | null,
  activeVideo: GenerationHistoryItem | null,
): string | null {
  const segmentUrl =
    typeof activeSegment?.audioUrl === 'string' ? activeSegment.audioUrl.trim() : '';
  if (segmentUrl) {
    return segmentUrl;
  }

  const segmentCount = activeVideo?.segments?.length ?? 0;
  if (activeSegment && segmentCount > 1) {
    return null;
  }

  const videoUrl =
    typeof activeVideo?.audioUrl === 'string' ? activeVideo.audioUrl.trim() : '';
  return videoUrl || null;
}

/**
 * Computes normalized peak amplitudes in the range [0.08, 1] from real PCM audio samples.
 * Returns an empty array when there are no samples to visualize.
 */
export function computeWaveformPeaks(samples: Float32Array, barCount = 56): number[] {
  const safeBarCount = Math.max(8, Math.min(128, Math.floor(barCount)));
  if (samples.length === 0) {
    return [];
  }

  const rawPeaks: number[] = new Array<number>(safeBarCount).fill(0);
  const blockSize = samples.length / safeBarCount;
  let maxPeak = 0;

  for (let i = 0; i < safeBarCount; i += 1) {
    const start = Math.floor(i * blockSize);
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((i + 1) * blockSize)));
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      const magnitude = Math.abs(samples[j]);
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
    rawPeaks[i] = peak;
    if (peak > maxPeak) {
      maxPeak = peak;
    }
  }

  if (maxPeak <= 0) {
    return rawPeaks.map(() => 0.12);
  }

  return rawPeaks.map((peak) => {
    const normalized = peak / maxPeak;
    return Number(Math.max(0.08, Math.min(1, normalized)).toFixed(3));
  });
}

/**
 * Formats playback time in seconds as M:SS (e.g. 0:05, 1:24).
 */
export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remaining = totalSeconds % 60;
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}
