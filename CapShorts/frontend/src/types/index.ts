export interface WordToken {
  id: string;
  start: number;
  end: number;
  word: string;
  keyword: boolean;
  /** Recognition confidence 0..1 (undefined/null = unknown or verified by the user) */
  confidence?: number | null;
}

export interface SubtitlePreset {
  id: string;
  name: string;
  category: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  primaryColor: string;
  highlightColor: string;
  outlineWidth: number;
  outlineColor: string;
  shadowDepth: number;
  shadowColor: string;
  textCasing: 'UPPERCASE' | 'Title Case' | 'lowercase' | 'Default';
  maxWordsPerBlock: number;
  animationTrigger: 'pop' | 'bounce' | 'fade' | 'none';
  position: 'bottom-center' | 'middle-center' | 'top-center';
  bgBox: boolean;
  bgBoxColor: string;
  karaokeSweep: boolean;
}

export interface BrollClip {
  id: string;
  keyword: string;
  title: string;
  preview_url: string;
  video_url: string;
  thumbnail?: string;
  duration: number;
  start: number;
  end: number;
  enabled: boolean;
}

export interface VideoClip {
  id: string;
  title: string;
  hook: string;
  start: number;
  end: number;
  duration: number;
  virality_score: number;
  keywords: string[];
  transcript_snippet: string;
}

export interface VideoSegment {
  id: string;
  name: string;
  start: number;
  end: number;
  sourceStart: number;
  sourceEnd: number;
  duration: number;
}

export type AspectRatio = '9:16' | '16:9' | '1:1';

export interface EngineHealth {
  status: string;
  device: string;
  cuda_available: boolean;
  whisper_available: boolean;
  ffmpeg_available: boolean;
  hardware_encoder?: string;
  master_groq_active?: boolean;
  master_keys_count?: number;
  active_models: string[];
}

export interface ExportSettings {
  resolution: '1080x1920' | '1920x1080' | '1080x1080';
  fps: 30 | 60;
  crf: number;
  outputFormat: 'mp4' | 'mov';
}
