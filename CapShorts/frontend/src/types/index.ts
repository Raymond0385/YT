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
  /** true for shorts the user created or edited by hand */
  custom?: boolean;
  /** quality tier from the detection: strong >= 75, good >= 62, fair below */
  tier?: 'strong' | 'good' | 'fair';
  /** 1 = the best short of the video */
  rank?: number;
  /** Hook title shown over the first seconds of the short (empty = none) */
  titleText?: string;
  titleSeconds?: number;
  titleStyle?: 'box' | 'dark' | 'outline';
}

/** A piece of media on an extra track (a picture-in-picture video or a sound). Times in seconds. */
export interface TrackItem {
  id: string;
  name: string;
  /** The engine's kept copy (survives restarts) */
  mediaId?: string;
  /** The engine's temporary copy */
  path?: string;
  /** Timeline position and length */
  start: number;
  duration: number;
  /** In-point inside the media */
  sourceStart: number;
  mediaDuration: number;
  volume: number;
  /** Video layers: centre as fractions of the frame, width as a fraction of the frame width */
  x: number;
  y: number;
  scale: number;
  opacity: number;
  fadeIn: number;
  fadeOut: number;
}

export interface ExtraTrack {
  id: string;
  kind: 'video' | 'audio';
  name: string;
  muted: boolean;
  volume: number;
  items: TrackItem[];
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
