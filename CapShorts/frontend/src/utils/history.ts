/**
 * Undo / redo for a state store.
 *
 * Works on snapshots of chosen keys. Store updates are immutable, so a snapshot is just a set of references
 * (cheap even for a 15 000-word transcript). Changes that arrive close together (typing, dragging a slider)
 * are merged into one history step.
 */

export interface HistoryOptions<S> {
  getState: () => S;
  setState: (partial: Partial<S>) => void;
  /** zustand-style subscribe: the listener gets the new and the previous state. */
  subscribe: (listener: (state: S, prev: S) => void) => () => void;
  /** Keys restored by undo/redo. */
  keys: (keyof S)[];
  /** Keys that are restored but never start a history step on their own (e.g. a duration measured on load). */
  passiveKeys?: (keyof S)[];
  /** Changes closer together than this (ms) form a single step. */
  quietMs?: number;
  /** Maximum number of steps kept. */
  limit?: number;
}

export interface History {
  undo: () => boolean;
  redo: () => boolean;
  /** Forget everything (new video, opened project). */
  clear: () => void;
  /** Run `fn` without recording what it changes. */
  withoutRecording: <T>(fn: () => T) => T;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Notified whenever canUndo / canRedo may have changed. Returns an unsubscribe function. */
  onChange: (cb: () => void) => () => void;
  dispose: () => void;
}

type Snapshot<S> = Partial<S>;

export function createHistory<S>(opts: HistoryOptions<S>): History {
  const quietMs = opts.quietMs ?? 500;
  const limit = opts.limit ?? 100;
  const passive = new Set<keyof S>(opts.passiveKeys ?? []);
  const triggerKeys = opts.keys.filter((k) => !passive.has(k));
  const allKeys = Array.from(new Set<keyof S>([...opts.keys, ...passive]));

  const undoStack: Snapshot<S>[] = [];
  const redoStack: Snapshot<S>[] = [];
  const listeners = new Set<() => void>();
  let burstBase: Snapshot<S> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let muted = 0;

  const pick = (state: S): Snapshot<S> => {
    const out: Snapshot<S> = {};
    for (const k of allKeys) out[k] = state[k];
    return out;
  };
  const sameSnapshot = (a: Snapshot<S>, b: Snapshot<S>) => allKeys.every((k) => a[k] === b[k]);
  const notify = () => listeners.forEach((cb) => cb());

  const commit = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!burstBase) return;
    const base = burstBase;
    burstBase = null;
    if (sameSnapshot(base, pick(opts.getState()))) return; // changed and changed back
    undoStack.push(base);
    if (undoStack.length > limit) undoStack.shift();
    redoStack.length = 0;
    notify();
  };

  const unsubscribe = opts.subscribe((state, prev) => {
    if (muted > 0) return;
    if (!triggerKeys.some((k) => state[k] !== prev[k])) return;
    const startsStep = !burstBase;
    if (!burstBase) burstBase = pick(prev);
    if (startsStep) notify();
    if (timer) clearTimeout(timer);
    timer = setTimeout(commit, quietMs);
  });

  const apply = (snapshot: Snapshot<S>) => {
    muted++;
    try {
      opts.setState(snapshot);
    } finally {
      muted--;
    }
  };

  return {
    undo() {
      commit();
      const target = undoStack.pop();
      if (!target) return false;
      redoStack.push(pick(opts.getState()));
      apply(target);
      notify();
      return true;
    },
    redo() {
      commit();
      const target = redoStack.pop();
      if (!target) return false;
      undoStack.push(pick(opts.getState()));
      apply(target);
      notify();
      return true;
    },
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      burstBase = null;
      const had = undoStack.length > 0 || redoStack.length > 0;
      undoStack.length = 0;
      redoStack.length = 0;
      if (had) notify();
    },
    withoutRecording<T>(fn: () => T): T {
      muted++;
      try {
        return fn();
      } finally {
        muted--;
      }
    },
    canUndo: () => undoStack.length > 0 || burstBase !== null,
    canRedo: () => redoStack.length > 0,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      unsubscribe();
      listeners.clear();
    },
  };
}
