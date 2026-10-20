import { VideoClip } from '../types';

/**
 * Hook title over the first seconds of a short. Sizes are fractions of the canvas height, the same numbers the
 * render uses (backend/subtitle_gen.py TITLE_*), so the preview matches the exported video.
 */
export const TITLE_FONT_REL = 0.05;
export const TITLE_TOP_REL = 0.12;
export const TITLE_SIDE_REL = 0.07;
export const TITLE_PAD_REL = 0.012;
export const TITLE_DEFAULT_SECONDS = 3;
/**
 * libass takes the font size as the height of a line (ascent + descent), CSS as the em size. Montserrat's line
 * is 1.219 em (hhea 968 + 251 per 1000), so the same number draws smaller letters in the render.
 */
export const TITLE_EM_PER_LINE = 1 / 1.219;

export type TitleStyle = 'box' | 'dark' | 'outline';

export const TITLE_STYLES: Record<TitleStyle, { label: string; color: string; background: string | null; outline: string | null }> = {
  box: { label: 'Yellow box', color: '#111111', background: '#FACC15', outline: null },
  dark: { label: 'Dark box', color: '#FFFFFF', background: '#111111', outline: null },
  outline: { label: 'White with outline', color: '#FFFFFF', background: null, outline: '#000000' },
};

type TitleFields = Pick<VideoClip, 'titleText' | 'titleSeconds' | 'titleStyle'>;

/** The title_overlay part of the export request, or null when the short has no title. */
export function titleOverlayPayload(clip: TitleFields | null | undefined) {
  const text = (clip?.titleText || '').trim();
  if (!text) return null;
  return { text, duration: clip?.titleSeconds || TITLE_DEFAULT_SECONDS, style: clip?.titleStyle || 'box' };
}

/** Whether the title is on screen at `time` (seconds of the source video). */
export function titleVisibleAt(clip: (TitleFields & Pick<VideoClip, 'start'>) | null | undefined, time: number): boolean {
  if (!clip || !(clip.titleText || '').trim()) return false;
  const secs = clip.titleSeconds || TITLE_DEFAULT_SECONDS;
  return time >= clip.start - 0.01 && time < clip.start + secs;
}

/** A first suggestion for the title: the first sentence of the hook, at most ~8 words. */
export function suggestTitle(hook: string): string {
  const sentence = (hook || '').split(/(?<=[.!?…])\s+/)[0] || '';
  const words = sentence.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const cut = words.slice(0, 8).join(' ');
  return words.length > 8 ? `${cut.replace(/[,;:]$/, '')}...` : cut;
}
