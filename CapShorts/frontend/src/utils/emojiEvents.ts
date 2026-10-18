import { WordToken } from '../types';
import { getEmojiForWords } from './emojiHelper';

export interface EmojiEvent {
  start: number;
  end: number;
  emoji: string;
}

/**
 * The emoji the preview shows above the subtitles, as a time list the export can draw.
 * Uses the same blocks as the preview: `blockSize` words per block, shown from the first word's start
 * to the last word's end (at least 0.3 s). Neighbouring blocks with the same emoji are joined, so the
 * emoji does not flicker and the export needs fewer overlays.
 * With `range` only blocks that overlap that part of the video are returned.
 */
export function buildEmojiEvents(
  words: WordToken[],
  blockSize: number,
  range?: { start: number; end: number }
): EmojiEvent[] {
  const size = Math.max(1, Math.floor(blockSize) || 1);
  const events: EmojiEvent[] = [];

  for (let i = 0; i < words.length; i += size) {
    const slice = words.slice(i, i + size);
    if (!slice.length) continue;
    const start = slice[0].start;
    const end = Math.max(slice[slice.length - 1].end, start + 0.3);
    if (range && (end <= range.start || start >= range.end)) continue;
    const emoji = getEmojiForWords(slice);
    if (!emoji) continue;

    const prev = events[events.length - 1];
    if (prev && prev.emoji === emoji && start - prev.end <= 0.15) {
      prev.end = end;
    } else {
      events.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, emoji });
    }
  }
  return events;
}
