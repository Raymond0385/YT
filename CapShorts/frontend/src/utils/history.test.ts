import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, StoreApi } from 'zustand/vanilla';
import { createHistory, History } from './history';

interface S {
  title: string;
  words: string[];
  duration: number;
  playhead: number;
}

let store: StoreApi<S>;
let h: History;

const make = (quietMs = 500, limit = 100) => {
  store = createStore<S>(() => ({ title: 'a', words: ['x'], duration: 10, playhead: 0 }));
  h = createHistory<S>({
    getState: store.getState,
    setState: (p) => store.setState(p),
    subscribe: (l) => store.subscribe(l),
    keys: ['title', 'words'],
    passiveKeys: ['duration'],
    quietMs,
    limit,
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  make();
});
afterEach(() => {
  h.dispose();
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTime(600);

describe('history', () => {
  it('undoes and redoes one change', () => {
    store.setState({ title: 'b' });
    settle();
    expect(h.canUndo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(store.getState().title).toBe('a');
    expect(h.canRedo()).toBe(true);
    expect(h.redo()).toBe(true);
    expect(store.getState().title).toBe('b');
    expect(h.canRedo()).toBe(false);
  });

  it('merges quick successive changes into one step', () => {
    for (const t of ['b', 'bc', 'bcd']) {
      store.setState({ title: t });
      vi.advanceTimersByTime(100);
    }
    settle();
    h.undo();
    expect(store.getState().title).toBe('a'); // one step back, not three
    expect(h.canUndo()).toBe(false);
  });

  it('keeps separate steps when the changes are far apart', () => {
    store.setState({ title: 'b' });
    settle();
    store.setState({ title: 'c' });
    settle();
    h.undo();
    expect(store.getState().title).toBe('b');
    h.undo();
    expect(store.getState().title).toBe('a');
  });

  it('can undo straight away, before the quiet period ends', () => {
    store.setState({ words: ['x', 'y'] });
    expect(h.canUndo()).toBe(true);
    h.undo();
    expect(store.getState().words).toEqual(['x']);
  });

  it('a new change after an undo drops the redo steps', () => {
    store.setState({ title: 'b' });
    settle();
    h.undo();
    expect(h.canRedo()).toBe(true);
    store.setState({ title: 'z' });
    settle();
    expect(h.canRedo()).toBe(false);
  });

  it('does not record a change that is changed back within the same burst', () => {
    const original = store.getState().words;
    store.setState({ words: ['x', 'y'] });
    store.setState({ words: original });
    settle();
    expect(h.canUndo()).toBe(false);
  });

  it('ignores keys it does not track', () => {
    store.setState({ playhead: 5 });
    settle();
    expect(h.canUndo()).toBe(false);
  });

  it('passive keys do not start a step but are restored with one', () => {
    store.setState({ duration: 20 });
    settle();
    expect(h.canUndo()).toBe(false);
    store.setState({ words: ['x', 'y'], duration: 30 });
    settle();
    h.undo();
    expect(store.getState().duration).toBe(20);
  });

  it('withoutRecording hides a change from the history', () => {
    h.withoutRecording(() => store.setState({ title: 'silent' }));
    settle();
    expect(h.canUndo()).toBe(false);
    expect(store.getState().title).toBe('silent');
  });

  it('clear forgets everything, including a pending step', () => {
    store.setState({ title: 'b' });
    settle();
    store.setState({ title: 'c' });
    h.clear();
    settle();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBe(false);
  });

  it('keeps at most `limit` steps', () => {
    h.dispose();
    make(10, 3);
    for (let i = 1; i <= 6; i++) {
      store.setState({ title: `t${i}` });
      vi.advanceTimersByTime(50);
    }
    let steps = 0;
    while (h.undo()) steps++;
    expect(steps).toBe(3);
    expect(store.getState().title).toBe('t3');
  });

  it('notifies listeners when availability changes', () => {
    const cb = vi.fn();
    const off = h.onChange(cb);
    store.setState({ title: 'b' });
    settle();
    expect(cb).toHaveBeenCalled();
    cb.mockClear();
    h.undo();
    expect(cb).toHaveBeenCalled();
    off();
    cb.mockClear();
    h.redo();
    expect(cb).not.toHaveBeenCalled();
  });

  it('undo/redo with nothing to do returns false and changes nothing', () => {
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(false);
    expect(store.getState().title).toBe('a');
  });
});
