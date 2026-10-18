/** Pure helpers for the autosave draft and the list of recent projects. */

export const MAX_RECENTS = 8;

export interface RecentProject {
  id: string;
  /** File name, e.g. "My Viral Short 01.kadr" */
  name: string;
  /** Project title at the time it was saved/opened */
  title: string;
  openedAt: number;
  /** File System Access handle: lets the project be reopened with one click (not available everywhere). */
  handle?: unknown;
}

export interface Draft {
  savedAt: number;
  title: string;
  /** The serialized project (same text a .kadr file contains) */
  text: string;
  videoName: string;
}

/** Newest first, one entry per file name, at most `limit` entries. */
export function upsertRecent(list: RecentProject[], entry: Omit<RecentProject, 'id'> & { id?: string }, limit = MAX_RECENTS): RecentProject[] {
  const key = entry.name.trim().toLowerCase();
  const id = entry.id ?? `r-${entry.openedAt}-${Math.floor(Math.random() * 1e6)}`;
  const rest = list.filter((r) => r.name.trim().toLowerCase() !== key);
  return [{ ...entry, id }, ...rest].sort((a, b) => b.openedAt - a.openedAt).slice(0, Math.max(1, limit));
}

export function removeRecent(list: RecentProject[], id: string): RecentProject[] {
  return list.filter((r) => r.id !== id);
}

/** A draft is only worth keeping/offering when there is real work in it (not an empty editor). */
export function isMeaningful(project: { transcript: unknown[]; clips: unknown[] }): boolean {
  return project.transcript.length > 0 || project.clips.length > 0;
}

export function timeAgo(then: number, now: number, lang: 'en' | 'ru' = 'en'): string {
  const sec = Math.max(0, Math.round((now - then) / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (lang === 'ru') {
    if (sec < 45) return 'только что';
    if (min < 60) return `${Math.max(1, min)} мин назад`;
    if (hr < 24) return `${hr} ч назад`;
    return `${day} дн назад`;
  }
  if (sec < 45) return 'just now';
  if (min < 60) return `${Math.max(1, min)} min ago`;
  if (hr < 24) return `${hr} h ago`;
  return `${day} d ago`;
}
