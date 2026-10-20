import { apiUrl } from '../config';

/** A section of CHANGELOG.md: "## [1.4.2] - 2026-10-20" and its text. */
export interface ChangeSection {
  version: string;
  date: string;
  body: string;
}

export interface ReleaseInfo {
  version: string;
  tag: string;
  date: string;
  asset_name: string;
  size_mb: number;
  current: boolean;
  older: boolean;
}

const CHECK_KEY = 'kadr.checkUpdatesOnStart';

export function loadCheckOnStart(): boolean {
  try {
    return localStorage.getItem(CHECK_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveCheckOnStart(on: boolean): void {
  try {
    localStorage.setItem(CHECK_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/** One line of a changelog section, for display. */
export type ChangeLine = { kind: 'heading' | 'item' | 'text'; text: string };

export function changeLines(body: string): ChangeLine[] {
  const out: ChangeLine[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('### ')) out.push({ kind: 'heading', text: line.slice(4).trim() });
    else if (/^[-*] /.test(line)) out.push({ kind: 'item', text: line.slice(2).trim() });
    else if (out.length && out[out.length - 1].kind === 'item' && raw.startsWith('  ')) {
      out[out.length - 1] = { kind: 'item', text: `${out[out.length - 1].text} ${line}` };   // wrapped bullet
    } else out.push({ kind: 'text', text: line });
  }
  return out.map((l) => ({ ...l, text: l.text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1') }));
}

export type UpdateProgress = (state: { phase: 'downloading' | 'launching' | 'launched' | 'error'; progress: number; message?: string }) => void;

/**
 * Downloads an installer (the latest release, or `version` for a rollback) and starts it.
 * The installer closes Kadr itself.
 */
export async function downloadAndInstall(onProgress: UpdateProgress, version?: string, fetchImpl: typeof fetch = fetch,
                                         sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<boolean> {
  try {
    const start = version
      ? await fetchImpl(apiUrl('/api/system/install-version'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }),
        })
      : await fetchImpl(apiUrl('/api/system/download-update'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!start.ok) {
      const err = await start.json().catch(() => ({}));
      onProgress({ phase: 'error', progress: 0, message: err.detail || `The engine refused the download (${start.status})` });
      return false;
    }
    onProgress({ phase: 'downloading', progress: 0 });
    for (;;) {
      await sleep(500);
      const res = await fetchImpl(apiUrl('/api/system/download-update-progress'));
      if (!res.ok) continue;
      const p = await res.json();
      if (p.status === 'error') {
        onProgress({ phase: 'error', progress: p.progress || 0, message: p.error || 'Download failed' });
        return false;
      }
      if (p.status === 'completed') break;
      onProgress({ phase: 'downloading', progress: p.progress || 0 });
    }
    onProgress({ phase: 'launching', progress: 100 });
    const launch = await fetchImpl(apiUrl('/api/system/launch-installer'), { method: 'POST' });
    if (!launch.ok) {
      const err = await launch.json().catch(() => ({}));
      onProgress({ phase: 'error', progress: 100, message: err.detail || 'Could not start the installer' });
      return false;
    }
    onProgress({ phase: 'launched', progress: 100 });
    return true;
  } catch (e: any) {
    onProgress({ phase: 'error', progress: 0, message: e?.message || 'Network error' });
    return false;
  }
}
