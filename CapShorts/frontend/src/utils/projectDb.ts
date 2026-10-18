import { Draft, RecentProject } from './recents';

/**
 * Where the autosave draft and the recent-projects list live: the browser's IndexedDB (it survives a crash or a
 * closed window and can hold file handles). Every call is safe to make when IndexedDB is missing or blocked:
 * it then quietly does nothing.
 */
export interface ProjectDb {
  saveDraft(draft: Draft): Promise<void>;
  loadDraft(): Promise<Draft | null>;
  clearDraft(): Promise<void>;
  getRecents(): Promise<RecentProject[]>;
  setRecents(list: RecentProject[]): Promise<void>;
}

const DB_NAME = 'kadr-projects';
const STORE = 'kv';
const DRAFT_KEY = 'draft';
const RECENTS_KEY = 'recents';

/** `factory`: omit for the browser's IndexedDB, pass null to run without any storage (tests, blocked storage). */
export function createProjectDb(factoryArg?: IDBFactory | null): ProjectDb {
  const factory: IDBFactory | null = factoryArg === undefined ? (typeof indexedDB !== 'undefined' ? indexedDB : null) : factoryArg;
  let opened: Promise<IDBDatabase | null> | null = null;

  const open = (): Promise<IDBDatabase | null> => {
    if (!factory) return Promise.resolve(null);
    if (!opened) {
      opened = new Promise((resolve) => {
        try {
          const req = factory.open(DB_NAME, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return opened;
  };

  const get = async <T>(key: string): Promise<T | null> => {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  };

  const put = async (key: string, value: unknown): Promise<boolean> => {
    const db = await open();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false); // e.g. a value that cannot be cloned
      }
    });
  };

  const del = async (key: string): Promise<void> => {
    const db = await open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  };

  return {
    async saveDraft(draft) {
      await put(DRAFT_KEY, draft);
    },
    async loadDraft() {
      const d = await get<Draft>(DRAFT_KEY);
      return d && typeof d.text === 'string' && typeof d.savedAt === 'number' ? d : null;
    },
    async clearDraft() {
      await del(DRAFT_KEY);
    },
    async getRecents() {
      const list = await get<RecentProject[]>(RECENTS_KEY);
      return Array.isArray(list) ? list.filter((r) => r && typeof r.name === 'string') : [];
    },
    async setRecents(list) {
      // handles are kept when the browser can store them, otherwise only the names
      if (!(await put(RECENTS_KEY, list))) {
        await put(RECENTS_KEY, list.map(({ handle: _handle, ...rest }) => rest));
      }
    },
  };
}

export const projectDb = createProjectDb();
