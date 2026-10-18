import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepVideo, restoreKeptVideo } from './videoKeeper';

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

afterEach(() => vi.unstubAllGlobals());

describe('keepVideo', () => {
  it('uploads when needed, asks the engine to keep it, and remembers the answer', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return String(url).includes('upload-video') ? json({ video_path: 'input_1.mp4' }) : json({ media_id: 'a'.repeat(24) });
    }));
    const file = new File(['x'], 'a.mp4');
    expect(await keepVideo(file, null)).toBe('a'.repeat(24));
    expect(await keepVideo(file, 'input_1.mp4')).toBe('a'.repeat(24));
    expect(calls.filter((c) => c.includes('/api/media/keep')).length).toBe(1);      // not repeated for the same file
  });

  it('skips the upload when the engine already has the video, and gives null on failure', async () => {
    const f = vi.fn(async () => json({}, 500));
    vi.stubGlobal('fetch', f);
    expect(await keepVideo(new File(['x'], 'b.mp4'), 'input_2.mp4')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(await keepVideo(null, null)).toBeNull();
  });

  it('tries again after a failure', async () => {
    let ok = false;
    vi.stubGlobal('fetch', vi.fn(async () => (ok ? json({ media_id: 'b'.repeat(24) }) : json({}, 500))));
    const file = new File(['x'], 'c.mp4');
    expect(await keepVideo(file, 'input_3.mp4')).toBeNull();
    ok = true;
    expect(await keepVideo(file, 'input_3.mp4')).toBe('b'.repeat(24));
  });
});

describe('restoreKeptVideo', () => {
  it('returns the video as a file with the original name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['data'], { type: 'video/mp4' }) }) as unknown as Response));
    const file = await restoreKeptVideo({ name: 'talk.mp4', mediaId: 'c'.repeat(24) });
    expect(file?.name).toBe('talk.mp4');
    expect(file?.size).toBe(4);
  });

  it('returns null when there is no id or the engine lost the video', async () => {
    expect(await restoreKeptVideo({ name: 'x.mp4' })).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 404)));
    expect(await restoreKeptVideo({ name: 'x.mp4', mediaId: 'd'.repeat(24) })).toBeNull();
  });
});
