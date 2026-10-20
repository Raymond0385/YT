import { apiUrl } from '../config';
import { SubtitlePreset, VideoClip, WordToken } from '../types';
import { runBatchExport } from './batchExport';
import { buildExportPayload } from './exportPayload';
import { ExportAllSettings, exportFileName, pickClips } from './exportAllSettings';

/** One video of the batch and how far it got. */
export interface VideoJob {
  name: string;
  status: 'queued' | 'transcribing' | 'rendering' | 'done' | 'failed' | 'skipped';
  /** 0..100 within the current step */
  progress: number;
  step?: string;
  shorts?: number;
  rendered?: number;
  failed?: number;
  error?: string;
}

export interface TranscribeSettings {
  model: string;
  language: string;
  glossary: string;
  enhanceAudio: boolean;
  groqApiKey: string;
}

export interface VideoQueueOptions {
  files: File[];
  transcribe: TranscribeSettings;
  exportAll: ExportAllSettings;
  preset: SubtitlePreset;
  customStyleOverrides: Partial<SubtitlePreset>;
  onUpdate: (jobs: VideoJob[]) => void;
  shouldStop?: () => boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  /** How long recognition of one video may take (ms) */
  transcribeTimeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Sends a video for recognition and waits for the words, the detected shorts and the engine's copy of the video. */
async function transcribeVideo(file: File, s: TranscribeSettings, f: typeof fetch, sleep: (ms: number) => Promise<void>, pollMs: number,
                               timeoutMs: number, onProgress: (p: number, step: string) => void, shouldStop: () => boolean) {
  const form = new FormData();
  form.append('file', file);
  form.append('model', s.model || 'whisper-large-v3-turbo');
  form.append('language', s.language || 'auto');
  form.append('range_mode', 'full');
  form.append('enhance_audio', s.enhanceAudio ? '1' : '0');
  form.append('retry_weak', '0');
  if (s.glossary.trim()) form.append('glossary', s.glossary);
  if (s.groqApiKey.trim()) form.append('groq_api_key', s.groqApiKey.trim());
  const res = await f(apiUrl('/api/transcribe'), { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Recognition refused (${res.status})`);
  let data = await res.json();
  const videoPath: string | null = data.video_path || null;
  if (!data.words && data.task_id) {
    const started = Date.now();
    for (;;) {
      if (shouldStop()) throw new Error('Stopped');
      if (Date.now() - started > timeoutMs) throw new Error('Recognition took too long');
      await sleep(pollMs);
      const pr = await f(apiUrl(`/api/transcribe/progress/${data.task_id}`));
      if (!pr.ok) continue;
      const p = await pr.json();
      onProgress(p.progress || 0, p.step || 'Recognising speech...');
      if (p.status === 'completed') { data = p; break; }
      if (p.status === 'error' || p.status === 'failed' || p.error) throw new Error(p.error || p.step || 'Recognition failed');
    }
  }
  const words: WordToken[] = (data.words || []).map((w: WordToken, i: number) => ({
    id: `w-${i}`, start: w.start, end: w.end, word: w.word, keyword: Boolean(w.keyword),
  }));
  return { words, clips: (data.clips || []) as VideoClip[], videoPath: data.video_path || videoPath };
}

/**
 * The whole job for a folder of videos, one video after another: recognise the speech, find the shorts
 * (automatic count), and render the chosen ones into the export folder. A failing video does not stop the rest.
 */
export async function runVideoQueue(o: VideoQueueOptions): Promise<VideoJob[]> {
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? defaultSleep;
  const stop = () => !!o.shouldStop?.();
  const jobs: VideoJob[] = o.files.map((file) => ({ name: file.name, status: 'queued', progress: 0 }));
  const publish = () => o.onUpdate(jobs.map((j) => ({ ...j })));
  publish();

  for (let i = 0; i < o.files.length; i++) {
    const job = jobs[i];
    if (stop()) {
      for (let j = i; j < jobs.length; j++) if (jobs[j].status === 'queued') jobs[j].status = 'skipped';
      publish();
      break;
    }
    try {
      job.status = 'transcribing';
      job.step = 'Sending the video...';
      publish();
      const { words, clips, videoPath } = await transcribeVideo(o.files[i], o.transcribe, f, sleep, o.pollMs ?? 1500,
        o.transcribeTimeoutMs ?? 3 * 60 * 60 * 1000, (p, step) => { job.progress = p; job.step = step; publish(); }, stop);
      const chosen = pickClips(clips, o.exportAll.which);
      job.shorts = chosen.length;
      if (!videoPath) throw new Error('The engine did not keep the video');
      if (!chosen.length) {
        job.status = 'done';
        job.step = clips.length ? 'No shorts of the chosen quality' : 'No shorts found';
        publish();
        continue;
      }
      job.status = 'rendering';
      job.progress = 0;
      job.step = `Rendering ${chosen.length} short${chosen.length === 1 ? '' : 's'}...`;
      publish();
      const results = await runBatchExport({
        clips: chosen,
        fetchImpl: f,
        sleep,
        shouldStop: stop,
        buildPayload: (clip, index) => buildExportPayload({
          videoPath,
          transcript: o.exportAll.subtitles ? words : [],
          preset: o.preset,
          customStyleOverrides: o.customStyleOverrides,
          brollList: [],
          showEmojis: o.exportAll.emoji && o.exportAll.subtitles,
          outputFilename: exportFileName(o.exportAll.naming === 'number-title' ? 'video-number-title' : o.exportAll.naming,
                                         index, clip, chosen.length, o.files[i].name),
          resolution: o.exportAll.resolution,
          framing: o.exportAll.framing,
          clip: o.exportAll.hookTitle ? clip : { start: clip.start, end: clip.end },
        }),
        onUpdate: (items) => {
          job.rendered = items.filter((it) => it.status === 'done').length;
          job.failed = items.filter((it) => it.status === 'failed').length;
          job.progress = Math.round(((job.rendered + job.failed) / chosen.length) * 100);
          publish();
        },
      });
      job.rendered = results.filter((r) => r.status === 'done').length;
      job.failed = results.filter((r) => r.status === 'failed').length;
      job.status = job.rendered ? 'done' : 'failed';
      job.step = `${job.rendered} of ${chosen.length} rendered`;
      if (!job.rendered) job.error = results.find((r) => r.error)?.error || 'Nothing rendered';
    } catch (e: any) {
      job.status = stop() ? 'skipped' : 'failed';
      job.error = e?.message || 'Failed';
    }
    publish();
  }
  return jobs;
}
