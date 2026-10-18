import { describe, expect, it } from 'vitest';
import { useVideoStore } from './useVideoStore';

describe('choosing a subtitle preset', () => {
  it('replaces earlier manual style tweaks instead of being overridden by them', () => {
    const s = useVideoStore.getState();
    s.updateCustomStyle({ fontFamily: 'Arial', primaryColor: '#123456' });
    expect(useVideoStore.getState().customStyleOverrides.fontFamily).toBe('Arial');
    s.setActiveTemplate('some-other-preset');
    const after = useVideoStore.getState();
    expect(after.activeTemplateId).toBe('some-other-preset');
    expect(after.customStyleOverrides).toEqual({});
  });
});
