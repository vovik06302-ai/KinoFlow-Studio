import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Download, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { computeWaveformPeaks, formatAudioTime } from '../utils/audioWaveform';

interface SegmentAudioPlayerProps {
  audioUrl: string;
  segmentLabel?: string;
  soundDescription?: string;
  downloadFilename?: string;
}

const WAVEFORM_BAR_COUNT = 56;

export function SegmentAudioPlayer({
  audioUrl,
  segmentLabel,
  soundDescription,
  downloadFilename,
}: SegmentAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPeaks([]);

    if (typeof AudioContext === 'undefined' && typeof (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext === 'undefined') {
      return;
    }

    const controller = new AbortController();
    let audioCtx: AudioContext | null = null;
    let cancelled = false;

    const decodeWaveform = async () => {
      try {
        const response = await fetch(audioUrl, { signal: controller.signal });
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;

        const AudioCtxCtor =
          typeof AudioContext !== 'undefined'
            ? AudioContext
            : (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new AudioCtxCtor();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
        if (cancelled) return;

        const channelData = decoded.getChannelData(0);
        setPeaks(computeWaveformPeaks(channelData, WAVEFORM_BAR_COUNT));
      } catch {
        // Fallback silently to native HTML5 <audio> controls when CORS or codec decoding is unavailable
      } finally {
        if (audioCtx && audioCtx.state !== 'closed') {
          void audioCtx.close().catch(() => undefined);
        }
      }
    };

    void decodeWaveform();

    return () => {
      cancelled = true;
      controller.abort();
      if (audioCtx && audioCtx.state !== 'closed') {
        void audioCtx.close().catch(() => undefined);
      }
    };
  }, [audioUrl]);

  const progressRatio = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

  const handleTogglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  };

  const handleToggleMute = () => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setIsMuted(el.muted);
  };

  const seekToFraction = (fraction: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const clamped = Math.max(0, Math.min(1, fraction));
    el.currentTime = clamped * el.duration;
    setCurrentTime(el.currentTime);
  };

  const handleWaveformClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = (event.clientX - rect.left) / rect.width;
    seekToFraction(fraction);
  };

  const handleWaveformKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      seekToFraction((el.currentTime + 1) / el.duration);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seekToFraction((el.currentTime - 1) / el.duration);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      handleTogglePlay();
    }
  };

  const isLocalBlobOrData = audioUrl.startsWith('blob:') || audioUrl.startsWith('data:');

  return (
    <div
      data-testid="segment-audio-player"
      className="border-t border-[#1E2330] bg-[#11151F] px-4 py-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={handleTogglePlay}
            aria-label={isPlaying ? 'Пауза аудиодорожки' : 'Воспроизвести аудиодорожку'}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#E58E26]/55 bg-[#E58E26]/15 text-[#F6AD55] transition-colors hover:bg-[#E58E26]/25 focus-visible:outline-2 focus-visible:outline-[#E58E26]"
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            )}
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#E2E8F0]">
              <Volume2 className="h-3.5 w-3.5 shrink-0 text-[#F6AD55]" aria-hidden="true" />
              <span className="truncate">
                {segmentLabel ? `Аудиодорожка · ${segmentLabel}` : 'Аудиодорожка сегмента'}
              </span>
            </div>
            {soundDescription && (
              <p className="truncate text-[11px] text-[#94A3B8]">{soundDescription}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[11px] tabular-nums text-[#94A3B8]">
            {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
          </span>
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={isMuted ? 'Включить звук' : 'Выключить звук'}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#262C3A] bg-[#141821] text-[#CBD5E1] transition-colors hover:border-[#3A4358] hover:text-white focus-visible:outline-2 focus-visible:outline-[#E58E26]"
          >
            {isMuted ? (
              <VolumeX className="h-3.5 w-3.5 text-[#94A3B8]" aria-hidden="true" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
          <a
            href={audioUrl}
            download={downloadFilename || 'segment_audio.wav'}
            title="Скачать аудиодорожку сегмента"
            className="inline-flex items-center gap-1 rounded-md border border-[#262C3A] bg-[#141821] px-2 py-1 text-[11px] font-medium text-[#CBD5E1] transition-colors hover:border-[#3A4358] hover:text-white"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            <span>Аудио</span>
          </a>
        </div>
      </div>

      {peaks.length > 0 && (
        <div
          role="slider"
          tabIndex={0}
          aria-label="Осциллограмма аудиодорожки сегмента"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          onClick={handleWaveformClick}
          onKeyDown={handleWaveformKeyDown}
          className="mb-2 flex h-10 cursor-pointer items-end gap-[2px] rounded-md border border-[#1E2330] bg-[#0B0E14] px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-[#E58E26]"
        >
          {peaks.map((peak, index) => {
            const barFraction = (index + 0.5) / peaks.length;
            const isPlayed = progressRatio > 0 && barFraction <= progressRatio;
            return (
              <span
                key={index}
                aria-hidden="true"
                className={`flex-1 rounded-xs transition-colors ${
                  isPlayed ? 'bg-[#E58E26]' : 'bg-[#2C3548] hover:bg-[#46536E]'
                }`}
                style={{ height: `${Math.round(peak * 100)}%` }}
              />
            );
          })}
        </div>
      )}

      <audio
        ref={audioRef}
        src={audioUrl}
        crossOrigin={isLocalBlobOrData ? undefined : 'anonymous'}
        controls
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onVolumeChange={(e) => setIsMuted(e.currentTarget.muted || e.currentTarget.volume === 0)}
        className="h-8 w-full"
      />
    </div>
  );
}
