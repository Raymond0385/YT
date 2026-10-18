import { describe, expect, it } from 'vitest';
import {
  buildProject,
  parseProject,
  projectFileName,
  serializeProject,
  videoMatches,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  ProjectSource,
} from './projectFile';

const source = (over: Partial<ProjectSource> = {}): ProjectSource => ({
  projectTitle: 'My Viral Short 01',
  videoFile: { name: 'talk.mp4', size: 12345, lastModified: 1700000000000 } as unknown as File,
  videoName: 'talk.mp4',
  duration: 62.5,
  aspectRatio: '9:16',
  transcript: [
    { id: 'w1', start: 0.1, end: 0.5, word: 'Hello', keyword: false, confidence: 0.9 },
    { id: 'w2', start: 0.6, end: 1.1, word: 'мир', keyword: true, confidence: null },
  ],
  clips: [
    { id: 'c1', title: 'First', hook: 'Hello мир', start: 0, end: 30, duration: 30, virality_score: 88, keywords: ['мир'], transcript_snippet: 'Hello мир' },
  ],
  videoSegments: [{ id: 'seg-1', name: 'talk.mp4', start: 0, end: 62.5, sourceStart: 0, sourceEnd: 62.5, duration: 62.5 }],
  activeTemplateId: 'tpl-1',
  customStyleOverrides: { fontSize: 60 },
  brollList: [],
  videoVolume: 0.8,
  videoSpeed: 1.25,
  videoScale: 1,
  videoPosition: { x: 3, y: -4 },
  videoFitMode: 'cover',
  showEmojis: false,
  selectedLanguage: 'ru',
  selectedModel: 'turbo',
  glossary: 'ChatGPT, Kubernetes',
  exportSettings: { resolution: '1080x1920', fps: 30, crf: 20, outputFormat: 'mp4' },
  ...over,
});

describe('project file', () => {
  it('round-trips everything that matters', () => {
    const text = serializeProject(buildProject(source(), '1.2.0'));
    const res = parseProject(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.project;
    expect(p.format).toBe(PROJECT_FORMAT);
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.title).toBe('My Viral Short 01');
    expect(p.video).toEqual({ name: 'talk.mp4', size: 12345, lastModified: 1700000000000, duration: 62.5 });
    expect(p.transcript.map((w) => w.word)).toEqual(['Hello', 'мир']);
    expect(p.transcript[1].keyword).toBe(true);
    expect(p.transcript[0].confidence).toBe(0.9);
    expect(p.clips[0].title).toBe('First');
    expect(p.customStyleOverrides).toEqual({ fontSize: 60 });
    expect(p.aspectRatio).toBe('9:16');
    expect(p.videoSpeed).toBe(1.25);
    expect(p.videoFitMode).toBe('cover');
    expect(p.showEmojis).toBe(false);
    expect(p.selectedLanguage).toBe('ru');
    expect(p.glossary).toBe('ChatGPT, Kubernetes');
    expect(p.exportSettings.fps).toBe(30);
  });

  it('never writes API keys or other secrets', () => {
    const polluted = { ...source(), groqApiKey: 'gsk_secret_value_123456', pexelsKey: 'secret2' } as unknown as ProjectSource;
    const text = serializeProject(buildProject(polluted));
    expect(text).not.toContain('gsk_secret');
    expect(text).not.toContain('secret2');
    expect(text.toLowerCase()).not.toContain('apikey');
  });

  it('keeps the video reference of a project that is open without its video', () => {
    const ref = { name: 'orig.mp4', size: 99, lastModified: 5, duration: 10 };
    const p = buildProject(source({ videoFile: null, videoName: '', projectNeedsVideo: ref }));
    expect(p.video).toEqual(ref);
  });

  it('rejects files that are not projects', () => {
    expect(parseProject('not json').ok).toBe(false);
    expect(parseProject('[]').ok).toBe(false);
    expect(parseProject('{"format":"something-else","version":1}').ok).toBe(false);
    const r = parseProject('{"format":"capshorts-project"}');
    expect(r.ok).toBe(false);
  });

  it('refuses projects from a newer app version', () => {
    const r = parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION + 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer version/i);
  });

  it('repairs damaged data instead of crashing', () => {
    const damaged = {
      format: PROJECT_FORMAT,
      version: 1,
      title: '   ',
      transcript: [
        { word: 'ok', start: 1, end: 2 },
        { word: 'bad', start: 'x', end: 2 },
        { start: 1, end: 2 },
        null,
        { word: 'swapped', start: 5, end: 3 },
      ],
      clips: [{ start: 5, end: 3 }, { start: 1, end: 9, title: 'good' }, 'junk'],
      videoSegments: [{ start: 0, end: 5 }, { start: 0, end: 5, sourceStart: 0, sourceEnd: 5 }],
      aspectRatio: '4:3',
      videoSpeed: -2,
      videoPosition: 'nope',
      videoFitMode: 'weird',
      exportSettings: 5,
      brollList: [1, { id: 'b' }],
    };
    const r = parseProject(JSON.stringify(damaged));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.project;
    expect(p.title).toBe('Imported project');
    expect(p.transcript.map((w) => w.word)).toEqual(['ok', 'swapped']);
    expect(p.transcript[1].end).toBeGreaterThanOrEqual(p.transcript[1].start);
    expect(p.transcript.every((w) => typeof w.id === 'string' && w.id.length > 0)).toBe(true);
    expect(p.clips).toHaveLength(1);
    expect(p.clips[0].title).toBe('good');
    expect(p.videoSegments).toHaveLength(1);
    expect(p.aspectRatio).toBe('9:16');
    expect(p.videoSpeed).toBe(1);
    expect(p.videoPosition).toEqual({ x: 0, y: 0 });
    expect(p.videoFitMode).toBe('contain');
    expect(p.brollList).toHaveLength(1);
  });

  it('matches the video by name and size', () => {
    const ref = { name: 'talk.mp4', size: 12345, lastModified: 1, duration: 5 };
    expect(videoMatches(ref, { name: 'talk.mp4', size: 12345 })).toBe(true);
    expect(videoMatches(ref, { name: 'talk.mp4', size: 999 })).toBe(false);
    expect(videoMatches(ref, { name: 'other.mp4', size: 12345 })).toBe(false);
    expect(videoMatches({ ...ref, size: 0 }, { name: 'talk.mp4', size: 999 })).toBe(true);
    expect(videoMatches({ ...ref, name: '' }, { name: '', size: 0 })).toBe(false);
  });

  it('builds a safe file name', () => {
    expect(projectFileName('My Viral Short 01')).toBe('My Viral Short 01.capshorts');
    expect(projectFileName('a/b\\c:d*e?.')).toBe('a b c d e.capshorts');
    expect(projectFileName('')).toBe('project.capshorts');
    expect(projectFileName('   ')).toBe('project.capshorts');
    expect(projectFileName('x'.repeat(200)).length).toBeLessThanOrEqual(80 + '.capshorts'.length);
  });
});
