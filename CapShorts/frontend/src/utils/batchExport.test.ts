import { describe, expect, it, vi } from 'vitest';
import { batchSummary, BatchItem, runBatchExport } from './batchExport';
import { aspectForResolution, buildExportPayload, shortFileName } from './exportPayload';
import { VideoClip, WordToken, SubtitlePreset } from '../types';

const clip = (id: string, title: string, start: number, end: number): VideoClip => ({
  id, title, hook: '', start, end, duration: end - start, virality_score: 50, keywords: [], transcript_snippet: '',
});

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('shortFileName', () => {
  it('numbers the shorts and cleans the title', () => {
    expect(shortFileName(1, '💰 Money Secret!', 5)).toBe('01 - Money Secret!.mp4');
    expect(shortFileName(3, 'Мой лучший шорт', 12)).toBe('03 - Мой лучший шорт.mp4');
    expect(shortFileName(7, 'a/b\\c:d*e?"f"', 7)).toBe('07 - a b c d e f.mp4');
    expect(shortFileName(2, '', 3)).toBe('02 - short.mp4');
    expect(shortFileName(1, '🔥🔥🔥', 3)).toBe('01 - short.mp4');
    expect(shortFileName(5, 'x'.repeat(200), 5).length).toBeLessThanOrEqual('05 - '.length + 60 + '.mp4'.length);
  });

  it('pads wide enough for many shorts', () => {
    expect(shortFileName(7, 'a', 120)).toBe('007 - a.mp4');
  });
});

describe('buildExportPayload', () => {
  const words: WordToken[] = [
    { id: 'a', word: 'money', start: 1, end: 1.4, keyword: false },
    { id: 'b', word: 'now', start: 1.5, end: 1.9, keyword: false },
    { id: 'c', word: 'stop', start: 20, end: 20.4, keyword: false },
  ];
  const preset = { id: 'p', maxWordsPerBlock: 2 } as unknown as SubtitlePreset;
  const base = {
    videoPath: 'input_1.mp4', transcript: words, preset, customStyleOverrides: {}, brollList: [],
    outputFilename: 'x.mp4', resolution: '1080x1920' as const, showEmojis: true,
  };

  it('fills the clip range, aspect ratio and emoji for a short', () => {
    const p = buildExportPayload({ ...base, clip: { start: 0, end: 10 } });
    expect(p.clip_start).toBe(0);
    expect(p.clip_end).toBe(10);
    expect(p.aspect_ratio).toBe('9:16');
    expect(p.emojis).toEqual([{ start: 1, end: 1.9, emoji: '💸' }]);   // the 'stop' emoji is outside the short
  });

  it('exports the whole video without a clip and drops emoji when they are off', () => {
    const p = buildExportPayload({ ...base, showEmojis: false });
    expect('clip_start' in p).toBe(false);
    expect('emojis' in p).toBe(false);
  });

  it('keeps only enabled B-roll and maps resolutions to aspect ratios', () => {
    const p = buildExportPayload({ ...base, brollList: [{ id: '1', enabled: true }, { id: '2', enabled: false }] as never });
    expect((p.broll_clips as unknown[]).length).toBe(1);
    expect(aspectForResolution('1920x1080')).toBe('16:9');
    expect(aspectForResolution('1080x1080')).toBe('1:1');
  });
});

describe('runBatchExport', () => {
  const noWait = async () => undefined;

  it('renders every short in order and reports progress', async () => {
    const posts: unknown[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/export')) {
        posts.push(JSON.parse(String(init?.body)));
        return json({ task_id: `t${posts.length}` });
      }
      const id = String(url).split('/').pop();
      return json({ progress: 100, saved_to: `C:/out/${id}.mp4` });
    }) as unknown as typeof fetch;
    const updates: BatchItem[][] = [];
    const clips = [clip('a', 'One', 0, 30), clip('b', 'Two', 40, 70)];
    const out = await runBatchExport({
      clips, fetchImpl, sleep: noWait,
      buildPayload: (c, i) => ({ clip_start: c.start, output_filename: `${i}.mp4` }),
      onUpdate: (items) => updates.push(items),
    });
    expect(posts).toEqual([{ clip_start: 0, output_filename: '1.mp4' }, { clip_start: 40, output_filename: '2.mp4' }]);
    expect(out.map((i) => i.status)).toEqual(['done', 'done']);
    expect(out[1].savedTo).toBe('C:/out/t2.mp4');
    expect(updates[0].every((i) => i.status === 'queued')).toBe(true);
    expect(batchSummary(out)).toEqual({ done: 2, failed: 0, skipped: 0, total: 2 });
  });

  it('a failed short does not stop the next ones', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/export')) return json({ task_id: `t${++n}` });
      return String(url).endsWith('t1') ? json({ progress: 50, error: 'FFmpeg failed' }) : json({ progress: 100, saved_to: 'x' });
    }) as unknown as typeof fetch;
    const out = await runBatchExport({
      clips: [clip('a', 'A', 0, 30), clip('b', 'B', 40, 70)], fetchImpl, sleep: noWait,
      buildPayload: () => ({}), onUpdate: () => undefined,
    });
    expect(out[0]).toMatchObject({ status: 'failed', error: 'FFmpeg failed' });
    expect(out[1].status).toBe('done');
  });

  it('waits and retries when the engine is busy (429)', async () => {
    let posts = 0;
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/export')) return ++posts < 3 ? json({}, 429) : json({ task_id: 't' });
      return json({ progress: 100, saved_to: 'x' });
    }) as unknown as typeof fetch;
    const out = await runBatchExport({ clips: [clip('a', 'A', 0, 30)], fetchImpl, sleep, buildPayload: () => ({}), onUpdate: () => undefined });
    expect(out[0].status).toBe('done');
    expect(posts).toBe(3);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('gives up on a short that never finishes', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith('/api/export') ? json({ task_id: 't' }) : json({ progress: 10 })) as unknown as typeof fetch;
    const out = await runBatchExport({
      clips: [clip('a', 'A', 0, 30)], fetchImpl, buildPayload: () => ({}), onUpdate: () => undefined,
      sleep: noWait, pollMs: 0, timeoutMs: -1,
    });
    expect(out[0]).toMatchObject({ status: 'failed', error: 'Rendering took too long' });
  });

  it('stops when asked and marks the rest as skipped', async () => {
    let stop = false;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/export')) { stop = true; return json({ task_id: 't' }); }
      return json({ progress: 100, saved_to: 'x' });
    }) as unknown as typeof fetch;
    const out = await runBatchExport({
      clips: [clip('a', 'A', 0, 30), clip('b', 'B', 40, 70), clip('c', 'C', 80, 110)], fetchImpl, sleep: noWait,
      buildPayload: () => ({}), onUpdate: () => undefined, shouldStop: () => stop,
    });
    expect(out.map((i) => i.status)).toEqual(['done', 'skipped', 'skipped']);
  });

  it('reports a refused export', async () => {
    const fetchImpl = vi.fn(async () => json({}, 500)) as unknown as typeof fetch;
    const out = await runBatchExport({ clips: [clip('a', 'A', 0, 30)], fetchImpl, sleep: noWait, buildPayload: () => ({}), onUpdate: () => undefined });
    expect(out[0].status).toBe('failed');
    expect(out[0].error).toMatch(/500/);
  });
});
