export interface Generation {
  id: string;
  prompt: string;
  enhancedPrompt?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  videoUrl?: string;
  createdAt: number;
  settings: any;
}

export interface Scene {
  id: string;
  title: string;
  description: string;
  generations: Generation[];
  order: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  scenes: Scene[];
  createdAt: number;
  updatedAt: number;
}

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
