import { WordToken } from '../types';

/** A short must be at least this long (seconds). */
export const MIN_CLIP_LEN = 1;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Keeps a clip range inside the video and at least MIN_CLIP_LEN long.
 * `edge` says which side the user just moved: that side wins, the other one is pushed/kept.
 */
export function clampRange(start: number, end: number, total: number, edge: 'start' | 'end'): [number, number] {
  const max = total > 0 ? total : Math.max(end, start + MIN_CLIP_LEN);
  let s = Math.max(0, Math.min(start, max));
  let e = Math.max(0, Math.min(end, max));
  if (e - s < MIN_CLIP_LEN) {
    if (edge === 'start') {
      s = Math.max(0, e - MIN_CLIP_LEN);
      if (e - s < MIN_CLIP_LEN) e = Math.min(max, s + MIN_CLIP_LEN);
    } else {
      e = Math.min(max, s + MIN_CLIP_LEN);
      if (e - s < MIN_CLIP_LEN) s = Math.max(0, e - MIN_CLIP_LEN);
    }
  }
  return [round2(s), round2(e)];
}

/**
 * Snaps a time to the nearest word boundary so a short never starts or ends in the middle of a word:
 * the start snaps to a word's start, the end to a word's end. Stays put if no word is within `reach` seconds.
 */
export function snapToWord(words: WordToken[], time: number, edge: 'start' | 'end', reach = 1.5): number {
  let best = time;
  let bestDist = reach;
  for (const w of words) {
    const candidate = edge === 'start' ? w.start : w.end;
    const dist = Math.abs(candidate - time);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return round2(best);
}

/** Hook text, snippet and keywords for the words that fall inside [start, end]. */
export function describeClipRange(words: WordToken[], start: number, end: number) {
  const inside = words.filter((w) => w.start >= start - 0.05 && w.end <= end + 0.05);
  const text = (list: WordToken[]) => list.map((w) => w.word).join(' ');
  const keywords = Array.from(
    new Set(
      inside
        .filter((w) => w.keyword)
        .map((w) => w.word.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(Boolean)
    )
  ).slice(0, 6);
  return {
    hook: text(inside.slice(0, 12)),
    transcript_snippet: text(inside.slice(0, 28)) + (inside.length > 28 ? '...' : ''),
    keywords,
  };
}

/** Moves a range so it starts at `start`, keeping its length and staying inside the video. */
export function moveRange(start: number, end: number, newStart: number, total: number): [number, number] {
  const len = Math.max(MIN_CLIP_LEN, end - start);
  const max = total > 0 ? total : Math.max(end, newStart + len);
  const s = Math.max(0, Math.min(newStart, max - len));
  return [round2(s), round2(Math.min(max, s + len))];
}

/**
 * Splits [start, end] at `at` into two ranges. Returns null when either part would be shorter than
 * MIN_CLIP_LEN (the cut is too close to an edge).
 */
export function splitRange(start: number, end: number, at: number): [[number, number], [number, number]] | null {
  const t = round2(at);
  if (t - start < MIN_CLIP_LEN || end - t < MIN_CLIP_LEN) return null;
  return [[round2(start), t], [t, round2(end)]];
}

/** Indexes of the words that belong to [start, end] (same tolerance as describeClipRange). */
export function wordIndexesInRange(words: WordToken[], start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.start >= start - 0.05 && w.end <= end + 0.05) out.push(i);
  }
  return out;
}
