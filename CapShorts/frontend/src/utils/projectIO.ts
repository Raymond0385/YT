import { PROJECT_OPEN_EXTENSIONS } from './projectFile';

/**
 * Reading and writing project files in the browser/WebView.
 * Uses the File System Access API (native Save/Open dialogs) when it exists, and plain downloads/<input> otherwise.
 */

type PickerWindow = Window & {
  showSaveFilePicker?: (options: unknown) => Promise<FileHandle>;
  showOpenFilePicker?: (options: unknown) => Promise<FileHandle[]>;
};

interface FileHandle {
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: Blob | string) => Promise<void>; close: () => Promise<void> }>;
}

const FILE_TYPES = [
  { description: 'Kadr project', accept: { 'application/json': PROJECT_OPEN_EXTENSIONS } },
];

/** The file the project was last saved to / opened from: lets Ctrl+S overwrite it without asking again. */
let currentHandle: FileHandle | null = null;

export function forgetProjectFile() {
  currentHandle = null;
}

export function currentProjectFileName(): string | null {
  return currentHandle?.name ?? null;
}

/** The handle of the current project file, to store it in the recent list. */
export function currentProjectHandle(): unknown {
  return currentHandle;
}

/**
 * Reopens a file from a remembered handle. The browser asks for permission again once per session.
 * Returns null if the permission was refused.
 */
export async function openProjectFromHandle(handle: unknown): Promise<{ text: string; name: string } | null> {
  const h = handle as FileHandle & { requestPermission?: (o: { mode: string }) => Promise<string> };
  if (typeof h.requestPermission === 'function') {
    const state = await h.requestPermission({ mode: 'readwrite' });
    if (state !== 'granted') return null;
  }
  const file = await h.getFile();
  currentHandle = h;
  return { text: await file.text(), name: file.name };
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/**
 * Saves `text`. Without a known file (or with askWhere) it asks where to save.
 * Returns the saved file name, or null if the user cancelled.
 */
export async function saveProjectFile(text: string, suggestedName: string, askWhere: boolean): Promise<string | null> {
  const w = window as PickerWindow;

  if (w.showSaveFilePicker) {
    try {
      let handle = currentHandle;
      if (!handle || askWhere) {
        handle = await w.showSaveFilePicker({ suggestedName, types: FILE_TYPES });
      }
      const writable = await handle!.createWritable();
      await writable.write(text);
      await writable.close();
      currentHandle = handle;
      return handle!.name;
    } catch (e) {
      if (isAbort(e)) return null;
      // the remembered file may be gone or read-only: fall back to asking
      if (currentHandle && !askWhere) {
        currentHandle = null;
        return saveProjectFile(text, suggestedName, true);
      }
      throw e;
    }
  }

  // Fallback: a normal download into the browser's download folder
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return suggestedName;
}

/** Lets the user choose a project file. Returns its text and name, or null if cancelled. */
export async function openProjectFile(): Promise<{ text: string; name: string } | null> {
  const w = window as PickerWindow;

  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
      const file = await handle.getFile();
      currentHandle = handle;
      return { text: await file.text(), name: file.name };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_OPEN_EXTENSIONS.join(',')},application/json`;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        currentHandle = null;
        resolve({ text: await file.text(), name: file.name });
      } catch (e) {
        reject(e);
      }
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
