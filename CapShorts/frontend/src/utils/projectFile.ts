import { WordToken, VideoClip, VideoSegment, BrollClip, SubtitlePreset, AspectRatio, ExportSettings } from '../types';

export const PROJECT_FORMAT = 'kadr-project';
/** Files saved before the app was renamed. */
export const LEGACY_PROJECT_FORMATS = ['capshorts-project'];
/** Newer sections are optional and defaulted on load, so older files keep working without a version bump. */
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.kadr';
/** Extensions the app can open: the current one and the one used before the rename. */
export const PROJECT_OPEN_EXTENSIONS = ['.kadr', '.capshorts'];

export interface ProjectVideoRef {
  name: string;
  size: number;
  lastModified: number;
  duration: number;
}

type PreviewZoom = 'fit' | '50%' | '75%' | '100%';
type InspectorTab = 'text' | 'video' | 'audio' | 'viral';
type SidebarTab = 'presets' | 'broll' | 'clips' | 'inspector';
type TimelineItemType = 'subtitle' | 'video' | 'audio' | null;
type SilenceRegion = { start: number; end: number; duration: number };
type SilenceBackup = { transcript: WordToken[]; duration: number; videoSegments: VideoSegment[] };
type GlossarySet = { name: string; terms: string };

/** Where the user was: playhead, zoom levels, open tabs and selection. */
export interface ProjectView {
  currentTime: number;
  timelineZoom: number;
  previewZoom: PreviewZoom;
  safeAreaGuides: boolean;
  isSnapEnabled: boolean;
  activeInspectorTab: InspectorTab;
  activeTab: SidebarTab;
  libraryTab: string;
  selectedClipId: string | null;
  selectedTimelineItemId: string | null;
  selectedTimelineItemType: TimelineItemType;
}

/**
 * Everything that makes up an editing session, except the video itself, secrets (API keys),
 * folders of this computer and transient state (playing, busy, razor tool).
 */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
  appVersion?: string;
  title: string;
  video: ProjectVideoRef;
  aspectRatio: AspectRatio;
  transcript: WordToken[];
  clips: VideoClip[];
  videoSegments: VideoSegment[];
  activeTemplateId: string;
  customStyleOverrides: Partial<SubtitlePreset>;
  brollList: BrollClip[];
  videoVolume: number;
  videoSpeed: number;
  videoScale: number;
  videoPosition: { x: number; y: number };
  videoFitMode: 'contain' | 'cover';
  showEmojis: boolean;
  selectedLanguage: string;
  selectedModel: string;
  glossary: string;
  glossarySets: GlossarySet[];
  exportSettings: ExportSettings;
  rangeMode: 'full' | 'short_60s' | 'short_180s';
  enhanceAudio: boolean;
  retryWeak: boolean;
  view: ProjectView;
  silence: { regions: SilenceRegion[]; removedDuration: number; backup: SilenceBackup | null };
}

/** The slice of the store a project is built from. */
export interface ProjectSource {
  projectTitle: string;
  videoFile: File | null;
  videoName: string;
  duration: number;
  aspectRatio: AspectRatio;
  transcript: WordToken[];
  clips: VideoClip[];
  videoSegments: VideoSegment[];
  activeTemplateId: string;
  customStyleOverrides: Partial<SubtitlePreset>;
  brollList: BrollClip[];
  videoVolume: number;
  videoSpeed: number;
  videoScale: number;
  videoPosition: { x: number; y: number };
  videoFitMode: 'contain' | 'cover';
  showEmojis: boolean;
  selectedLanguage: string;
  selectedModel: string;
  glossary: string;
  glossarySets: GlossarySet[];
  exportSettings: ExportSettings;
  rangeMode: 'full' | 'short_60s' | 'short_180s';
  enhanceAudio: boolean;
  retryWeak: boolean;
  currentTime: number;
  timelineZoom: number;
  previewZoom: PreviewZoom;
  safeAreaGuides: boolean;
  isSnapEnabled: boolean;
  activeInspectorTab: InspectorTab;
  activeTab: SidebarTab;
  libraryTab: string;
  selectedClipId: string | null;
  selectedTimelineItemId: string | null;
  selectedTimelineItemType: TimelineItemType;
  silenceRegions: SilenceRegion[];
  removedSilenceDuration: number;
  silenceBackup: SilenceBackup | null;
  /** Set while a project is open without its video: keeps the reference to the original file. */
  projectNeedsVideo?: ProjectVideoRef | null;
}

export function buildProject(src: ProjectSource, appVersion?: string): ProjectFile {
  const file = src.videoFile;
  const video: ProjectVideoRef = file
    ? { name: file.name, size: file.size, lastModified: file.lastModified, duration: src.duration }
    : src.projectNeedsVideo ?? { name: src.videoName || '', size: 0, lastModified: 0, duration: src.duration };

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    appVersion,
    title: src.projectTitle,
    video,
    aspectRatio: src.aspectRatio,
    transcript: src.transcript,
    clips: src.clips,
    videoSegments: src.videoSegments,
    activeTemplateId: src.activeTemplateId,
    customStyleOverrides: src.customStyleOverrides,
    brollList: src.brollList,
    videoVolume: src.videoVolume,
    videoSpeed: src.videoSpeed,
    videoScale: src.videoScale,
    videoPosition: src.videoPosition,
    videoFitMode: src.videoFitMode,
    showEmojis: src.showEmojis,
    selectedLanguage: src.selectedLanguage,
    selectedModel: src.selectedModel,
    glossary: src.glossary,
    glossarySets: src.glossarySets,
    exportSettings: src.exportSettings,
    rangeMode: src.rangeMode,
    enhanceAudio: src.enhanceAudio,
    retryWeak: src.retryWeak,
    view: {
      currentTime: src.currentTime,
      timelineZoom: src.timelineZoom,
      previewZoom: src.previewZoom,
      safeAreaGuides: src.safeAreaGuides,
      isSnapEnabled: src.isSnapEnabled,
      activeInspectorTab: src.activeInspectorTab,
      activeTab: src.activeTab,
      libraryTab: src.libraryTab,
      selectedClipId: src.selectedClipId,
      selectedTimelineItemId: src.selectedTimelineItemId,
      selectedTimelineItemType: src.selectedTimelineItemType,
    },
    silence: {
      regions: src.silenceRegions,
      removedDuration: src.removedSilenceDuration,
      backup: src.silenceBackup,
    },
  };
}

export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(project, null, 2);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

function cleanWords(raw: unknown): WordToken[] {
  const stamp = Date.now();
  return (Array.isArray(raw) ? raw : [])
    .filter((w): w is Record<string, unknown> => isObj(w) && isStr(w.word) && isNum(w.start) && isNum(w.end))
    .map((w, i) => ({
      id: isStr(w.id) && w.id ? w.id : `w-${i}-${stamp}`,
      start: Math.max(0, w.start as number),
      end: Math.max(w.start as number, w.end as number),
      word: w.word as string,
      keyword: Boolean(w.keyword),
      confidence: isNum(w.confidence) ? w.confidence : null,
    }));
}

function cleanSegments(raw: unknown): VideoSegment[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((s): s is Record<string, unknown> => isObj(s) && isNum(s.start) && isNum(s.end) && isNum(s.sourceStart) && isNum(s.sourceEnd))
    .map((s, i) => ({
      id: isStr(s.id) && s.id ? s.id : `seg-${i + 1}`,
      name: isStr(s.name) ? s.name : 'Video',
      start: s.start as number,
      end: s.end as number,
      sourceStart: s.sourceStart as number,
      sourceEnd: s.sourceEnd as number,
      duration: isNum(s.duration) ? s.duration : (s.end as number) - (s.start as number),
    }));
}

export type ParseResult = { ok: true; project: ProjectFile } | { ok: false; error: string };

/** Validates and repairs a loaded project file. Never trusts the shape of the input. */
export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a valid Kadr project (cannot read it).' };
  }
  if (!isObj(raw) || (raw.format !== PROJECT_FORMAT && !LEGACY_PROJECT_FORMATS.includes(String(raw.format)))) {
    return { ok: false, error: 'This file is not a Kadr project.' };
  }
  if (!isNum(raw.version) || raw.version < 1) {
    return { ok: false, error: 'The project file has no valid version.' };
  }
  if (raw.version > PROJECT_VERSION) {
    return { ok: false, error: 'This project was saved by a newer version of Kadr. Update the app to open it.' };
  }

  const stamp = Date.now();
  const words = cleanWords(raw.transcript);

  const clips: VideoClip[] = (Array.isArray(raw.clips) ? raw.clips : [])
    .filter((c): c is Record<string, unknown> => isObj(c) && isNum(c.start) && isNum(c.end) && (c.end as number) > (c.start as number))
    .map((c, i) => ({
      id: isStr(c.id) && c.id ? c.id : `clip-${i}-${stamp}`,
      title: isStr(c.title) ? c.title : 'Short',
      hook: isStr(c.hook) ? c.hook : '',
      start: c.start as number,
      end: c.end as number,
      duration: isNum(c.duration) ? c.duration : Math.round(((c.end as number) - (c.start as number)) * 10) / 10,
      virality_score: isNum(c.virality_score) ? c.virality_score : 0,
      keywords: Array.isArray(c.keywords) ? c.keywords.filter(isStr) : [],
      transcript_snippet: isStr(c.transcript_snippet) ? c.transcript_snippet : '',
      custom: Boolean(c.custom),
    }));

  const segments = cleanSegments(raw.videoSegments);
  const video = isObj(raw.video) ? raw.video : {};
  const aspect = raw.aspectRatio === '16:9' || raw.aspectRatio === '1:1' ? raw.aspectRatio : '9:16';
  const pos = isObj(raw.videoPosition) ? raw.videoPosition : {};
  const v = isObj(raw.view) ? raw.view : {};
  const sil = isObj(raw.silence) ? raw.silence : {};

  const regions = (Array.isArray(sil.regions) ? sil.regions : [])
    .filter((r): r is Record<string, unknown> => isObj(r) && isNum(r.start) && isNum(r.end))
    .map((r) => ({
      start: r.start as number,
      end: r.end as number,
      duration: isNum(r.duration) ? r.duration : (r.end as number) - (r.start as number),
    }));

  const backupRaw = isObj(sil.backup) ? sil.backup : null;
  const backup: SilenceBackup | null = backupRaw
    ? { transcript: cleanWords(backupRaw.transcript), duration: isNum(backupRaw.duration) ? backupRaw.duration : 0, videoSegments: cleanSegments(backupRaw.videoSegments) }
    : null;

  const glossarySets = (Array.isArray(raw.glossarySets) ? raw.glossarySets : [])
    .filter((g): g is Record<string, unknown> => isObj(g) && isStr(g.name) && isStr(g.terms) && g.name.trim() !== '')
    .map((g) => ({ name: g.name as string, terms: g.terms as string }));

  const selType = oneOf<'subtitle' | 'video' | 'audio' | 'none'>(v.selectedTimelineItemType, ['subtitle', 'video', 'audio', 'none'], 'none');
  const selId = isStr(v.selectedTimelineItemId) && selType !== 'none' ? v.selectedTimelineItemId : null;

  const project: ProjectFile = {
    format: PROJECT_FORMAT, // always written with the current name, even when an old file was opened
    version: raw.version,
    savedAt: isStr(raw.savedAt) ? raw.savedAt : '',
    appVersion: isStr(raw.appVersion) ? raw.appVersion : undefined,
    title: isStr(raw.title) && raw.title.trim() ? raw.title : 'Imported project',
    video: {
      name: isStr(video.name) ? video.name : '',
      size: isNum(video.size) ? video.size : 0,
      lastModified: isNum(video.lastModified) ? video.lastModified : 0,
      duration: isNum(video.duration) ? video.duration : 0,
    },
    aspectRatio: aspect as AspectRatio,
    transcript: words,
    clips,
    videoSegments: segments,
    activeTemplateId: isStr(raw.activeTemplateId) ? raw.activeTemplateId : '',
    customStyleOverrides: isObj(raw.customStyleOverrides) ? (raw.customStyleOverrides as Partial<SubtitlePreset>) : {},
    brollList: Array.isArray(raw.brollList) ? (raw.brollList.filter(isObj) as unknown as BrollClip[]) : [],
    videoVolume: isNum(raw.videoVolume) ? raw.videoVolume : 1,
    videoSpeed: isNum(raw.videoSpeed) && raw.videoSpeed > 0 ? raw.videoSpeed : 1,
    videoScale: isNum(raw.videoScale) ? raw.videoScale : 1,
    videoPosition: { x: isNum(pos.x) ? pos.x : 0, y: isNum(pos.y) ? pos.y : 0 },
    videoFitMode: raw.videoFitMode === 'cover' ? 'cover' : 'contain',
    showEmojis: raw.showEmojis !== false,
    selectedLanguage: isStr(raw.selectedLanguage) ? raw.selectedLanguage : 'auto',
    selectedModel: isStr(raw.selectedModel) ? raw.selectedModel : 'whisper-large-v3-turbo',
    glossary: isStr(raw.glossary) ? raw.glossary : '',
    glossarySets,
    exportSettings: (isObj(raw.exportSettings) ? raw.exportSettings : {}) as unknown as ExportSettings,
    rangeMode: oneOf(raw.rangeMode, ['full', 'short_60s', 'short_180s'] as const, 'full'),
    enhanceAudio: raw.enhanceAudio !== false,
    retryWeak: raw.retryWeak === true,
    view: {
      currentTime: isNum(v.currentTime) && v.currentTime >= 0 ? v.currentTime : 0,
      timelineZoom: isNum(v.timelineZoom) ? Math.max(15, Math.min(180, v.timelineZoom)) : 60,
      previewZoom: oneOf(v.previewZoom, ['fit', '50%', '75%', '100%'] as const, 'fit'),
      safeAreaGuides: v.safeAreaGuides === true,
      isSnapEnabled: v.isSnapEnabled !== false,
      activeInspectorTab: oneOf(v.activeInspectorTab, ['text', 'video', 'audio', 'viral'] as const, 'text'),
      activeTab: oneOf(v.activeTab, ['presets', 'broll', 'clips', 'inspector'] as const, 'presets'),
      libraryTab: oneOf(v.libraryTab, ['youtube', 'media', 'captions', 'text', 'audio', 'broll', 'shorts'] as const, 'captions'),
      selectedClipId: isStr(v.selectedClipId) && clips.some((c) => c.id === v.selectedClipId) ? v.selectedClipId : null,
      selectedTimelineItemId: selId,
      selectedTimelineItemType: selId ? (selType as TimelineItemType) : null,
    },
    silence: {
      regions,
      removedDuration: isNum(sil.removedDuration) ? sil.removedDuration : 0,
      backup,
    },
  };
  return { ok: true, project };
}

/** True if `file` is (very likely) the video the project was made with. */
export function videoMatches(ref: ProjectVideoRef, file: { name: string; size: number }): boolean {
  if (!ref.name) return false;
  return ref.name === file.name && (ref.size === 0 || ref.size === file.size);
}

/** A safe file name for the project, with the .capshorts extension. */
export function projectFileName(title: string): string {
  const base = (title || 'project').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 80);
  return `${base || 'project'}${PROJECT_EXTENSION}`;
}
