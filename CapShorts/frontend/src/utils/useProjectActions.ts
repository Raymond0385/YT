import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoStore } from '../store/useVideoStore';
import { buildProject, parseProject, projectFileName, serializeProject } from './projectFile';
import {
  currentProjectFileName, currentProjectHandle, forgetProjectFile, openProjectFile, openProjectFromHandle, saveProjectFile,
} from './projectIO';
import { projectDb } from './projectDb';
import { Draft, isMeaningful, RecentProject, removeRecent, upsertRecent } from './recents';

type Notice = { text: string; kind: 'ok' | 'error' } | null;

/** The parts of the store that make a project "changed" (compared by reference, so it stays cheap). */
const trackedSlices = (s: ReturnType<typeof useVideoStore.getState>) => [
  s.projectTitle, s.transcript, s.clips, s.videoSegments, s.activeTemplateId, s.customStyleOverrides,
  s.brollList, s.aspectRatio, s.videoVolume, s.videoSpeed, s.videoScale, s.videoPosition,
  s.videoFitMode, s.showEmojis, s.glossary, s.exportSettings,
];

const sameSlices = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** How long after the last change the draft is written. */
const AUTOSAVE_DELAY_MS = 4000;

/**
 * Save / Save as / Open for the editing session, with an "unsaved changes" flag, Ctrl+S / Ctrl+O,
 * an automatic draft (so a crash does not lose work), and the list of recent projects.
 */
export function useProjectActions() {
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const savedRef = useRef<unknown[]>(trackedSlices(useVideoStore.getState()));
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  const say = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setNotice({ text, kind });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), kind === 'error' ? 6000 : 3000);
  }, []);

  const refreshRecents = useCallback(async () => {
    setRecents(await projectDb.getRecents());
  }, []);

  /** Remembers a file in the recent list (with its handle when there is one). */
  const rememberFile = useCallback(async (name: string) => {
    const title = useVideoStore.getState().projectTitle;
    const next = upsertRecent(await projectDb.getRecents(), { name, title, openedAt: Date.now(), handle: currentProjectHandle() ?? undefined });
    await projectDb.setRecents(next);
    setRecents(next);
  }, []);

  const writeDraft = useCallback(async () => {
    const state = useVideoStore.getState();
    if (!isMeaningful(state)) return;
    const text = serializeProject(buildProject(state));
    await projectDb.saveDraft({ savedAt: Date.now(), title: state.projectTitle, text, videoName: state.videoFile?.name || state.videoName || '' });
  }, []);

  const markSaved = useCallback(() => {
    savedRef.current = trackedSlices(useVideoStore.getState());
    dirtyRef.current = false;
    setDirty(false);
    setFileName(currentProjectFileName());
    if (draftTimer.current) clearTimeout(draftTimer.current);
    void projectDb.clearDraft();          // everything is in a file now
    setRecovery(null);
  }, []);

  // Track changes, and write the draft a few seconds after the last one
  useEffect(() => {
    const unsubscribe = useVideoStore.subscribe((state) => {
      const changed = !sameSlices(savedRef.current, trackedSlices(state));
      dirtyRef.current = changed;
      setDirty(changed);
      if (changed) {
        if (draftTimer.current) clearTimeout(draftTimer.current);
        draftTimer.current = setTimeout(() => void writeDraft(), AUTOSAVE_DELAY_MS);
      }
    });
    // switching away from the window / closing it: write the draft now instead of waiting
    const flush = () => {
      if (document.visibilityState === 'hidden' && dirtyRef.current) {
        if (draftTimer.current) clearTimeout(draftTimer.current);
        void writeDraft();
      }
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [writeDraft]);

  // On start: load the recent list and offer to restore work that was never saved
  useEffect(() => {
    let alive = true;
    void projectDb.getRecents().then((list) => alive && setRecents(list));
    void projectDb.loadDraft().then((draft) => {
      if (!alive || !draft) return;
      const parsed = parseProject(draft.text);
      if (parsed.ok && isMeaningful(parsed.project)) setRecovery(draft);
      else void projectDb.clearDraft();
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (askWhere = false) => {
    try {
      const state = useVideoStore.getState();
      const text = serializeProject(buildProject(state));
      const saved = await saveProjectFile(text, projectFileName(state.projectTitle), askWhere);
      if (saved) {
        markSaved();
        await rememberFile(saved);
        say(`Project saved: ${saved}`);
      }
    } catch (e: any) {
      say(`Could not save the project: ${e?.message || 'unknown error'}`, 'error');
    }
  }, [markSaved, rememberFile, say]);

  /** Applies the text of a project file; shared by Open and the recent list. */
  const applyFile = useCallback(async (file: { text: string; name: string }) => {
    const parsed = parseProject(file.text);
    if (!parsed.ok) {
      forgetProjectFile();
      say(parsed.error, 'error');
      return false;
    }
    useVideoStore.getState().applyProject(parsed.project);
    markSaved();
    await rememberFile(file.name);
    say(`Opened ${file.name}`);
    return true;
  }, [markSaved, rememberFile, say]);

  const open = useCallback(async () => {
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Open another project and discard them?')) return;
    try {
      const file = await openProjectFile();
      if (file) await applyFile(file);
    } catch (e: any) {
      say(`Could not open the project: ${e?.message || 'unknown error'}`, 'error');
    }
  }, [applyFile, say]);

  const openRecent = useCallback(async (id: string) => {
    const entry = (await projectDb.getRecents()).find((r) => r.id === id);
    if (!entry) return;
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Open another project and discard them?')) return;
    try {
      if (!entry.handle) {
        say(`"${entry.name}" was saved by a browser that cannot reopen it directly. Use Open and pick the file.`, 'error');
        return;
      }
      const file = await openProjectFromHandle(entry.handle);
      if (file) await applyFile(file);
    } catch {
      // the file was moved, deleted or is no longer readable
      const next = removeRecent(await projectDb.getRecents(), id);
      await projectDb.setRecents(next);
      setRecents(next);
      say(`Could not open "${entry.name}". It was removed from the list.`, 'error');
    }
  }, [applyFile, say]);

  const clearRecents = useCallback(async () => {
    await projectDb.setRecents([]);
    setRecents([]);
  }, []);

  /** Brings back the autosaved work. It stays "unsaved" (the draft is not a file), so saving it is one click. */
  const restoreDraft = useCallback(() => {
    if (!recovery) return;
    const parsed = parseProject(recovery.text);
    if (!parsed.ok) {
      say(parsed.error, 'error');
      setRecovery(null);
      void projectDb.clearDraft();
      return;
    }
    useVideoStore.getState().applyProject(parsed.project);
    forgetProjectFile();
    setFileName(null);
    setRecovery(null);
    say('Unsaved work restored. Save it to keep it.');
  }, [recovery, say]);

  const discardDraft = useCallback(() => {
    setRecovery(null);
    void projectDb.clearDraft();
  }, []);

  // Ctrl+S / Shift+Ctrl+S / Ctrl+O
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void save(e.shiftKey);
      } else if (k === 'o') {
        e.preventDefault();
        void open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, open]);

  return {
    save, saveAs: () => save(true), open, openRecent, clearRecents, refreshRecents,
    restoreDraft, discardDraft, recovery, recents, dirty, notice, fileName,
  };
}
