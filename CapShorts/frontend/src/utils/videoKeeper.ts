import { apiUrl } from '../config';
import { useVideoStore } from '../store/useVideoStore';

/**
 * A project file holds only a reference to its video. These helpers let the engine keep a copy of the video
 * (see backend/media_store.py) so opening a saved project or restoring the autosave brings the video back too.
 */

// One kept-id per video file, so the autosave does not upload the same video again every few seconds.
const kept = new WeakMap<File, Promise<string | null>>();

async function ensureOnEngine(file: File, serverPath: string | null): Promise<string | null> {
  if (serverPath) return serverPath;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(apiUrl('/api/upload-video'), { method: 'POST', body: form });
  if (!res.ok) return null;
  const data = await res.json();
  const path: string | null = data.video_path || null;
  if (path && useVideoStore.getState().videoFile === file) useVideoStore.setState({ serverVideoPath: path });
  return path;
}

/** The id of the engine's copy of the video, or null if it could not be kept (the project then asks for the file). */
export function keepVideo(file: File | null, serverPath: string | null): Promise<string | null> {
  if (!file) return Promise.resolve(null);
  const known = kept.get(file);
  if (known) return known;
  const job = (async () => {
    try {
      const path = await ensureOnEngine(file, serverPath);
      if (!path) return null;
      const res = await fetch(apiUrl('/api/media/keep'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video_path: path }),
      });
      if (!res.ok) return null;
      return ((await res.json()).media_id as string) || null;
    } catch {
      return null;
    }
  })();
  kept.set(file, job);
  void job.then((id) => { if (!id) kept.delete(file); });   // try again next time if it failed
  return job;
}

/** Fetches the kept video back as a File, or null if the engine no longer has it. */
export async function restoreKeptVideo(ref: { name: string; mediaId?: string; lastModified?: number }): Promise<File | null> {
  if (!ref.mediaId) return null;
  try {
    const res = await fetch(apiUrl(`/api/media/${ref.mediaId}`));
    if (!res.ok) return null;
    const blob = await res.blob();
    const file = new File([blob], ref.name || 'video.mp4', { type: blob.type || 'video/mp4', lastModified: ref.lastModified });
    kept.set(file, Promise.resolve(ref.mediaId));        // it is already kept
    return file;
  } catch {
    return null;
  }
}
