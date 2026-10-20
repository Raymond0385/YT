import { SubtitlePreset, VideoClip, WordToken, BrollClip, ExtraTrack, VideoSegment } from '../types';
import { tracksPayload } from './tracks';
import { buildEmojiEvents } from './emojiEvents';
import { titleOverlayPayload } from './titleOverlay';

/** How a landscape video is fitted into a vertical frame: follow the speaker's face, or a blurred background. */
export type Framing = 'auto' | 'blur';

const FRAMING_KEY = 'kadr.framing';

export function loadFraming(): Framing {
  try {
    return localStorage.getItem(FRAMING_KEY) === 'blur' ? 'blur' : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveFraming(framing: Framing): void {
  try {
    localStorage.setItem(FRAMING_KEY, framing);
  } catch {
    /* storage unavailable */
  }
}

export interface ExportPayloadInput {
  videoPath: string | null;
  transcript: WordToken[];
  preset: SubtitlePreset;
  customStyleOverrides: Partial<SubtitlePreset>;
  brollList: BrollClip[];
  outputFilename: string;
  resolution: '1080x1920' | '1920x1080' | '1080x1080';
  showEmojis: boolean;
  /** Export only this short; without it the whole video is exported. */
  clip?: (Pick<VideoClip, 'start' | 'end'> & Partial<Pick<VideoClip, 'titleText' | 'titleSeconds' | 'titleStyle'>>) | null;
  framing?: Framing;
  /** The timeline edit: cuts, speed, volume, fades and extra tracks (default: none) */
  edit?: { segments?: VideoSegment[]; speed?: number; volume?: number; fadeIn?: number; fadeOut?: number; tracks?: ExtraTrack[] };
}

export function aspectForResolution(resolution: ExportPayloadInput['resolution']): '9:16' | '16:9' | '1:1' {
  return resolution === '1080x1920' ? '9:16' : resolution === '1920x1080' ? '16:9' : '1:1';
}

/** The timeline edit of the store, as buildExportPayload's `edit`. */
export function editFromState(s: { videoSegments: VideoSegment[]; videoSpeed: number; videoVolume: number; fadeIn: number; fadeOut: number; extraTracks: ExtraTrack[] }) {
  return { segments: s.videoSegments, speed: s.videoSpeed, volume: s.videoVolume, fadeIn: s.fadeIn, fadeOut: s.fadeOut, tracks: s.extraTracks };
}

/** The body of POST /api/export. Shared by the export window and the batch export so both render the same way. */
export function buildExportPayload(input: ExportPayloadInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    video_path: input.videoPath || null,
    transcript: input.transcript,
    preset: input.preset,
    custom_overrides: input.customStyleOverrides,
    broll_clips: input.brollList.filter((b) => b.enabled),
    output_filename: input.outputFilename,
    resolution: input.resolution,
    aspect_ratio: aspectForResolution(input.resolution),
    framing: input.framing ?? loadFraming(),
  };

  const e = input.edit;
  if (e) {
    if (e.segments && e.segments.length) payload.segments = e.segments.map((s) => ({ sourceStart: s.sourceStart, sourceEnd: s.sourceEnd }));
    if (e.speed && Math.abs(e.speed - 1) > 0.01) payload.speed = e.speed;
    if (e.volume !== undefined && Math.abs(e.volume - 1) > 0.01) payload.volume = e.volume;
    if (e.fadeIn) payload.fade_in = e.fadeIn;
    if (e.fadeOut) payload.fade_out = e.fadeOut;
    const tracks = tracksPayload(e.tracks || []);
    if (tracks.length) payload.tracks = tracks;
  }

  if (input.clip) {
    payload.clip_start = input.clip.start;
    payload.clip_end = input.clip.end;
    const title = titleOverlayPayload(input.clip);
    if (title) payload.title_overlay = title;
  }

  // The emoji the preview shows above the subtitles, so the render matches it
  if (input.showEmojis) {
    const blockSize = (input.customStyleOverrides as { maxWordsPerBlock?: number })?.maxWordsPerBlock ?? input.preset.maxWordsPerBlock ?? 2;
    const events = buildEmojiEvents(input.transcript, blockSize, input.clip ? { start: input.clip.start, end: input.clip.end } : undefined);
    if (events.length) payload.emojis = events;
  }
  return payload;
}

/** "01 - Title.mp4": numbered so the files sort in the order of the shorts, with emoji and illegal characters removed. */
export function shortFileName(index: number, title: string, total = 0): string {
  const width = Math.max(2, String(Math.max(total, index)).length);
  const num = String(index).padStart(width, '0');
  const clean = (title || '')
    .replace(/[^\p{L}\p{N} _.,'()&!-]+/gu, ' ')   // drops emoji, slashes, colons and other illegal characters
    .replace(/\s+/g, ' ')
    .replace(/^[ .!,'()&_-]+|[ .]+$/g, '')
    .slice(0, 60)
    .trim();
  return `${num} - ${clean || 'short'}.mp4`;
}
