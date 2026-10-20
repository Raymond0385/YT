import { useEffect, useState } from 'react';
import { apiUrl } from '../config';
import { useVideoStore } from '../store/useVideoStore';
import { ensureOnEngine } from './videoKeeper';

/** The camera path the export uses (backend/reframe.py plan_reframe, via /api/reframe/plan). */
export interface ReframePlan {
  mode: 'follow' | 'blur' | 'none';
  reason?: string;
  crop_w?: number;
  crop_h?: number;
  xs?: number[];
  rate?: number;
  src_w: number;
  src_h: number;
  start: number;
}

/**
 * Left edge of the crop window (source pixels) at source time `t`. The render switches the crop with sendcmd
 * at each step, so this holds the value of the last step instead of blending between steps.
 */
export function cropXAt(plan: ReframePlan, t: number): number {
  const xs = plan.xs || [];
  if (!xs.length) return 0;
  const i = Math.floor(Math.max(0, t - plan.start) * (plan.rate || 10) + 1e-6);
  return xs[Math.min(xs.length - 1, i)];
}

/** Position and size of the video element so the crop window fills a stage of the given height. */
export function followLayout(plan: ReframePlan, t: number, stageH: number) {
  const scale = stageH / (plan.crop_h || plan.src_h);
  return { width: plan.src_w * scale, height: plan.src_h * scale, left: -cropXAt(plan, t) * scale };
}

const cache = new Map<string, Promise<ReframePlan | null>>();

/** Fetches (once per short and range) the camera path for the short; uploads the video first if needed. */
export function useReframePlan(clip: { start: number; end: number } | null, enabled: boolean) {
  const videoFile = useVideoStore((s) => s.videoFile);
  const serverVideoPath = useVideoStore((s) => s.serverVideoPath);
  const [plan, setPlan] = useState<ReframePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const start = clip?.start;
  const end = clip?.end;

  useEffect(() => {
    setPlan(null);
    if (!enabled || start === undefined || end === undefined || !videoFile) return;
    let alive = true;
    // the trim being dragged changes the range many times a second: wait until it settles
    const timer = setTimeout(() => {
      setLoading(true);
      const key = `${videoFile.name}:${videoFile.size}:${start}:${end}`;
      let job = cache.get(key);
      if (!job) {
        job = (async () => {
          const path = await ensureOnEngine(videoFile, serverVideoPath);
          if (!path) return null;
          const res = await fetch(apiUrl('/api/reframe/plan'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_path: path, start, end }),
          });
          return res.ok ? ((await res.json()) as ReframePlan) : null;
        })().catch(() => null);
        cache.set(key, job);
        void job.then((p) => { if (!p) cache.delete(key); });
      }
      void job.then((p) => {
        if (alive) {
          setPlan(p);
          setLoading(false);
        }
      });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
      setLoading(false);
    };
  }, [enabled, start, end, videoFile, serverVideoPath]);

  return { plan, loading };
}
