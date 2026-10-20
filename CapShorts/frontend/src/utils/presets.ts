import templatesData from '../data/templates.json';
import { SubtitlePreset } from '../types';

/** Built-in subtitle styles. */
export const BUILTIN_PRESETS = templatesData as SubtitlePreset[];

export const USER_CATEGORY = 'My presets';
export const USER_PREFIX = 'user-';
const STORAGE_KEY = 'kadr.userPresets';
const FILE_FORMAT = 'kadr-presets';
export const MAX_USER_PRESETS = 100;

export const isUserPreset = (id: string | null | undefined) => !!id && id.startsWith(USER_PREFIX);

/** The preset with this id among the built-in and the user's presets (the first built-in one if missing). */
export function findPreset(id: string | null | undefined, userPresets: SubtitlePreset[] = []): SubtitlePreset {
  return userPresets.find((p) => p.id === id) || BUILTIN_PRESETS.find((p) => p.id === id) || BUILTIN_PRESETS[0];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const color = (v: unknown, fallback: string) => (isStr(v) && /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]{3,40}\))$/.test(v.trim()) ? v.trim() : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const clamp = (v: unknown, lo: number, hi: number, fallback: number) => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** A safe preset from untrusted data (an imported file, a project): unknown values fall back to defaults. */
export function cleanPreset(raw: unknown, id?: string): SubtitlePreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const base = BUILTIN_PRESETS[0];
  const name = isStr(r.name) ? r.name.trim().slice(0, 60) : '';
  if (!name) return null;
  return {
    id: id ?? (isStr(r.id) && r.id.startsWith(USER_PREFIX) ? r.id.slice(0, 80) : `${USER_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`),
    name,
    category: USER_CATEGORY,
    fontFamily: isStr(r.fontFamily) && r.fontFamily.trim() ? r.fontFamily.trim().slice(0, 60) : base.fontFamily,
    fontSize: clamp(r.fontSize, 12, 200, base.fontSize),
    fontWeight: clamp(r.fontWeight, 100, 900, base.fontWeight),
    primaryColor: color(r.primaryColor, base.primaryColor),
    highlightColor: color(r.highlightColor, base.highlightColor),
    outlineWidth: clamp(r.outlineWidth, 0, 20, base.outlineWidth),
    outlineColor: color(r.outlineColor, base.outlineColor),
    shadowDepth: clamp(r.shadowDepth, 0, 20, base.shadowDepth),
    shadowColor: color(r.shadowColor, base.shadowColor),
    textCasing: oneOf(r.textCasing, ['UPPERCASE', 'Title Case', 'lowercase', 'Default'] as const, base.textCasing),
    maxWordsPerBlock: Math.round(clamp(r.maxWordsPerBlock, 1, 12, base.maxWordsPerBlock)),
    animationTrigger: oneOf(r.animationTrigger, ['pop', 'bounce', 'fade', 'none'] as const, base.animationTrigger),
    position: oneOf(r.position, ['bottom-center', 'middle-center', 'top-center'] as const, base.position),
    bgBox: typeof r.bgBox === 'boolean' ? r.bgBox : base.bgBox,
    bgBoxColor: color(r.bgBoxColor, base.bgBoxColor),
    karaokeSweep: typeof r.karaokeSweep === 'boolean' ? r.karaokeSweep : base.karaokeSweep,
  };
}

/** A new user preset from the preset in use plus the user's tweaks. */
export function makeUserPreset(name: string, from: SubtitlePreset, overrides: Partial<SubtitlePreset>, now = Date.now()): SubtitlePreset {
  return cleanPreset({ ...from, ...overrides, name }, `${USER_PREFIX}${now}-${Math.floor(Math.random() * 1e6)}`)!;
}

export function loadUserPresets(): SubtitlePreset[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(list) ? list.map((p) => cleanPreset(p, isStr(p?.id) && p.id.startsWith(USER_PREFIX) ? p.id : undefined)).filter((p): p is SubtitlePreset => !!p) : [];
  } catch {
    return [];
  }
}

export function storeUserPresets(list: SubtitlePreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_USER_PRESETS)));
  } catch {
    /* storage unavailable or full */
  }
}

/** Lets the user save a presets file (native dialog when the WebView has one, a download otherwise). */
export async function savePresetsFile(text: string, suggestedName = 'my-kadr-presets.json'): Promise<boolean> {
  const w = window as Window & { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }> };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName, types: [{ description: 'Kadr presets', accept: { 'application/json': ['.json'] } }] });
      const out = await handle.createWritable();
      await out.write(text);
      await out.close();
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

/** Text of a presets file (.kadr-presets.json). */
export function presetsFileText(list: SubtitlePreset[]): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, presets: list.map(({ category: _c, ...p }) => p) }, null, 2);
}

/**
 * Presets from a file: a presets file, a single preset, or a list. New ids are given so an import never
 * replaces presets that are already there; a name already taken gets " (2)".
 */
export function parsePresetsFile(text: string, existing: SubtitlePreset[]): { presets: SubtitlePreset[]; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { presets: [], error: 'This is not a presets file (not JSON).' };
  }
  const items: unknown[] = Array.isArray(data) ? data
    : data && typeof data === 'object' && Array.isArray((data as { presets?: unknown[] }).presets) ? (data as { presets: unknown[] }).presets
    : [data];
  const names = new Set(existing.map((p) => p.name.toLowerCase()));
  const out: SubtitlePreset[] = [];
  items.forEach((item, i) => {
    const p = cleanPreset(item, `${USER_PREFIX}${Date.now()}-${i}-${Math.floor(Math.random() * 1e6)}`);
    if (!p) return;
    let name = p.name;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${p.name} (${n})`;
    names.add(name.toLowerCase());
    out.push({ ...p, name });
  });
  return out.length ? { presets: out } : { presets: [], error: 'No presets found in this file.' };
}
