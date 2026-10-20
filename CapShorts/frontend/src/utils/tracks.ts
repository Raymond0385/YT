import { apiUrl } from '../config';
import { ExtraTrack, TrackItem } from '../types';

/** Pure helpers for the extra video / audio tracks (picture in picture, music, voice-over). */

export const MIN_ITEM_LEN = 0.2;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function newTrack(kind: ExtraTrack['kind'], count: number): ExtraTrack {
  return {
    id: `track-${kind}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    kind,
    name: kind === 'video' ? `Video ${count + 2}` : `Audio ${count + 2}`,
    muted: false,
    volume: 1,
    items: [],
  };
}

export function newItem(kind: ExtraTrack['kind'], media: { name: string; mediaId?: string; path?: string; duration: number }, start: number): TrackItem {
  return {
    id: `item-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: media.name,
    mediaId: media.mediaId,
    path: media.path,
    start: r2(Math.max(0, start)),
    duration: r2(Math.max(MIN_ITEM_LEN, media.duration)),
    sourceStart: 0,
    mediaDuration: r2(media.duration),
    volume: kind === 'audio' ? 0.6 : 1,
    x: 0.75,
    y: 0.25,
    scale: 0.35,
    opacity: 1,
    fadeIn: 0,
    fadeOut: kind === 'audio' ? 1 : 0,
  };
}

/** Moves an item so it starts at `start` (never before 0). */
export function moveItem(item: TrackItem, start: number): TrackItem {
  return { ...item, start: r2(Math.max(0, start)) };
}

/**
 * Trims an item from one edge, keeping it inside its media: the start edge moves the in-point too,
 * so the picture or sound under the playhead does not shift.
 */
export function trimItem(item: TrackItem, edge: 'start' | 'end', time: number): TrackItem {
  const media = item.mediaDuration > 0 ? item.mediaDuration : Infinity;
  if (edge === 'end') {
    const maxEnd = item.start + (media - item.sourceStart);
    const end = Math.min(maxEnd, Math.max(item.start + MIN_ITEM_LEN, time));
    return { ...item, duration: r2(end - item.start) };
  }
  const end = item.start + item.duration;
  const earliest = Math.max(0, item.start - item.sourceStart);       // cannot reveal media before its first frame
  const start = Math.min(end - MIN_ITEM_LEN, Math.max(earliest, time));
  return { ...item, start: r2(start), sourceStart: r2(item.sourceStart + (start - item.start)), duration: r2(end - start) };
}

/** Where in its media an item is at timeline time `t`, or null when it is not playing. */
export function itemMediaTime(item: TrackItem, t: number): number | null {
  if (t < item.start || t >= item.start + item.duration) return null;
  return item.sourceStart + (t - item.start);
}

/** Opacity / volume factor of an item's fades at timeline time `t` (0..1). */
export function fadeFactor(item: TrackItem, t: number): number {
  const into = t - item.start;
  const left = item.start + item.duration - t;
  let f = 1;
  if (item.fadeIn > 0) f = Math.min(f, Math.max(0, into / item.fadeIn));
  if (item.fadeOut > 0) f = Math.min(f, Math.max(0, left / item.fadeOut));
  return f;
}

/** URL the preview plays an item from (the engine keeps the file). */
export function itemUrl(item: TrackItem): string | null {
  return item.mediaId ? apiUrl(`/api/media/${item.mediaId}`) : null;
}

/** The tracks as the export expects them. */
export function tracksPayload(tracks: ExtraTrack[]) {
  return tracks
    .filter((t) => t.items.length)
    .map((t) => ({
      kind: t.kind, muted: t.muted, volume: t.volume,
      items: t.items.map(({ mediaId, path, start, duration, sourceStart, volume, x, y, scale, opacity, fadeIn, fadeOut }) =>
        ({ mediaId, path, start, duration, sourceStart, volume, x, y, scale, opacity, fadeIn, fadeOut })),
    }));
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown, lo: number, hi: number, d: number) => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Tracks read back from a project file (untrusted). */
export function cleanTracks(raw: unknown): ExtraTrack[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).flatMap((t, ti): ExtraTrack[] => {
    if (!t || typeof t !== 'object') return [];
    const o = t as Record<string, unknown>;
    const kind = o.kind === 'video' || o.kind === 'audio' ? o.kind : null;
    if (!kind) return [];
    const items = (Array.isArray(o.items) ? o.items : []).slice(0, 200).flatMap((it, ii): TrackItem[] => {
      if (!it || typeof it !== 'object') return [];
      const i = it as Record<string, unknown>;
      const mediaId = typeof i.mediaId === 'string' && /^[0-9a-f]{24}$/.test(i.mediaId) ? i.mediaId : undefined;
      const path = typeof i.path === 'string' && /^[\w.-]{1,120}$/.test(i.path) ? i.path : undefined;
      if (!mediaId && !path) return [];
      return [{
        id: typeof i.id === 'string' && i.id ? i.id.slice(0, 80) : `item-${ti}-${ii}`,
        name: typeof i.name === 'string' ? i.name.slice(0, 120) : 'media',
        mediaId, path,
        start: num(i.start, 0, 1e6, 0),
        duration: num(i.duration, MIN_ITEM_LEN, 1e6, 1),
        sourceStart: num(i.sourceStart, 0, 1e6, 0),
        mediaDuration: num(i.mediaDuration, 0, 1e6, 0),
        volume: num(i.volume, 0, 3, 1),
        x: num(i.x, 0, 1, 0.75), y: num(i.y, 0, 1, 0.25), scale: num(i.scale, 0.05, 1, 0.35),
        opacity: num(i.opacity, 0, 1, 1), fadeIn: num(i.fadeIn, 0, 10, 0), fadeOut: num(i.fadeOut, 0, 10, 0),
      }];
    });
    return [{
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 80) : `track-${ti}`,
      kind, name: typeof o.name === 'string' ? o.name.slice(0, 40) : kind,
      muted: Boolean(o.muted), volume: num(o.volume, 0, 3, 1), items,
    }];
  });
}

/** Sends a media file to the engine and keeps it there; returns what a track item needs. */
export async function importMedia(file: File, fetchImpl: typeof fetch = fetch): Promise<{ name: string; path: string; mediaId?: string; duration: number }> {
  const duration = await mediaDuration(file);
  const form = new FormData();
  form.append('file', file);
  const up = await fetchImpl(apiUrl('/api/upload-video'), { method: 'POST', body: form });
  if (!up.ok) throw new Error(`Could not send ${file.name} to the engine (${up.status})`);
  const path: string = (await up.json()).video_path;
  let mediaId: string | undefined;
  try {
    const kept = await fetchImpl(apiUrl('/api/media/keep'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video_path: path }) });
    if (kept.ok) mediaId = (await kept.json()).media_id;
  } catch {
    /* the item still renders from the temporary copy */
  }
  return { name: file.name, path, mediaId, duration };
}

/** Length of an audio or video file, read by the browser. */
export function mediaDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(0);
    const el = document.createElement(file.type.startsWith('audio') ? 'audio' : 'video');
    const url = URL.createObjectURL(file);
    const done = (d: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(0);
    el.src = url;
  });
}
