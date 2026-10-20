import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, cleanPreset, findPreset, makeUserPreset, parsePresetsFile, presetsFileText, USER_CATEGORY } from './presets';
import { useVideoStore } from '../store/useVideoStore';
import { buildProject, parseProject, serializeProject } from './projectFile';

describe('user presets', () => {
  it('saves the style in use with its tweaks', () => {
    const p = makeUserPreset('Mine', BUILTIN_PRESETS[0], { fontSize: 77, primaryColor: '#00FF00' });
    expect(p).toMatchObject({ name: 'Mine', fontSize: 77, primaryColor: '#00FF00', category: USER_CATEGORY });
    expect(p.id.startsWith('user-')).toBe(true);
    expect(p.fontFamily).toBe(BUILTIN_PRESETS[0].fontFamily);
  });

  it('cleans untrusted values instead of trusting them', () => {
    const p = cleanPreset({ name: '  x  ', fontSize: 9999, primaryColor: 'url(javascript:1)', textCasing: 'weird', maxWordsPerBlock: 2.6, bgBox: 'yes' })!;
    expect(p.name).toBe('x');
    expect(p.fontSize).toBe(200);
    expect(p.primaryColor).toBe(BUILTIN_PRESETS[0].primaryColor);
    expect(p.textCasing).toBe(BUILTIN_PRESETS[0].textCasing);
    expect(p.maxWordsPerBlock).toBe(3);
    expect(p.bgBox).toBe(BUILTIN_PRESETS[0].bgBox);
    expect(cleanPreset({ fontSize: 40 })).toBeNull();          // no name
  });

  it('round-trips a presets file and never overwrites presets already there', () => {
    const mine = makeUserPreset('Bold', BUILTIN_PRESETS[0], {});
    const text = presetsFileText([mine]);
    const { presets } = parsePresetsFile(text, [mine]);
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe('Bold (2)');
    expect(presets[0].id).not.toBe(mine.id);
    expect(parsePresetsFile('nope', []).error).toMatch(/not JSON/);
    expect(parsePresetsFile('{"presets": []}', []).error).toMatch(/No presets/);
    expect(parsePresetsFile(JSON.stringify({ name: 'Single', fontSize: 50 }), []).presets[0].name).toBe('Single');
  });

  it('finds built-in and user presets by id, falling back to the first built-in one', () => {
    const mine = makeUserPreset('Mine', BUILTIN_PRESETS[1], {});
    expect(findPreset(mine.id, [mine])).toBe(mine);
    expect(findPreset(BUILTIN_PRESETS[2].id)).toBe(BUILTIN_PRESETS[2]);
    expect(findPreset('missing')).toBe(BUILTIN_PRESETS[0]);
  });
});

describe('user presets in the store and in projects', () => {
  beforeEach(() => useVideoStore.setState({ userPresets: [], activeTemplateId: BUILTIN_PRESETS[0].id, customStyleOverrides: {} }));

  it('saving switches to the new preset; deleting it keeps the look', () => {
    useVideoStore.getState().updateCustomStyle({ fontSize: 91 });
    const id = useVideoStore.getState().saveUserPreset('Ninety-one');
    let s = useVideoStore.getState();
    expect(s.activeTemplateId).toBe(id);
    expect(s.customStyleOverrides).toEqual({});
    expect(findPreset(id, s.userPresets).fontSize).toBe(91);
    s.deleteUserPreset(id);
    s = useVideoStore.getState();
    expect(s.userPresets).toHaveLength(0);
    expect(s.activeTemplateId).toBe(BUILTIN_PRESETS[0].id);
    expect(s.customStyleOverrides.fontSize).toBe(91);
  });

  it('a project using a user preset carries it to another computer', () => {
    const id = useVideoStore.getState().saveUserPreset('Travel');
    const text = serializeProject(buildProject(useVideoStore.getState()));
    useVideoStore.setState({ userPresets: [] });                          // the other computer
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.customPreset?.id).toBe(id);
    useVideoStore.getState().applyProject(parsed.project);
    expect(useVideoStore.getState().userPresets.map((p) => p.name)).toEqual(['Travel']);
    expect(useVideoStore.getState().activeTemplateId).toBe(id);
  });
});
