import { WordToken, VideoClip, VideoSegment, BrollClip, SubtitlePreset, AspectRatio, ExportSettings } from '../types';

export const PROJECT_FORMAT = 'capshorts-project';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.capshorts';

export interface ProjectVideoRef {
  name: string;
  size: number;
  lastModified: number;
  duration: number;
}

/** Everything that makes up an editing session, except the video itself and secrets (API keys). */
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
  exportSettings: ExportSettings;
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
  exportSettings: ExportSettings;
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
    exportSettings: src.exportSettings,
  };
}

export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(project, null, 2);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type ParseResult = { ok: true; project: ProjectFile } | { ok: false; error: string };

/** Validates and repairs a loaded project file. Never trusts the shape of the input. */
export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a valid CapShorts project (cannot read it).' };
  }
  if (!isObj(raw) || raw.format !== PROJECT_FORMAT) {
    return { ok: false, error: 'This file is not a CapShorts project.' };
  }
  if (!isNum(raw.version) || raw.version < 1) {
    return { ok: false, error: 'The project file has no valid version.' };
  }
  if (raw.version > PROJECT_VERSION) {
    return { ok: false, error: 'This project was saved by a newer version of CapShorts. Update the app to open it.' };
  }

  const stamp = Date.now();
  const words: WordToken[] = (Array.isArray(raw.transcript) ? raw.transcript : [])
    .filter((w): w is Record<string, unknown> => isObj(w) && isStr(w.word) && isNum(w.start) && isNum(w.end))
    .map((w, i) => ({
      id: isStr(w.id) && w.id ? w.id : `w-${i}-${stamp}`,
      start: Math.max(0, w.start as number),
      end: Math.max(w.start as number, w.end as number),
      word: w.word as string,
      keyword: Boolean(w.keyword),
      confidence: isNum(w.confidence) ? w.confidence : null,
    }));

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

  const segments: VideoSegment[] = (Array.isArray(raw.videoSegments) ? raw.videoSegments : [])
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

  const video = isObj(raw.video) ? raw.video : {};
  const aspect = raw.aspectRatio === '16:9' || raw.aspectRatio === '1:1' ? raw.aspectRatio : '9:16';
  const pos = isObj(raw.videoPosition) ? raw.videoPosition : {};

  const project: ProjectFile = {
    format: PROJECT_FORMAT,
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
    exportSettings: (isObj(raw.exportSettings) ? raw.exportSettings : {}) as unknown as ExportSettings,
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
