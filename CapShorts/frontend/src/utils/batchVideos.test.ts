import { describe, expect, it, vi } from 'vitest';
import { runVideoQueue, VideoJob } from './batchVideos';
import { DEFAULT_EXPORT_ALL, exportFileName, pickClips } from './exportAllSettings';
import { VideoClip } from '../types';

const clip = (id: string, start: number, score: number, tier?: VideoClip['tier']): VideoClip => ({
  id, title: `Short ${id}`, hook: '', start, end: start + 20, duration: 20, virality_score: score, keywords: [], transcript_snippet: '', tier,
});
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('export-all settings', () => {
  it('picks shorts by quality, in time order', () => {
    const list = [clip('b', 50, 80, 'strong'), clip('a', 10, 65, 'good'), clip('c', 90, 40)];
    expect(pickClips(list, 'all').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(pickClips(list, 'strong').map((c) => c.id)).toEqual(['b']);
    expect(pickClips(list, 'good').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('names files the chosen way', () => {
    expect(exportFileName('number-title', 2, { title: 'Hook!' }, 12)).toBe('02 - Hook!.mp4');
    expect(exportFileName('title', 2, { title: 'Hook!' }, 12)).toBe('Hook!.mp4');
    expect(exportFileName('video-number-title', 2, { title: 'Hook' }, 3, 'My talk: part 1.mp4')).toBe('My talk part 1 - 02 - Hook.mp4');
  });
});

describe('a folder of videos', () => {
  const noWait = async () => undefined;
  const preset = { id: 'p' } as never;

  it('recognises, finds shorts and renders the chosen ones for each video', async () => {
    const exports: Record<string, unknown>[] = [];
    let task = 0;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/transcribe')) return json({ task_id: `t${++task}`, video_path: `input_${task}.mp4` });
      if (u.includes('/api/transcribe/progress/')) {
        return json({ status: 'completed', progress: 100, video_path: u.endsWith('t1') ? 'input_1.mp4' : 'input_2.mp4',
          words: [{ word: 'hi', start: 11, end: 11.3 }], clips: [clip('x', 10, 80, 'strong'), clip('y', 40, 60, 'fair')] });
      }
      if (u.endsWith('/api/export')) { exports.push(JSON.parse(String(init?.body))); return json({ task_id: `e${exports.length}` }); }
      return json({ progress: 100, saved_to: 'C:/out/x.mp4' });
    }) as unknown as typeof fetch;
    const updates: VideoJob[][] = [];
    const jobs = await runVideoQueue({
      files: [new File(['a'], 'One.mp4'), new File(['b'], 'Two.mp4')],
      transcribe: { model: 'base', language: 'ru', glossary: '', enhanceAudio: false, groqApiKey: '' },
      exportAll: { ...DEFAULT_EXPORT_ALL, which: 'strong', framing: 'blur' },
      preset, customStyleOverrides: {}, onUpdate: (j) => updates.push(j), fetchImpl: f, sleep: noWait, pollMs: 0,
    });
    expect(jobs.map((j) => [j.status, j.shorts, j.rendered])).toEqual([['done', 1, 1], ['done', 1, 1]]);
    expect(exports.map((e) => e.output_filename)).toEqual(['One - 01 - Short x.mp4', 'Two - 01 - Short x.mp4']);
    expect(exports[0]).toMatchObject({ video_path: 'input_1.mp4', clip_start: 10, framing: 'blur', resolution: '1080x1920' });
    expect(updates.some((u) => u[0].status === 'transcribing')).toBe(true);
  });

  it('a video that fails does not stop the next one; subtitles can be left out', async () => {
    let n = 0;
    const exports: Record<string, unknown>[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/transcribe')) return ++n === 1 ? json({}, 500) : json({ words: [{ word: 'w', start: 1, end: 2 }], clips: [clip('z', 0, 90)], video_path: 'v.mp4' });
      if (u.endsWith('/api/export')) { exports.push(JSON.parse(String(init?.body))); return json({ task_id: 'e' }); }
      return json({ progress: 100, saved_to: 'x' });
    }) as unknown as typeof fetch;
    const jobs = await runVideoQueue({
      files: [new File(['a'], 'Bad.mp4'), new File(['b'], 'Good.mp4')],
      transcribe: { model: 'base', language: 'auto', glossary: '', enhanceAudio: false, groqApiKey: '' },
      exportAll: { ...DEFAULT_EXPORT_ALL, subtitles: false }, preset, customStyleOverrides: {}, onUpdate: () => undefined, fetchImpl: f, sleep: noWait,
    });
    expect(jobs[0]).toMatchObject({ status: 'failed', error: 'Recognition refused (500)' });
    expect(jobs[1]).toMatchObject({ status: 'done', rendered: 1 });
    expect(exports[0].transcript).toEqual([]);
    expect('emojis' in exports[0]).toBe(false);
  });
});
