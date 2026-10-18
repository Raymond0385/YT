import { describe, expect, it } from 'vitest';
import { buildEmojiEvents } from './emojiEvents';
import { getEmojiForWord, getEmojiForWords } from './emojiHelper';
import { WordToken } from '../types';

const W = (word: string, start: number, end: number): WordToken => ({ id: `${word}-${start}`, word, start, end, keyword: false });

describe('emoji lookup', () => {
  it('knows English and Russian words', () => {
    expect(getEmojiForWord('Money!')).toBe('💸');
    expect(getEmojiForWord('деньги,')).toBe('💸');
    expect(getEmojiForWord('Секрет')).toBe('🤫');
    expect(getEmojiForWord('ёлка')).toBeNull();
    expect(getEmojiForWord('никогда')).toBe('🙅');
    expect(getEmojiForWord('')).toBeNull();
  });

  it('takes the first matching word of a block', () => {
    expect(getEmojiForWords([W('это', 0, 1), W('огонь', 1, 2), W('деньги', 2, 3)])).toBe('🔥');
    expect(getEmojiForWords([W('это', 0, 1), W('так', 1, 2)])).toBeNull();
  });
});

describe('buildEmojiEvents', () => {
  const words = [
    W('Stop', 0.0, 0.4), W('now', 0.45, 0.8),          // block 1: stop sign
    W('make', 1.0, 1.3), W('money', 1.35, 1.8),        // block 2: money
    W('fast', 2.0, 2.3), W('please', 2.35, 2.7),       // block 3: fast
    W('hello', 3.0, 3.3), W('there', 3.35, 3.6),       // block 4: nothing
  ];

  it('creates one event per block that has an emoji, with the preview timing', () => {
    const ev = buildEmojiEvents(words, 2);
    expect(ev).toEqual([
      { start: 0, end: 0.8, emoji: '🛑' },
      { start: 1, end: 1.8, emoji: '💸' },
      { start: 2, end: 2.7, emoji: '⚡' },
    ]);
  });

  it('joins neighbouring blocks that show the same emoji', () => {
    const same = [W('money', 0, 0.3), W('x', 0.35, 0.6), W('money', 0.65, 0.9), W('y', 0.95, 1.2)];
    expect(buildEmojiEvents(same, 2)).toEqual([{ start: 0, end: 1.2, emoji: '💸' }]);
  });

  it('keeps blocks apart when there is a real gap', () => {
    const gap = [W('money', 0, 0.3), W('x', 0.35, 0.6), W('money', 5, 5.3), W('y', 5.35, 5.6)];
    expect(buildEmojiEvents(gap, 2)).toHaveLength(2);
  });

  it('gives very short blocks at least 0.3 s', () => {
    const ev = buildEmojiEvents([W('fire', 4, 4.05)], 1);
    expect(ev).toEqual([{ start: 4, end: 4.3, emoji: '🔥' }]);
  });

  it('limits events to a range (a short being exported)', () => {
    const ev = buildEmojiEvents(words, 2, { start: 0.9, end: 2.1 });
    expect(ev.map((e) => e.emoji)).toEqual(['💸', '⚡']);
  });

  it('copes with empty input and odd block sizes', () => {
    expect(buildEmojiEvents([], 2)).toEqual([]);
    expect(buildEmojiEvents(words, 0)).toHaveLength(buildEmojiEvents(words, 1).length);
    expect(buildEmojiEvents(words, 2.9)).toEqual(buildEmojiEvents(words, 2));
  });
});
