import { apiUrl } from '../config';
import { VideoClip } from '../types';

export type BatchStatus = 'queued' | 'rendering' | 'done' | 'failed' | 'skipped';

export interface BatchItem {
  clipId: string;
  title: string;
  status: BatchStatus;
  progress: number;
  savedTo?: string;
  error?: string;
}

export interface BatchOptions {
  clips: VideoClip[];
  /** Body of POST /api/export for one short (index starts at 1). */
  buildPayload: (clip: VideoClip, index: number) => Record<string, unknown>;
  onUpdate: (items: BatchItem[]) => void;
  shouldStop?: () => boolean;
  /** Replaceable for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  /** How long one short may take before it is given up (ms). */
  timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Renders the shorts one after another (the engine allows a limited number of simultaneous exports),
 * saving each into the export folder. A failed short does not stop the others.
 */
export async function runBatchExport(opts: BatchOptions): Promise<BatchItem[]> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const pollMs = opts.pollMs ?? 700;
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;

  const items: BatchItem[] = opts.clips.map((c) => ({ clipId: c.id, title: c.title, status: 'queued', progress: 0 }));
  const publish = () => opts.onUpdate(items.map((i) => ({ ...i })));
  publish();

  for (let i = 0; i < opts.clips.length; i++) {
    const item = items[i];
    if (opts.shouldStop?.()) {
      for (let j = i; j < items.length; j++) items[j].status = 'skipped';
      publish();
      break;
    }

    item.status = 'rendering';
    publish();
    try {
      let taskId = '';
      // Busy engine (429): wait and ask again for a while
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await f(apiUrl('/api/export'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts.buildPayload(opts.clips[i], i + 1)),
        });
        if (res.status === 429) {
          await sleep(3000);
          continue;
        }
        if (!res.ok) throw new Error(`The engine refused the export (code ${res.status})`);
        taskId = (await res.json()).task_id;
        break;
      }
      if (!taskId) throw new Error('The engine is busy, try again later');

      const started = Date.now();
      for (;;) {
        await sleep(pollMs);
        if (Date.now() - started > timeoutMs) throw new Error('Rendering took too long');
        const r = await f(apiUrl(`/api/export/progress/${taskId}`));
        if (!r.ok) continue;
        const d = await r.json();
        if (d.error || String(d.status || '').toLowerCase().includes('error')) throw new Error(d.error || 'Render failed');
        item.progress = Math.max(item.progress, Number(d.progress) || 0);
        publish();
        if (Number(d.progress) >= 100) {
          item.status = 'done';
          item.progress = 100;
          item.savedTo = d.saved_to || undefined;
          if (!d.saved_to && d.save_error) item.error = d.save_error;
          break;
        }
      }
    } catch (e) {
      item.status = 'failed';
      item.error = e instanceof Error ? e.message : String(e);
    }
    publish();
  }
  return items.map((i) => ({ ...i }));
}

export function batchSummary(items: BatchItem[]) {
  const count = (s: BatchStatus) => items.filter((i) => i.status === s).length;
  return { done: count('done'), failed: count('failed'), skipped: count('skipped'), total: items.length };
}
