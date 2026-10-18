import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoStore } from '../store/useVideoStore';
import { buildProject, parseProject, projectFileName, serializeProject } from './projectFile';
import { currentProjectFileName, forgetProjectFile, openProjectFile, saveProjectFile } from './projectIO';

type Notice = { text: string; kind: 'ok' | 'error' } | null;

/** The parts of the store that make a project "changed" (compared by reference, so it stays cheap). */
const trackedSlices = (s: ReturnType<typeof useVideoStore.getState>) => [
  s.projectTitle, s.transcript, s.clips, s.videoSegments, s.activeTemplateId, s.customStyleOverrides,
  s.brollList, s.aspectRatio, s.videoVolume, s.videoSpeed, s.videoScale, s.videoPosition,
  s.videoFitMode, s.showEmojis, s.glossary, s.exportSettings,
];

const sameSlices = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Save / Save as / Open for the editing session, with an "unsaved changes" flag and Ctrl+S / Ctrl+O. */
export function useProjectActions() {
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const savedRef = useRef<unknown[]>(trackedSlices(useVideoStore.getState()));
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setNotice({ text, kind });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), kind === 'error' ? 6000 : 3000);
  }, []);

  const markSaved = useCallback(() => {
    savedRef.current = trackedSlices(useVideoStore.getState());
    setDirty(false);
    setFileName(currentProjectFileName());
  }, []);

  useEffect(() => {
    const unsubscribe = useVideoStore.subscribe((state) => {
      setDirty(!sameSlices(savedRef.current, trackedSlices(state)));
    });
    return () => {
      unsubscribe();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const save = useCallback(async (askWhere = false) => {
    try {
      const state = useVideoStore.getState();
      const text = serializeProject(buildProject(state));
      const saved = await saveProjectFile(text, projectFileName(state.projectTitle), askWhere);
      if (saved) {
        markSaved();
        say(`Project saved: ${saved}`);
      }
    } catch (e: any) {
      say(`Could not save the project: ${e?.message || 'unknown error'}`, 'error');
    }
  }, [markSaved, say]);

  const open = useCallback(async () => {
    if (dirty && !window.confirm('You have unsaved changes. Open another project and discard them?')) return;
    try {
      const file = await openProjectFile();
      if (!file) return;
      const parsed = parseProject(file.text);
      if (!parsed.ok) {
        forgetProjectFile();
        say(parsed.error, 'error');
        return;
      }
      useVideoStore.getState().applyProject(parsed.project);
      markSaved();
      say(`Opened ${file.name}`);
    } catch (e: any) {
      say(`Could not open the project: ${e?.message || 'unknown error'}`, 'error');
    }
  }, [dirty, markSaved, say]);

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

  return { save, saveAs: () => save(true), open, dirty, notice, fileName };
}
