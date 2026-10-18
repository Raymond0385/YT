import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProjectDb, ProjectDb } from './projectDb';
import { Draft, isMeaningful, MAX_RECENTS, removeRecent, RecentProject, timeAgo, upsertRecent } from './recents';

const draft = (over: Partial<Draft> = {}): Draft => ({ savedAt: 1000, title: 'T', text: '{"a":1}', videoName: 'v.mp4', ...over });
const recent = (name: string, openedAt: number): Omit<RecentProject, 'id'> => ({ name, title: name, openedAt });

describe('recents logic', () => {
  it('puts the newest first and keeps one entry per file name', () => {
    let list: RecentProject[] = [];
    list = upsertRecent(list, recent('a.kadr', 1));
    list = upsertRecent(list, recent('b.kadr', 2));
    list = upsertRecent(list, recent('A.kadr', 3));         // same file, different case: moves to the top
    expect(list.map((r) => r.name)).toEqual(['A.kadr', 'b.kadr']);
    expect(new Set(list.map((r) => r.id)).size).toBe(2);
  });

  it('keeps at most the limit', () => {
    let list: RecentProject[] = [];
    for (let i = 0; i < MAX_RECENTS + 5; i++) list = upsertRecent(list, recent(`p${i}.kadr`, i));
    expect(list).toHaveLength(MAX_RECENTS);
    expect(list[0].name).toBe(`p${MAX_RECENTS + 4}.kadr`);
  });

  it('removes one entry', () => {
    const list = upsertRecent(upsertRecent([], recent('a.kadr', 1)), recent('b.kadr', 2));
    expect(removeRecent(list, list[0].id).map((r) => r.name)).toEqual(['a.kadr']);
  });

  it('knows when a draft is worth offering', () => {
    expect(isMeaningful({ transcript: [], clips: [] })).toBe(false);
    expect(isMeaningful({ transcript: [1], clips: [] })).toBe(true);
    expect(isMeaningful({ transcript: [], clips: [1] })).toBe(true);
  });

  it('describes how old something is, in two languages', () => {
    const now = 10 * 24 * 3600 * 1000;
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 2 * 24 * 3600_000, now)).toBe('2 d ago');
    expect(timeAgo(now - 5 * 60_000, now, 'ru')).toBe('5 мин назад');
    expect(timeAgo(now, now, 'ru')).toBe('только что');
    expect(timeAgo(now + 5000, now)).toBe('just now');       // a clock slightly ahead is not "negative"
  });
});

describe('project db', () => {
  let db: ProjectDb;
  beforeEach(() => {
    db = createProjectDb(new IDBFactory());
  });

  it('stores, replaces and clears the draft', async () => {
    expect(await db.loadDraft()).toBeNull();
    await db.saveDraft(draft());
    expect(await db.loadDraft()).toEqual(draft());
    await db.saveDraft(draft({ savedAt: 2000, title: 'newer' }));
    expect((await db.loadDraft())?.title).toBe('newer');
    await db.clearDraft();
    expect(await db.loadDraft()).toBeNull();
  });

  it('stores the recent list', async () => {
    expect(await db.getRecents()).toEqual([]);
    const list = upsertRecent(upsertRecent([], recent('a.kadr', 1)), recent('b.kadr', 2));
    await db.setRecents(list);
    expect((await db.getRecents()).map((r) => r.name)).toEqual(['b.kadr', 'a.kadr']);
  });

  it('keeps the names when a file handle cannot be stored', async () => {
    const uncloneable = { name: 'h', getFile: () => undefined };        // functions cannot be structured-cloned
    const list = upsertRecent([], { ...recent('a.kadr', 1), handle: uncloneable });
    await db.setRecents(list);
    const back = await db.getRecents();
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe('a.kadr');
    expect(back[0].handle).toBeUndefined();
  });

  it('ignores a damaged draft record', async () => {
    const raw = createProjectDb(new IDBFactory());
    await raw.saveDraft({ savedAt: 'x', text: 5 } as unknown as Draft);
    expect(await raw.loadDraft()).toBeNull();
  });

  it('does nothing, without errors, when IndexedDB is not available', async () => {
    const none = createProjectDb(null);
    await none.saveDraft(draft());
    await none.setRecents([]);
    expect(await none.loadDraft()).toBeNull();
    expect(await none.getRecents()).toEqual([]);
    await none.clearDraft();
  });
});
