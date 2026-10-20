import { describe, expect, it } from 'vitest';
import { suggestTitle, titleOverlayPayload, titleVisibleAt } from './titleOverlay';
import { buildExportPayload } from './exportPayload';
import { parseProject, serializeProject } from './projectFile';

describe('hook title', () => {
  const clip = { start: 10, end: 40, titleText: ' 3 mistakes ', titleSeconds: 4, titleStyle: 'dark' as const };

  it('is sent with the export of the short, trimmed, and not when empty', () => {
    expect(titleOverlayPayload(clip)).toEqual({ text: '3 mistakes', duration: 4, style: 'dark' });
    expect(titleOverlayPayload({ titleText: '  ' })).toBeNull();
    expect(titleOverlayPayload({ titleText: 'x' })).toEqual({ text: 'x', duration: 3, style: 'box' });
    const p = buildExportPayload({
      videoPath: 'v.mp4', transcript: [], preset: { id: 'p' } as never, customStyleOverrides: {}, brollList: [],
      outputFilename: 'o.mp4', resolution: '1080x1920', showEmojis: false, clip,
    });
    expect(p.title_overlay).toEqual({ text: '3 mistakes', duration: 4, style: 'dark' });
  });

  it('is on screen for its first seconds only', () => {
    expect(titleVisibleAt(clip, 10)).toBe(true);
    expect(titleVisibleAt(clip, 13.9)).toBe(true);
    expect(titleVisibleAt(clip, 14)).toBe(false);
    expect(titleVisibleAt(clip, 9)).toBe(false);
    expect(titleVisibleAt({ ...clip, titleText: '' }, 11)).toBe(false);
  });

  it('suggests the first sentence of the hook, shortened', () => {
    expect(suggestTitle('Why do most people never start? I spent three years')).toBe('Why do most people never start?');
    expect(suggestTitle('one two three four five six seven eight nine ten')).toBe('one two three four five six seven eight...');
  });

  it('is kept in the project file', () => {
    const project = parseProject(JSON.stringify({
      format: 'kadr-project', version: 1, title: 't', video: {}, transcript: [],
      clips: [{ id: 'c', title: 'c', start: 1, end: 5, titleText: 'Hook', titleSeconds: 5, titleStyle: 'outline', tier: 'strong', rank: 2 }],
    }));
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    expect(project.project.clips[0]).toMatchObject({ titleText: 'Hook', titleSeconds: 5, titleStyle: 'outline', tier: 'strong', rank: 2 });
    expect(serializeProject(project.project)).toContain('"titleText": "Hook"');
  });
});
