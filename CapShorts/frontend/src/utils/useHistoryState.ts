import { useCallback, useSyncExternalStore } from 'react';
import { history } from '../store/useVideoStore';

/** Whether undo / redo currently have something to do (re-renders when that changes). */
export function useHistoryState() {
  const subscribe = useCallback((cb: () => void) => history.onChange(cb), []);
  const read = () => (history.canUndo() ? 1 : 0) | (history.canRedo() ? 2 : 0);
  const flags = useSyncExternalStore(subscribe, read, read);
  return { canUndo: (flags & 1) !== 0, canRedo: (flags & 2) !== 0 };
}
