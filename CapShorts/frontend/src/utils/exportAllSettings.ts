import { VideoClip } from '../types';
import { Framing } from './exportPayload';
import { shortFileName } from './exportPayload';

/** How "Export all" (and the batch of videos) renders the shorts. Kept in the browser storage. */
export interface ExportAllSettings {
  /** Which shorts: all of them, only strong ones, or strong and good */
  which: 'all' | 'strong' | 'good';
  resolution: '1080x1920' | '1080x1080' | '1920x1080';
  framing: Framing;
  subtitles: boolean;
  emoji: boolean;
  hookTitle: boolean;
  /** File names: "01 - Title.mp4", "Title.mp4" or "Video - 01 - Title.mp4" */
  naming: 'number-title' | 'title' | 'video-number-title';
}

export const DEFAULT_EXPORT_ALL: ExportAllSettings = {
  which: 'all', resolution: '1080x1920', framing: 'auto', subtitles: true, emoji: true, hookTitle: true, naming: 'number-title',
};

const KEY = 'kadr.exportAll';

export function loadExportAllSettings(): ExportAllSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const s = { ...DEFAULT_EXPORT_ALL, ...(raw && typeof raw === 'object' ? raw : {}) };
    return {
      which: ['all', 'strong', 'good'].includes(s.which) ? s.which : 'all',
      resolution: ['1080x1920', '1080x1080', '1920x1080'].includes(s.resolution) ? s.resolution : '1080x1920',
      framing: s.framing === 'blur' ? 'blur' : 'auto',
      subtitles: s.subtitles !== false,
      emoji: s.emoji !== false,
      hookTitle: s.hookTitle !== false,
      naming: ['number-title', 'title', 'video-number-title'].includes(s.naming) ? s.naming : 'number-title',
    };
  } catch {
    return { ...DEFAULT_EXPORT_ALL };
  }
}

export function saveExportAllSettings(s: ExportAllSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

const tierOf = (c: VideoClip) => c.tier ?? (c.virality_score >= 75 ? 'strong' : c.virality_score >= 62 ? 'good' : 'fair');

/** The shorts "Export all" renders, in time order. */
export function pickClips(clips: VideoClip[], which: ExportAllSettings['which']): VideoClip[] {
  const keep = (c: VideoClip) => which === 'all' || tierOf(c) === 'strong' || (which === 'good' && tierOf(c) === 'good');
  return clips.filter(keep).sort((a, b) => a.start - b.start);
}

const cleanBase = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _.,'()&!-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'video';

/** File name of the n-th short (1-based) of `total`. */
export function exportFileName(naming: ExportAllSettings['naming'], index: number, clip: Pick<VideoClip, 'title'>, total: number, videoName = ''): string {
  const numbered = shortFileName(index, clip.title, total);
  if (naming === 'title') return numbered.replace(/^\d+ - /, '');
  if (naming === 'video-number-title') return `${cleanBase(videoName)} - ${numbered}`;
  return numbered;
}
