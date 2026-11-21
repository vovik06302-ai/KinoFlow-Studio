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

export interface ElectronFilmBridge {
  isElectron: boolean;
  checkFfmpeg: () => Promise<{ ffmpegPath: string | null }>;
  mergeSegments: (segmentUrls: string[], suggestedName: string) => Promise<FilmMergeResult>;
  showFile: (filePath: string) => Promise<{ ok: boolean }>;
  onProgress: (callback: (event: FilmMergeProgress) => void) => () => void;
}

declare global {
  interface Window {
    kinoflowFilm?: ElectronFilmBridge;
  }
}
