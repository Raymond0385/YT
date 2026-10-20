import { beforeEach, describe, expect, it } from 'vitest';
import { cleanTracks, fadeFactor, itemMediaTime, moveItem, newItem, tracksPayload, trimItem } from './tracks';
import { buildExportPayload, editFromState } from './exportPayload';
import { useVideoStore } from '../store/useVideoStore';
import { buildProject, parseProject, serializeProject } from './projectFile';

const media = { name: 'music.mp3', mediaId: 'a'.repeat(24), path: 'input_1.mp3', duration: 30 };

describe('track items', () => {
  it('trims from the start keeping what is under the playhead, never past the media', () => {
    const it0 = { ...newItem('audio', media, 10), sourceStart: 2, duration: 20 };
    const s = trimItem(it0, 'start', 13);
    expect([s.start, s.sourceStart, s.duration]).toEqual([13, 5, 17]);
    expect(trimItem(it0, 'start', 0).start).toBe(8);                 // only 2 s of media before the in-point
    expect(trimItem(it0, 'end', 99).duration).toBe(28);              // the media is 30 s long, in-point at 2
    expect(trimItem(it0, 'end', 10.05).duration).toBe(0.2);          // minimum length
    expect(moveItem(it0, -5).start).toBe(0);
  });

  it('knows its media time and fades', () => {
    const it0 = { ...newItem('video', media, 10), duration: 10, sourceStart: 3, fadeIn: 2, fadeOut: 4 };
    expect(itemMediaTime(it0, 12)).toBe(5);
    expect(itemMediaTime(it0, 20)).toBeNull();
    expect(fadeFactor(it0, 11)).toBe(0.5);
    expect(fadeFactor(it0, 18)).toBe(0.5);
    expect(fadeFactor(it0, 14)).toBe(1);
  });

  it('cleans tracks read from a file', () => {
    const tracks = cleanTracks([
      { kind: 'audio', name: 'Music', volume: 9, items: [{ id: 'i', mediaId: 'b'.repeat(24), start: -4, duration: 5, volume: 0.5 }, { start: 1 }] },
      { kind: 'nope' },
      { kind: 'video', items: [{ path: '../../etc/passwd', start: 1, duration: 2 }] },
    ]);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({ kind: 'audio', volume: 3 });
    expect(tracks[0].items).toHaveLength(1);                          // the item without media is dropped
    expect(tracks[0].items[0].start).toBe(0);
    expect(tracks[1].items).toHaveLength(0);                          // a path outside the engine's folder is refused
  });
});

describe('the export carries the timeline edit', () => {
  beforeEach(() => useVideoStore.setState({
    extraTracks: [], fadeIn: 0, fadeOut: 0, videoSpeed: 1, videoVolume: 1,
    videoSegments: [{ id: 's1', name: 's', start: 0, end: 10, sourceStart: 0, sourceEnd: 10, duration: 10 }],
  }));

  it('cuts, speed, volume, fades and tracks', () => {
    const st = useVideoStore.getState();
    const tid = st.addTrack('audio');
    st.addTrackItem(tid, media, 4);
    st.setFade('in', 1.5);
    useVideoStore.setState({
      videoSpeed: 1.25, videoVolume: 0.5,
      videoSegments: [
        { id: 'a', name: 'a', start: 0, end: 5, sourceStart: 0, sourceEnd: 5, duration: 5 },
        { id: 'b', name: 'b', start: 5, end: 9, sourceStart: 8, sourceEnd: 12, duration: 4 },
      ],
    });
    const p = buildExportPayload({
      videoPath: 'v.mp4', transcript: [], preset: { id: 'p' } as never, customStyleOverrides: {}, brollList: [],
      outputFilename: 'o.mp4', resolution: '1920x1080', showEmojis: false, edit: editFromState(useVideoStore.getState()),
    });
    expect(p.segments).toEqual([{ sourceStart: 0, sourceEnd: 5 }, { sourceStart: 8, sourceEnd: 12 }]);
    expect([p.speed, p.volume, p.fade_in, p.fade_out]).toEqual([1.25, 0.5, 1.5, undefined]);
    expect((p.tracks as { items: { start: number; mediaId: string }[] }[])[0].items[0]).toMatchObject({ start: 4, mediaId: 'a'.repeat(24) });
  });

  it('leaves the defaults out', () => {
    const p = buildExportPayload({
      videoPath: 'v.mp4', transcript: [], preset: { id: 'p' } as never, customStyleOverrides: {}, brollList: [],
      outputFilename: 'o.mp4', resolution: '1920x1080', showEmojis: false, edit: editFromState(useVideoStore.getState()),
    });
    expect('speed' in p || 'volume' in p || 'tracks' in p || 'fade_in' in p).toBe(false);
    expect(tracksPayload([{ id: 't', kind: 'video', name: 'v', muted: false, volume: 1, items: [] }])).toEqual([]);
  });

  it('tracks and fades are kept in the project', () => {
    const st = useVideoStore.getState();
    const tid = st.addTrack('video');
    st.addTrackItem(tid, media, 2);
    st.setFade('out', 2);
    const parsed = parseProject(serializeProject(buildProject(useVideoStore.getState())));
    expect(parsed.ok && parsed.project.extraTracks[0].items[0].start).toBe(2);
    expect(parsed.ok && parsed.project.fadeOut).toBe(2);
  });
});
