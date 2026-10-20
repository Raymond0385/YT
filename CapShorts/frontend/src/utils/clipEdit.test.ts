import { beforeEach, describe, expect, it } from 'vitest';
import { clampRange, moveRange, snapToWord, splitRange, wordIndexesInRange } from './clipEdit';
import { useVideoStore } from '../store/useVideoStore';
import { VideoClip, WordToken } from '../types';

const words: WordToken[] = [
  { id: 'a', word: 'one', start: 1, end: 1.4, keyword: false },
  { id: 'b', word: 'two', start: 1.5, end: 1.9, keyword: true },
  { id: 'c', word: 'three', start: 5, end: 5.5, keyword: false },
];

describe('range helpers', () => {
  it('clamps a range into the video and keeps it at least one second long', () => {
    expect(clampRange(-2, 0.5, 10, 'end')).toEqual([0, 1]);
    expect(clampRange(9.5, 12, 10, 'start')).toEqual([9, 10]);
  });

  it('moves a range keeping its length, never past the ends', () => {
    expect(moveRange(2, 5, 4, 20)).toEqual([4, 7]);
    expect(moveRange(2, 5, -3, 20)).toEqual([0, 3]);
    expect(moveRange(2, 5, 19, 20)).toEqual([17, 20]);
  });

  it('splits a range, refusing cuts that leave a part under one second', () => {
    expect(splitRange(0, 10, 4)).toEqual([[0, 4], [4, 10]]);
    expect(splitRange(0, 10, 0.5)).toBeNull();
    expect(splitRange(0, 10, 9.6)).toBeNull();
  });

  it('snaps to word edges and finds the words of a range', () => {
    expect(snapToWord(words, 1.45, 'start')).toBe(1.5);
    expect(snapToWord(words, 1.45, 'end')).toBe(1.4);
    expect(snapToWord(words, 3.3, 'start')).toBe(3.3);
    expect(wordIndexesInRange(words, 1, 2)).toEqual([0, 1]);
  });
});

describe('editing shorts in the store', () => {
  const clip = (id: string, start: number, end: number): VideoClip => ({
    id, title: id, hook: '', start, end, duration: end - start, virality_score: 50, keywords: [], transcript_snippet: '',
  });

  beforeEach(() => {
    useVideoStore.setState({ transcript: words, duration: 30, clips: [clip('x', 0, 6), clip('y', 10, 20)], selectedClipId: null });
  });

  it('moves a short, refreshing its hook and keeping the list in time order', () => {
    useVideoStore.getState().moveClip('x', 22);
    const clips = useVideoStore.getState().clips;
    expect(clips.map((c) => c.id)).toEqual(['y', 'x']);
    expect(clips[1]).toMatchObject({ start: 22, end: 28, custom: true, hook: '' });
    useVideoStore.getState().moveClip('x', 0.8);
    expect(useVideoStore.getState().clips[0]).toMatchObject({ id: 'x', start: 0.8, hook: 'one two three' });
  });

  it('duplicates a short next to the original and selects the copy', () => {
    const id = useVideoStore.getState().duplicateClip('x');
    const s = useVideoStore.getState();
    expect(s.clips.map((c) => c.id)).toEqual(['x', id, 'y']);
    expect(s.selectedClipId).toBe(id);
    expect(s.clips[1]).toMatchObject({ start: 0, end: 6, title: 'x (copy)' });
    expect(useVideoStore.getState().duplicateClip('missing')).toBeNull();
  });

  it('splits a short in two at a time inside it', () => {
    expect(useVideoStore.getState().splitClip('x', 3)).toBe(true);
    const clips = useVideoStore.getState().clips;
    expect(clips.map((c) => [c.start, c.end])).toEqual([[0, 3], [3, 6], [10, 20]]);
    expect(clips[0].id).toBe('x');
    expect(clips[0].hook).toBe('one two');
    expect(clips[1].hook).toBe('three');
    expect(useVideoStore.getState().splitClip('y', 10.2)).toBe(false);
  });
});
