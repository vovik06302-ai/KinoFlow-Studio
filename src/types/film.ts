export interface FilmMergeResult {
  ok: boolean;
  path?: string;
  code?: 'FFMPEG_NOT_FOUND' | 'CANCELLED';
  error?: string;
}

export interface FilmMergeProgress {
  phase: 'downloading' | 'encoding';
  index: number;
  total: number;
}

export interface SelectedAudioTrack {
  path: string;
  name: string;
}

export interface ElectronFilmBridge {
  isElectron: boolean;
  checkFfmpeg: () => Promise<{ ffmpegPath: string | null }>;
  selectAudio?: () => Promise<SelectedAudioTrack | null>;
  mergeSegments: (
    segmentUrls: string[],
    suggestedName: string,
    audioOptions?: { audioPath?: string; audioVolume?: number },
  ) => Promise<FilmMergeResult>;
  extractLastFrame?: (videoUrl: string) => Promise<{
    ok: boolean;
    pngBase64?: string;
    code?: 'FFMPEG_NOT_FOUND';
    error?: string;
  }>;
  archiveClip?: (
    videoUrl: string,
    filename?: string,
  ) => Promise<{ ok: boolean; localPath?: string; error?: string }>;
  saveGeneratedAudio?: (
    audioBase64: string,
    extension: string,
    suggestedName?: string,
  ) => Promise<{ ok: boolean; path?: string; name?: string; error?: string }>;
  showFile: (filePath: string) => Promise<{ ok: boolean }>;
  onProgress: (callback: (event: FilmMergeProgress) => void) => () => void;
}

declare global {
  interface Window {
    kinoflowFilm?: ElectronFilmBridge;
  }
}
