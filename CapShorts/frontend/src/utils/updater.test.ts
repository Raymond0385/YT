import { describe, expect, it, vi } from 'vitest';
import { changeLines, downloadAndInstall } from './updater';

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('changeLines', () => {
  it('turns a changelog section into headings and items, joining wrapped bullets', () => {
    const body = '### Added\n- **Shorts** track\n  that wraps\n- `engine` fix\n\nPlain text';
    expect(changeLines(body)).toEqual([
      { kind: 'heading', text: 'Added' },
      { kind: 'item', text: 'Shorts track that wraps' },
      { kind: 'item', text: 'engine fix' },
      { kind: 'text', text: 'Plain text' },
    ]);
  });
});

describe('downloadAndInstall', () => {
  const noWait = async () => undefined;

  it('downloads the latest release, then starts the installer', async () => {
    const calls: string[] = [];
    let polls = 0;
    const f = vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('progress')) return json(++polls < 2 ? { status: 'downloading', progress: 40 } : { status: 'completed', progress: 100 });
      return json({ success: true });
    }) as unknown as typeof fetch;
    const phases: string[] = [];
    expect(await downloadAndInstall((p) => phases.push(p.phase), undefined, f, noWait)).toBe(true);
    expect(calls[0]).toContain('/api/system/download-update');
    expect(calls[calls.length - 1]).toContain('/api/system/launch-installer');
    expect(phases).toEqual(['downloading', 'downloading', 'launching', 'launched']);
  });

  it('asks for a given version when rolling back, and reports errors', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('install-version')) {
        expect(JSON.parse(String(init?.body))).toEqual({ version: '1.4.1' });
        return json({}, 200);
      }
      return json({ status: 'error', error: 'disk full' });
    }) as unknown as typeof fetch;
    const seen: { phase: string; message?: string }[] = [];
    expect(await downloadAndInstall((p) => seen.push(p), '1.4.1', f, noWait)).toBe(false);
    expect(seen[seen.length - 1]).toMatchObject({ phase: 'error', message: 'disk full' });

    const refused = vi.fn(async () => json({ detail: 'No installer for that version' }, 404)) as unknown as typeof fetch;
    const last: { message?: string }[] = [];
    expect(await downloadAndInstall((p) => last.push(p), '0.0.1', refused, noWait)).toBe(false);
    expect(last[0].message).toBe('No installer for that version');
  });
});
