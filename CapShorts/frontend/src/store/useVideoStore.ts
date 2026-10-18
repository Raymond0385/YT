import { create } from 'zustand';
import { apiUrl } from '../config';
import { clampRange, describeClipRange } from '../utils/clipEdit';
import { createHistory } from '../utils/history';
import { ProjectFile, ProjectVideoRef, videoMatches } from '../utils/projectFile';
import { WordToken, SubtitlePreset, BrollClip, VideoClip, VideoSegment, AspectRatio, EngineHealth, ExportSettings } from '../types';

interface VideoStoreState {
  // Media State
  videoFile: File | null;
  videoUrl: string | null;
  videoName: string;
  serverVideoPath: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  aspectRatio: AspectRatio;
  videoSegments: VideoSegment[];

  // Subtitle / Words
  transcript: WordToken[];
  activeTemplateId: string;
  customStyleOverrides: Partial<SubtitlePreset>;

  // AI Viral Shorts / Clips
  clips: VideoClip[];
  selectedClipId: string | null;

  // B-roll
  brollList: BrollClip[];

  // Turbo Groq & Mode
  groqApiKey: string;
  rangeMode: 'full' | 'short_60s' | 'short_180s';

  // App / Engine Status
  engineHealth: EngineHealth | null;
  isTranscribing: boolean;
  transcribeProgress: number;
  transcribingStep: string;
  transcribeTaskId: string | null;
  isExporting: boolean;
  exportProgress: number;
  exportStatus: string;
  exportResultUrl: string | null;
  isExportModalOpen: boolean;
  isSettingsModalOpen: boolean;
  isScrubbing: boolean;
  activeTab: 'presets' | 'broll' | 'clips' | 'inspector';
  exportSettings: ExportSettings;
  silenceBackup: { transcript: WordToken[]; duration: number; videoSegments: VideoSegment[] } | null;

  setIsSettingsModalOpen: (open: boolean) => void;
  setIsScrubbing: (scrubbing: boolean) => void;

  // Actions
  setVideo: (file: File | null, url: string | null, name?: string) => void;
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setAspectRatio: (ratio: AspectRatio) => void;
  setVideoSegments: (segments: VideoSegment[]) => void;

  setTranscript: (words: WordToken[]) => void;
  updateWord: (index: number, changes: Partial<WordToken>) => void;
  addWord: (word: WordToken, afterIndex?: number) => void;
  insertWordAtTime: (time: number, text?: string) => string;
  deleteWord: (index: number) => void;
  toggleKeyword: (index: number) => void;

  setClips: (clips: VideoClip[]) => void;
  selectClip: (id: string | null) => void;
  /** Set while a project is open but its video file has not been chosen yet. */
  projectNeedsVideo: ProjectVideoRef | null;
  /** Active tab of the left panel (Captions, Shorts, ...). Lives in the store so projects can save it. */
  libraryTab: string;
  setLibraryTab: (tab: string) => void;
  /** Loads a saved project. Keeps the current video if it is the project's video, otherwise asks for it. */
  applyProject: (project: ProjectFile) => void;
  /** Attaches the video file to an opened project without touching its captions, shorts and cuts. */
  attachProjectVideo: (file: File) => void;
  updateClip: (id: string, changes: { title?: string; start?: number; end?: number }, edge?: 'start' | 'end') => void;
  deleteClip: (id: string) => void;
  addClip: (start: number, end: number, title?: string) => string;

  setGroqApiKey: (key: string) => void;
  setRangeMode: (mode: 'full' | 'short_60s' | 'short_180s') => void;

  setActiveTemplate: (id: string) => void;
  updateCustomStyle: (overrides: Partial<SubtitlePreset>) => void;
  resetCustomStyle: () => void;

  setBrollList: (list: BrollClip[]) => void;
  toggleBroll: (id: string) => void;
  addBroll: (clip: BrollClip) => void;
  removeBroll: (id: string) => void;

  setEngineHealth: (health: EngineHealth) => void;
  setIsTranscribing: (isTranscribing: boolean) => void;
  setTranscribeProgress: (progress: number) => void;
  setTranscribingStep: (step: string) => void;
  startTranscription: (file: File, model?: string, language?: string) => Promise<void>;
  cancelTranscription: () => void;

  setIsExporting: (isExporting: boolean) => void;
  setExportProgress: (progress: number, status?: string) => void;
  setExportResultUrl: (url: string | null) => void;
  setIsExportModalOpen: (isOpen: boolean) => void;
  setActiveTab: (tab: 'presets' | 'broll' | 'clips' | 'inspector') => void;
  setExportSettings: (settings: Partial<ExportSettings>) => void;
  convertTranscriptScript: (targetScript: string) => Promise<void>;
  glossary: string;
  setGlossary: (glossary: string) => void;
  applyGlossaryToTranscript: () => Promise<number>;
  alignTranscriptToText: (text: string) => Promise<boolean>;
  enhanceAudio: boolean;
  setEnhanceAudio: (v: boolean) => void;
  retryWeak: boolean;
  setRetryWeak: (v: boolean) => void;
  detectedLanguage: { code: string; probability: number | null } | null;
  glossarySets: { name: string; terms: string }[];
  saveGlossarySet: (name: string) => void;
  deleteGlossarySet: (name: string) => void;
  markWordVerified: (index: number) => void;
  selectNextUncertainWord: () => boolean;

  // CapCut Desktop Studio State
  projectTitle: string;
  timelineZoom: number;
  isBladeActive: boolean;
  isSnapEnabled: boolean;
  selectedTimelineItemId: string | null;
  selectedTimelineItemType: 'subtitle' | 'video' | 'audio' | null;
  safeAreaGuides: boolean;
  previewZoom: 'fit' | '50%' | '75%' | '100%';
  videoVolume: number;
  videoSpeed: number;
  videoScale: number;
  videoPosition: { x: number; y: number };
  videoFitMode: 'contain' | 'cover';
  activeInspectorTab: 'text' | 'video' | 'audio' | 'viral';

  selectedLanguage: string;
  setSelectedLanguage: (lang: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  setProjectTitle: (title: string) => void;
  setTimelineZoom: (zoom: number) => void;
  setIsBladeActive: (active: boolean) => void;
  setIsSnapEnabled: (enabled: boolean) => void;
  setSelectedTimelineItem: (id: string | null, type: 'subtitle' | 'video' | 'audio' | null) => void;
  setSafeAreaGuides: (enabled: boolean) => void;
  setPreviewZoom: (zoom: 'fit' | '50%' | '75%' | '100%') => void;
  setVideoVolume: (volume: number) => void;
  setVideoSpeed: (speed: number) => void;
  setVideoScale: (scale: number) => void;
  setVideoPosition: (pos: { x: number; y: number }) => void;
  setVideoFitMode: (mode: 'contain' | 'cover') => void;
  setActiveInspectorTab: (tab: 'text' | 'video' | 'audio' | 'viral') => void;
  splitAtPlayhead: () => void;
  splitSegmentAtTime: (time: number, targetType?: 'video' | 'subtitle') => void;
  deleteSelectedTimelineItem: () => void;

  // Next-Level Viral Features: Emojis & Silence Cut
  showEmojis: boolean;
  setShowEmojis: (show: boolean) => void;
  silenceRegions: Array<{ start: number; end: number; duration: number }>;
  isDetectingSilence: boolean;
  removedSilenceDuration: number;
  detectAndRemoveSilence: () => Promise<void>;
  undoSilenceRemoval: () => void;

  transcribeError: string | null;
  clearTranscribeError: () => void;
  loadSampleDemo: () => void;
}

const withWordIds = (words: any[]): WordToken[] => {
  const stamp = Date.now();
  return words.map((w, idx) => ({
    id: w.id || `w-${idx}-${stamp}`,
    start: w.start,
    end: w.end,
    word: w.word,
    keyword: Boolean(w.keyword),
  }));
};

/** Project glossary sets win over same-named ones; the user's other sets stay. */
const mergeGlossarySets = (current: { name: string; terms: string }[], incoming: { name: string; terms: string }[]) => {
  const names = new Set(incoming.map((g) => g.name));
  return [...current.filter((g) => !names.has(g.name)), ...incoming];
};

/** Keeps the app-wide settings a project carries (audio cleanup, glossary sets) in sync with localStorage. */
const persistLocalSettings = (project: ProjectFile) => {
  try {
    localStorage.setItem('capshorts.enhanceAudio', project.enhanceAudio ? '1' : '0');
    localStorage.setItem('capshorts.retryWeak', project.retryWeak ? '1' : '0');
    if (project.glossarySets.length) {
      const current = JSON.parse(localStorage.getItem('capshorts.glossarySets') || '[]');
      localStorage.setItem('capshorts.glossarySets', JSON.stringify(mergeGlossarySets(Array.isArray(current) ? current : [], project.glossarySets)));
    }
    localStorage.setItem('capshorts.glossary', project.glossary);
  } catch { /* storage unavailable */ }
};

export const useVideoStore = create<VideoStoreState>((set, get) => ({
  videoFile: null,
  videoUrl: null,
  videoName: '',
  serverVideoPath: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  aspectRatio: '9:16',

  transcript: [],
  activeTemplateId: 'mrbeast-yellow-pop',
  customStyleOverrides: {},

  clips: [],
  selectedClipId: null,

  groqApiKey: typeof window !== 'undefined' ? localStorage.getItem('capshorts_groq_key') || localStorage.getItem('opencaption_groq_key') || '' : '',
  rangeMode: 'full',

  brollList: [],

  engineHealth: null,
  isTranscribing: false,
  transcribeTaskId: null,
  transcribeError: null,
  clearTranscribeError: () => set({ transcribeError: null }),

  loadSampleDemo: () => set({
    transcript: [
      { id: 'w1', start: 0.3, end: 0.8, word: 'Unlock', keyword: false },
      { id: 'w2', start: 0.82, end: 1.4, word: 'Millions', keyword: true },
      { id: 'w3', start: 1.42, end: 1.7, word: 'of', keyword: false },
      { id: 'w4', start: 1.72, end: 2.1, word: 'views', keyword: false },
      { id: 'w5', start: 2.15, end: 2.45, word: 'with', keyword: false },
      { id: 'w6', start: 2.48, end: 2.8, word: 'AI', keyword: true },
      { id: 'w7', start: 2.82, end: 3.2, word: 'video', keyword: false },
      { id: 'w8', start: 3.22, end: 3.9, word: 'captions!', keyword: false },
      { id: 'w9', start: 4.1, end: 4.5, word: 'Stop', keyword: true },
      { id: 'w10', start: 4.52, end: 5.0, word: 'wasting', keyword: false },
      { id: 'w11', start: 5.02, end: 5.4, word: 'hours', keyword: false },
      { id: 'w12', start: 5.42, end: 6.1, word: 'manually', keyword: false },
      { id: 'w13', start: 6.15, end: 6.6, word: 'editing', keyword: false },
      { id: 'w14', start: 6.62, end: 7.3, word: 'subtitles.', keyword: false },
    ],
    clips: [
      {
        id: 'clip-sample-1',
        title: '🔥 The 10x Secret to Viral Shorts',
        hook: 'Unlock millions of views with AI video captions!',
        start: 0.0,
        end: 7.3,
        duration: 7.3,
        virality_score: 97,
        keywords: ['millions', 'ai', 'stop', 'views'],
        transcript_snippet: 'Unlock millions of views with AI video captions! Stop wasting hours manually editing subtitles.'
      }
    ],
    selectedClipId: null,
    transcribeError: null,
  }),

  // CapCut Desktop Studio State
  projectTitle: 'My Viral Short 01',
  timelineZoom: 45,
  isBladeActive: false,
  isSnapEnabled: true,
  selectedTimelineItemId: null,
  selectedTimelineItemType: null,
  safeAreaGuides: false,
  previewZoom: 'fit',
  videoVolume: 1,
  videoSpeed: 1,
  videoScale: 1.0,
  videoPosition: { x: 0, y: 0 },
  videoFitMode: 'contain',
  videoSegments: [],
  activeInspectorTab: 'text',
  transcribeProgress: 0,
  transcribingStep: '',
  isExporting: false,
  exportProgress: 0,

  selectedLanguage: 'auto',
  setSelectedLanguage: (selectedLanguage) => set({ selectedLanguage }),
  selectedModel: 'whisper-large-v3-turbo',
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  enhanceAudio: (() => {
    try { return localStorage.getItem('capshorts.enhanceAudio') !== '0'; } catch { return true; }
  })(),
  setEnhanceAudio: (enhanceAudio) => {
    try { localStorage.setItem('capshorts.enhanceAudio', enhanceAudio ? '1' : '0'); } catch { /* storage unavailable */ }
    set({ enhanceAudio });
  },
  retryWeak: (() => {
    try { return localStorage.getItem('capshorts.retryWeak') === '1'; } catch { return false; }
  })(),
  setRetryWeak: (retryWeak) => {
    try { localStorage.setItem('capshorts.retryWeak', retryWeak ? '1' : '0'); } catch { /* storage unavailable */ }
    set({ retryWeak });
  },
  detectedLanguage: null,
  glossarySets: (() => {
    try {
      const raw = JSON.parse(localStorage.getItem('capshorts.glossarySets') || '[]');
      return Array.isArray(raw) ? raw.filter((x: any) => x && typeof x.name === 'string' && typeof x.terms === 'string') : [];
    } catch { return []; }
  })(),
  saveGlossarySet: (name) => {
    const clean = name.trim();
    if (!clean) return;
    const sets = get().glossarySets.filter((x) => x.name !== clean);
    sets.push({ name: clean, terms: get().glossary });
    try { localStorage.setItem('capshorts.glossarySets', JSON.stringify(sets)); } catch { /* storage unavailable */ }
    set({ glossarySets: sets });
  },
  deleteGlossarySet: (name) => {
    const sets = get().glossarySets.filter((x) => x.name !== name);
    try { localStorage.setItem('capshorts.glossarySets', JSON.stringify(sets)); } catch { /* storage unavailable */ }
    set({ glossarySets: sets });
  },
  markWordVerified: (index) => set((state) => {
    const updated = [...state.transcript];
    if (updated[index]) updated[index] = { ...updated[index], confidence: null };
    return { transcript: updated };
  }),
  selectNextUncertainWord: () => {
    const { transcript, selectedTimelineItemId, selectedTimelineItemType, currentTime } = get();
    const isLow = (w: WordToken) => typeof w.confidence === 'number' && w.confidence < 0.5;
    if (!transcript.some(isLow)) return false;
    let from = -1;
    if (selectedTimelineItemType === 'subtitle' && selectedTimelineItemId) {
      from = transcript.findIndex((w) => w.id === selectedTimelineItemId);
    }
    if (from < 0) from = transcript.findIndex((w) => w.start >= currentTime) - 1;
    for (let step = 1; step <= transcript.length; step++) {
      const i = (from + step + transcript.length) % transcript.length;
      if (isLow(transcript[i])) {
        set({
          selectedTimelineItemId: transcript[i].id,
          selectedTimelineItemType: 'subtitle',
          activeInspectorTab: 'text',
          currentTime: transcript[i].start,
        });
        return true;
      }
    }
    return false;
  },
  glossary: (() => {
    try { return localStorage.getItem('capshorts.glossary') || ''; } catch { return ''; }
  })(),
  setGlossary: (glossary) => {
    try { localStorage.setItem('capshorts.glossary', glossary); } catch { /* storage unavailable */ }
    set({ glossary });
  },
  exportStatus: 'Idle',
  exportResultUrl: null,
  isExportModalOpen: false,
  isSettingsModalOpen: false,
  setIsSettingsModalOpen: (isSettingsModalOpen) => set({ isSettingsModalOpen }),
  isScrubbing: false,
  setIsScrubbing: (isScrubbing) => set({ isScrubbing }),
  activeTab: 'presets',
  exportSettings: {
    resolution: '1080x1920',
    fps: 30,
    crf: 18,
    outputFormat: 'mp4'
  },
  silenceBackup: null,

  setVideo: (file, url, name) => {
    const prevUrl = get().videoUrl;
    if (prevUrl && prevUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(prevUrl);
      } catch {
        // ignore
      }
    }
    const vName = name || (file ? file.name : 'Untitled Video');
    const curDur = get().duration || 10;
    set({
      videoFile: file,
      videoUrl: url,
      videoName: vName,
      projectNeedsVideo: null,
      serverVideoPath: null,
      isTranscribing: false,
      transcribeProgress: 0,
      transcribingStep: '',
      transcribeTaskId: null,
      isExporting: false,
      exportResultUrl: null,
      exportProgress: 0,
      exportStatus: 'Idle',
      brollList: [],
      silenceRegions: [],
      removedSilenceDuration: 0,
      silenceBackup: null,
      currentTime: 0,
      isPlaying: false,
      transcript: [],
      clips: [],
      selectedClipId: null,
      transcribeError: null,
      videoSegments: [{
        id: 'seg-1',
        name: vName,
        start: 0,
        end: curDur,
        sourceStart: 0,
        sourceEnd: curDur,
        duration: curDur
      }]
    });
    history.clear();
  },

  setDuration: (duration) => {
    const { videoSegments, videoName } = get();
    if (videoSegments && videoSegments.length === 1) {
      const only = videoSegments[0];
      const unchanged = Math.abs(only.end - duration) < 0.05 && Math.abs(only.sourceEnd - duration) < 0.05 && only.start === 0 && only.sourceStart === 0;
      if (unchanged) {
        if (get().duration !== duration) history.withoutRecording(() => set({ duration }));
        return;
      }
    }
    if (!videoSegments || videoSegments.length <= 1) {
      history.withoutRecording(() => set({
        duration,
        videoSegments: [{
          id: videoSegments?.[0]?.id || 'seg-1',
          name: videoSegments?.[0]?.name || videoName || 'Main Video Clip',
          start: 0,
          end: duration,
          sourceStart: 0,
          sourceEnd: duration,
          duration: duration
        }]
      }));
    } else {
      history.withoutRecording(() => set({ duration }));
    }
  },

  setVideoSegments: (videoSegments) => set({ videoSegments }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),

  setTranscript: (transcript) => set({ transcript }),

  updateWord: (index, changes) => set((state) => {
    const updated = [...state.transcript];
    if (updated[index]) {
      updated[index] = {
        ...updated[index],
        ...changes,
        ...(changes.word !== undefined && changes.confidence === undefined ? { confidence: null } : {})
      };
    }
    return { transcript: updated };
  }),

  addWord: (word, afterIndex) => set((state) => {
    const updated = [...state.transcript];
    if (afterIndex !== undefined && afterIndex >= 0 && afterIndex < updated.length) {
      updated.splice(afterIndex + 1, 0, word);
    } else {
      updated.push(word);
    }
    return { transcript: updated };
  }),

  insertWordAtTime: (time, text = 'New word') => {
    const { transcript, duration } = get();
    const DEFAULT_LEN = 0.4;
    const MIN_LEN = 0.1;
    const t = Math.max(0, time);

    // Insert after the last word that starts at or before the playhead
    let afterIndex = -1;
    for (let i = 0; i < transcript.length; i++) {
      if (transcript[i].start <= t) afterIndex = i;
      else break;
    }
    const prev = afterIndex >= 0 ? transcript[afterIndex] : null;
    const next = transcript[afterIndex + 1] || null;

    // Don't start inside the previous word
    const start = Math.max(t, prev ? prev.end : 0);
    let end = start + DEFAULT_LEN;
    if (next) end = Math.min(end, next.start);
    if (duration > 0) end = Math.min(end, Math.max(duration, start + MIN_LEN));
    if (end - start < MIN_LEN) end = start + MIN_LEN;

    const word: WordToken = {
      id: `w-new-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      word: text,
      keyword: false,
    };
    const updated = [...transcript];
    updated.splice(afterIndex + 1, 0, word);
    set({
      transcript: updated,
      selectedTimelineItemId: word.id,
      selectedTimelineItemType: 'subtitle',
      activeInspectorTab: 'text',
    });
    return word.id;
  },

  deleteWord: (index) => set((state) => {
    const updated = state.transcript.filter((_, i) => i !== index);
    return { transcript: updated };
  }),

  toggleKeyword: (index) => set((state) => {
    const updated = [...state.transcript];
    if (updated[index]) {
      updated[index] = { ...updated[index], keyword: !updated[index].keyword };
    }
    return { transcript: updated };
  }),

  setClips: (clips) => set({ clips }),
  projectNeedsVideo: null,
  libraryTab: 'captions',
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  applyProject: (project) => {
    const { videoFile, videoUrl } = get();
    const keepVideo = Boolean(videoFile && videoMatches(project.video, videoFile));
    if (!keepVideo && videoUrl && videoUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(videoUrl); } catch { /* ignore */ }
    }
    const segments = project.videoSegments.length
      ? project.videoSegments
      : [{
          id: 'seg-1', name: project.video.name || 'Video', start: 0, end: project.video.duration || 10,
          sourceStart: 0, sourceEnd: project.video.duration || 10, duration: project.video.duration || 10,
        }];
    persistLocalSettings(project);
    history.clear();
    set((state) => ({
      projectTitle: project.title,
      aspectRatio: project.aspectRatio,
      transcript: project.transcript,
      clips: project.clips,
      selectedClipId: project.view.selectedClipId,
      videoSegments: segments,
      activeTemplateId: project.activeTemplateId || state.activeTemplateId,
      customStyleOverrides: project.customStyleOverrides,
      brollList: project.brollList,
      videoVolume: project.videoVolume,
      videoSpeed: project.videoSpeed,
      videoScale: project.videoScale,
      videoPosition: project.videoPosition,
      videoFitMode: project.videoFitMode,
      showEmojis: project.showEmojis,
      selectedLanguage: project.selectedLanguage,
      selectedModel: project.selectedModel,
      glossary: project.glossary,
      exportSettings: { ...state.exportSettings, ...project.exportSettings },
      duration: project.video.duration || state.duration,
      glossarySets: mergeGlossarySets(state.glossarySets, project.glossarySets),
      rangeMode: project.rangeMode,
      enhanceAudio: project.enhanceAudio,
      retryWeak: project.retryWeak,
      currentTime: project.view.currentTime,
      timelineZoom: project.view.timelineZoom,
      previewZoom: project.view.previewZoom,
      safeAreaGuides: project.view.safeAreaGuides,
      isSnapEnabled: project.view.isSnapEnabled,
      activeInspectorTab: project.view.activeInspectorTab,
      activeTab: project.view.activeTab,
      libraryTab: project.view.libraryTab,
      isBladeActive: false,
      isPlaying: false,
      serverVideoPath: null,
      isTranscribing: false,
      transcribeError: null,
      isExporting: false,
      exportResultUrl: null,
      exportProgress: 0,
      exportStatus: 'Idle',
      silenceRegions: project.silence.regions,
      removedSilenceDuration: project.silence.removedDuration,
      silenceBackup: project.silence.backup,
      selectedTimelineItemId: project.view.selectedTimelineItemId,
      selectedTimelineItemType: project.view.selectedTimelineItemType,
      ...(keepVideo
        ? { projectNeedsVideo: null }
        : { videoFile: null, videoUrl: null, videoName: project.video.name, projectNeedsVideo: project.video }),
    }));
  },
  attachProjectVideo: (file) => {
    const prev = get().videoUrl;
    if (prev && prev.startsWith('blob:')) {
      try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
    }
    set({
      videoFile: file,
      videoUrl: URL.createObjectURL(file),
      videoName: file.name,
      projectNeedsVideo: null,
      serverVideoPath: null,
    });
  },
  updateClip: (id, changes, edge = 'end') => set((state) => {
    const clips = state.clips.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, custom: true };
      if (changes.title !== undefined) next.title = changes.title;
      if (changes.start !== undefined || changes.end !== undefined) {
        const [s, e] = clampRange(
          changes.start ?? c.start,
          changes.end ?? c.end,
          state.duration,
          changes.start !== undefined && changes.end === undefined ? 'start' : changes.end !== undefined && changes.start === undefined ? 'end' : edge
        );
        next.start = s;
        next.end = e;
        next.duration = Math.round((e - s) * 10) / 10;
        Object.assign(next, describeClipRange(state.transcript, s, e));
      }
      return next;
    });
    return { clips };
  }),
  deleteClip: (id) => set((state) => ({
    clips: state.clips.filter((c) => c.id !== id),
    selectedClipId: state.selectedClipId === id ? null : state.selectedClipId,
  })),
  addClip: (start, end, title) => {
    const [s, e] = clampRange(start, end, get().duration, 'end');
    const id = `clip-custom-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const clip = {
      id,
      title: title || 'My short',
      start: s,
      end: e,
      duration: Math.round((e - s) * 10) / 10,
      virality_score: 0,
      custom: true,
      ...describeClipRange(get().transcript, s, e),
    };
    set((state) => ({ clips: [...state.clips, clip].sort((a, b) => a.start - b.start), selectedClipId: id, currentTime: s }));
    return id;
  },
  selectClip: (id) => set((state) => {
    if (!id) {
      return { selectedClipId: null };
    }
    const clip = state.clips.find(c => c.id === id);
    if (clip) {
      return {
        selectedClipId: id,
        currentTime: clip.start
      };
    }
    return { selectedClipId: id };
  }),

  setGroqApiKey: (groqApiKey) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('capshorts_groq_key', groqApiKey);
    }
    set({ groqApiKey });
  },

  setRangeMode: (rangeMode) => set({ rangeMode }),

  // Picking a preset replaces the look: earlier manual tweaks (font, colors...) would otherwise override the new preset
  setActiveTemplate: (id) => set({ activeTemplateId: id, customStyleOverrides: {} }),
  updateCustomStyle: (overrides) => set((state) => ({
    customStyleOverrides: { ...state.customStyleOverrides, ...overrides }
  })),
  resetCustomStyle: () => set({ customStyleOverrides: {} }),

  setBrollList: (brollList) => set({ brollList }),
  toggleBroll: (id) => set((state) => ({
    brollList: state.brollList.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c)
  })),
  addBroll: (clip) => set((state) => ({
    brollList: [...state.brollList, clip]
  })),
  removeBroll: (id) => set((state) => ({
    brollList: state.brollList.filter(c => c.id !== id)
  })),

  setEngineHealth: (engineHealth) => set({ engineHealth }),
  setIsTranscribing: (isTranscribing) => set({ isTranscribing }),
  setTranscribeProgress: (transcribeProgress) => set({ transcribeProgress }),
  setTranscribingStep: (transcribingStep) => set({ transcribingStep }),

  startTranscription: async (file: File, model?: string, language?: string) => {
    const { groqApiKey, rangeMode, selectedModel, selectedLanguage, glossary, enhanceAudio, retryWeak } = get();
    const effectiveModel = model || selectedModel || 'whisper-large-v3-turbo';
    const effectiveLanguage = language || selectedLanguage || 'auto';
    const isTurbo = Boolean(groqApiKey && groqApiKey.trim().length > 10);

    set({
      isTranscribing: true,
      transcribeError: null,
      detectedLanguage: null,
      transcribeProgress: 6,
      transcribingStep: isTurbo
        ? '⚡ Turbo Mode: Uploading and extracting audio...'
        : 'Uploading video to AI engine...'
    });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('model', effectiveModel);
      formData.append('language', effectiveLanguage);
      formData.append('range_mode', rangeMode);
      formData.append('enhance_audio', enhanceAudio ? '1' : '0');
      formData.append('retry_weak', retryWeak ? '1' : '0');
      if (glossary.trim()) {
        formData.append('glossary', glossary);
      }
      if (groqApiKey) {
        formData.append('groq_api_key', groqApiKey.trim());
      }

      const response = await fetch(apiUrl('/api/transcribe'), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.words && Array.isArray(data.words) && data.words.length > 0) {
        const formatted = data.words.map((w: any, idx: number) => ({
          id: `w-${idx}-${Date.now()}`,
          start: w.start,
          end: w.end,
          word: w.word,
          keyword: Boolean(w.keyword),
        }));
        set({
          transcript: formatted,
          clips: data.clips || [],
          serverVideoPath: data.video_path || null,
          isTranscribing: false,
          transcribeProgress: 100,
          transcribingStep: '',
          transcribeError: null,
        });
        return;
      }

      if (data.task_id) {
        const taskId = data.task_id;
        set({
          transcribeTaskId: taskId,
          ...(data.video_path ? { serverVideoPath: data.video_path } : {})
        });

        let pollAttempts = 0;
        const maxPollAttempts = 1200; // 10 minutes maximum polling window (F-043)
        const pollTimer = setInterval(async () => {
          if (!get().isTranscribing || get().transcribeTaskId !== taskId) {
            clearInterval(pollTimer);
            return;
          }

          pollAttempts++;
          if (pollAttempts > maxPollAttempts) {
            clearInterval(pollTimer);
            set({
              isTranscribing: false,
              transcribingStep: '',
              transcribeError: 'Transcription timed out after 10 minutes. Please check your audio file.'
            });
            return;
          }

          try {
            const progRes = await fetch(apiUrl(`/api/transcribe/progress/${taskId}`));
            if (!get().isTranscribing || get().transcribeTaskId !== taskId) {
              clearInterval(pollTimer);
              return;
            }

            if (progRes.ok) {
              const progData = await progRes.json();
              set({
                transcribeProgress: progData.progress || 15,
                transcribingStep: progData.step || 'Processing Speech AI...'
              });

              if (progData.status === 'completed') {
                clearInterval(pollTimer);
                if (progData.words && Array.isArray(progData.words) && progData.words.length > 0) {
                  const formatted = progData.words.map((w: any, idx: number) => ({
                    id: `w-${idx}-${Date.now()}`,
                    start: w.start,
                    end: w.end,
                    word: w.word,
                    keyword: Boolean(w.keyword),
                    confidence: typeof w.confidence === 'number' ? w.confidence : null,
                  }));
                  set({
                    transcript: formatted,
                    detectedLanguage: progData.language
                      ? { code: String(progData.language), probability: typeof progData.language_probability === 'number' ? progData.language_probability : null }
                      : null,
                    clips: progData.clips || [],
                    serverVideoPath: progData.video_path || get().serverVideoPath,
                    isTranscribing: false,
                    transcribeProgress: 100,
                    transcribingStep: '',
                    transcribeError: null,
                    transcribeTaskId: null,
                  });
                } else {
                  set({
                    isTranscribing: false,
                    transcribingStep: '',
                    transcribeError: 'No speech detected in this audio.',
                    transcribeTaskId: null,
                  });
                }
              } else if (progData.status === 'failed') {
                clearInterval(pollTimer);
                set({
                  isTranscribing: false,
                  transcribingStep: '',
                  transcribeError: progData.error || 'Transcription failed',
                  transcribeTaskId: null,
                });
              }
            }
          } catch (err) {
            console.warn("Transcription polling tick error:", err);
          }
        }, 500);
      } else {
        set({
          isTranscribing: false,
          transcribeProgress: 0,
          transcribingStep: '',
          transcribeError: 'Unexpected response format from AI transcription engine.'
        });
      }
    } catch (err: any) {
      console.warn("Transcription failed:", err);
      set({
        isTranscribing: false,
        transcribeProgress: 0,
        transcribingStep: '',
        transcribeError: err?.message || 'Failed to connect to AI backend'
      });
    }
  },

  cancelTranscription: () => set({
    isTranscribing: false,
    transcribeProgress: 0,
    transcribingStep: ''
  }),

  setIsExporting: (isExporting) => set({ isExporting }),
  setExportProgress: (exportProgress, status) => set({
    exportProgress,
    exportStatus: status || 'Processing...'
  }),
  setExportResultUrl: (exportResultUrl) => set({ exportResultUrl }),
  setIsExportModalOpen: (isExportModalOpen) => set({ isExportModalOpen }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setExportSettings: (settings) => set((state) => ({
    exportSettings: { ...state.exportSettings, ...settings }
  })),

  convertTranscriptScript: async (targetScript: string) => {
    const { transcript } = get();
    if (!transcript || transcript.length === 0) return;
    try {
      const res = await fetch(apiUrl('/api/transcript/convert-script'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: transcript, target_script: targetScript })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.words && Array.isArray(data.words)) {
          set({ transcript: withWordIds(data.words) });
        }
      }
    } catch (e) {
      console.warn("Script conversion error:", e);
    }
  },

  applyGlossaryToTranscript: async () => {
    const { transcript, glossary } = get();
    const terms = glossary.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
    if (!transcript || transcript.length === 0 || terms.length === 0) return 0;
    try {
      const res = await fetch(apiUrl('/api/transcript/glossary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: transcript, glossary: terms })
      });
      if (!res.ok) return 0;
      const data = await res.json();
      if (!Array.isArray(data.words)) return 0;
      const changed = data.words.filter((w: WordToken, i: number) => transcript[i]?.word !== w.word).length;
      set({ transcript: withWordIds(data.words) });
      return changed;
    } catch (e) {
      console.warn("Glossary error:", e);
      return 0;
    }
  },

  alignTranscriptToText: async (text: string) => {
    const { transcript } = get();
    if (!text.trim()) return false;
    try {
      const res = await fetch(apiUrl('/api/transcript/align'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: transcript || [], text })
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!Array.isArray(data.words)) return false;
      set({ transcript: withWordIds(data.words) });
      return true;
    } catch (e) {
      console.warn("Align error:", e);
      return false;
    }
  },

  setProjectTitle: (projectTitle) => set({ projectTitle }),
  setTimelineZoom: (timelineZoom) => set({ timelineZoom: Math.max(15, Math.min(180, timelineZoom)) }),
  setIsBladeActive: (isBladeActive) => set({ isBladeActive }),
  setIsSnapEnabled: (isSnapEnabled) => set({ isSnapEnabled }),
  setSelectedTimelineItem: (id, type) => set({ 
    selectedTimelineItemId: id, 
    selectedTimelineItemType: type,
    activeInspectorTab: type === 'video' ? 'video' : type === 'audio' ? 'audio' : 'text'
  }),
  setSafeAreaGuides: (safeAreaGuides) => set({ safeAreaGuides }),
  setPreviewZoom: (previewZoom) => set({ previewZoom }),
  setVideoVolume: (videoVolume) => set({ videoVolume }),
  setVideoSpeed: (videoSpeed) => set({ videoSpeed }),
  setVideoScale: (videoScale) => {
    const normalized = videoScale > 5 ? videoScale / 100 : videoScale;
    set({ videoScale: Math.max(0.2, Math.min(4.0, normalized || 1.0)) });
  },
  setVideoPosition: (videoPosition) => set({ videoPosition }),
  setVideoFitMode: (videoFitMode) => set({ videoFitMode }),
  setActiveInspectorTab: (activeInspectorTab) => set({ activeInspectorTab }),

  splitAtPlayhead: () => {
    get().splitSegmentAtTime(get().currentTime);
  },

  splitSegmentAtTime: (time: number, targetType?: 'video' | 'subtitle') => {
    const { videoSegments, transcript } = get();
    let newSegments = [...videoSegments];
    let newTranscript = [...transcript];
    let newlyCreatedId: string | null = null;
    let newlyCreatedType: 'video' | 'subtitle' = targetType || 'video';

    // 1. Split Video Segment intersecting `time`
    const segIdx = newSegments.findIndex(s => time > s.start + 0.04 && time < s.end - 0.04);
    if (segIdx !== -1) {
      const target = newSegments[segIdx];
      const baseName = target.name.replace(/\s*\(Part\s*\d+\)/, '');
      const splitOffset = time - target.start;
      const part1: VideoSegment = {
        ...target,
        name: `${baseName} (Part 1)`,
        end: time,
        duration: Number((time - target.start).toFixed(2)),
        sourceEnd: Number((target.sourceStart + splitOffset).toFixed(2))
      };
      const genRandomSuffix = (len: number = 8) => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID().replace(/-/g, '').substring(0, len);
        }
        return Math.random().toString(36).substring(2, 2 + len);
      };

      const part2Id = `seg-${genRandomSuffix(8)}`;
      const part2: VideoSegment = {
        id: part2Id,
        name: `${baseName} (Part 2)`,
        start: time,
        end: target.end,
        sourceStart: Number((target.sourceStart + splitOffset).toFixed(2)),
        sourceEnd: target.sourceEnd,
        duration: Number((target.end - time).toFixed(2))
      };
      newSegments.splice(segIdx, 1, part1, part2);
      newlyCreatedId = part2Id;
      newlyCreatedType = 'video';
    }

    // 2. Split Subtitle Word / Phrase intersecting `time`
    if (targetType === 'subtitle' || !targetType) {
      const wordIdx = newTranscript.findIndex(w => time >= w.start && time <= w.end);
      if (wordIdx !== -1) {
        const targetWord = newTranscript[wordIdx];
        if (time - targetWord.start > 0.12 && targetWord.end - time > 0.12) {
          const randSuffix = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID().replace(/-/g, '').substring(0, 6)
            : Math.random().toString(36).substring(2, 8);
          const totalDur = Math.max(0.01, targetWord.end - targetWord.start);
          const ratio = Math.max(0.2, Math.min(0.8, (time - targetWord.start) / totalDur));
          const splitChar = Math.max(1, Math.min(targetWord.word.length - 1, Math.round(targetWord.word.length * ratio)));
          const w1 = targetWord.word.slice(0, splitChar);
          const w2 = targetWord.word.slice(splitChar);

          const p1 = { ...targetWord, id: `w-${randSuffix}-1`, word: w1, end: Number(time.toFixed(2)) };
          const p2 = { ...targetWord, id: `w-${randSuffix}-2`, word: w2, start: Number(time.toFixed(2)) };
          newTranscript.splice(wordIdx, 1, p1, p2);
          if (targetType === 'subtitle') {
            newlyCreatedId = p2.id;
            newlyCreatedType = 'subtitle';
          }
        }
      }
    }

    set({
      videoSegments: newSegments,
      transcript: newTranscript,
      selectedTimelineItemId: newlyCreatedId || get().selectedTimelineItemId,
      selectedTimelineItemType: newlyCreatedType
    });
  },

  deleteSelectedTimelineItem: () => {
    const { selectedTimelineItemId, selectedTimelineItemType, videoSegments, transcript, duration } = get();
    if (!selectedTimelineItemId) return;

    if (selectedTimelineItemType === 'video') {
      const segIdx = videoSegments.findIndex(s => s.id === selectedTimelineItemId);
      if (segIdx !== -1) {
        const delSeg = videoSegments[segIdx];
        const shiftAmount = delSeg.duration;
        const remainingSegments = videoSegments.filter((_, i) => i !== segIdx);

        // Magnetic ripple-snap: Shift subsequent segments leftward
        const rippleSegments = remainingSegments.map(s => {
          if (s.start >= delSeg.end - 0.05) {
            return {
              ...s,
              start: Math.max(0, Number((s.start - shiftAmount).toFixed(2))),
              end: Math.max(0.1, Number((s.end - shiftAmount).toFixed(2)))
            };
          }
          return s;
        });

        // Magnetic ripple-snap for Subtitles:
        // 1. Remove words falling completely within the deleted segment
        // 2. Shift subsequent words leftward
        const rippleTranscript = transcript
          .filter(w => !(w.start >= delSeg.start - 0.05 && w.end <= delSeg.end + 0.05))
          .map(w => {
            if (w.start >= delSeg.end - 0.05) {
              return {
                ...w,
                start: Math.max(0, Number((w.start - shiftAmount).toFixed(2))),
                end: Math.max(0.1, Number((w.end - shiftAmount).toFixed(2)))
              };
            }
            return w;
          });

        const newDur = Math.max(1, Number((duration - shiftAmount).toFixed(2)));
        set({
          videoSegments: rippleSegments,
          transcript: rippleTranscript,
          duration: newDur,
          selectedTimelineItemId: null,
          selectedTimelineItemType: null
        });
      }
    } else if (selectedTimelineItemType === 'subtitle') {
      set({
        transcript: transcript.filter(w => w.id !== selectedTimelineItemId),
        selectedTimelineItemId: null,
        selectedTimelineItemType: null
      });
    }
  },

  // Next-Level Viral Features: Emojis & Silence Cut
  showEmojis: true,
  setShowEmojis: (showEmojis) => set({ showEmojis }),
  silenceRegions: [],
  isDetectingSilence: false,
  removedSilenceDuration: 0,

  detectAndRemoveSilence: async () => {
    const { serverVideoPath, videoName, transcript, duration, videoSegments } = get();
    const targetPath = serverVideoPath || videoName;

    set({ isDetectingSilence: true });
    try {
      const res = await fetch(apiUrl('/api/silence/detect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_path: targetPath, noise_threshold_db: -30, min_duration: 0.5 })
      });
      if (res.ok) {
        const data = await res.json();
        const regions: Array<{ start: number; end: number; duration: number }> = data.silence_regions || [];
        if (regions.length > 0) {
          set({
            silenceBackup: {
              transcript: [...transcript],
              duration,
              videoSegments: [...videoSegments]
            }
          });

          // 1. Compute non-silent speech segments (ripple cuts)
          const speechChunks: Array<{ start: number; end: number }> = [];
          let currentPos = 0;
          for (const r of regions) {
            if (r.start > currentPos + 0.1) {
              speechChunks.push({ start: currentPos, end: r.start });
            }
            currentPos = r.end;
          }
          if (currentPos < duration - 0.1) {
            speechChunks.push({ start: currentPos, end: duration });
          }

          // 2. Build seamless ripple-joined video segments
          let timelineHead = 0;
          const newVideoSegments: VideoSegment[] = speechChunks.map((chunk, idx) => {
            const chunkDur = Number((chunk.end - chunk.start).toFixed(2));
            const seg: VideoSegment = {
              id: `speech-seg-${idx + 1}`,
              name: `Speech Segment ${idx + 1}`,
              start: Number(timelineHead.toFixed(2)),
              end: Number((timelineHead + chunkDur).toFixed(2)),
              sourceStart: chunk.start,
              sourceEnd: chunk.end,
              duration: chunkDur
            };
            timelineHead += chunkDur;
            return seg;
          });

          // 3. Shift word timestamps by subtracting preceding silence
          const shiftedWords = transcript
            .filter(w => !regions.some(r => w.start >= r.start && w.end <= r.end))
            .map(w => {
              let shiftAmount = 0;
              for (const r of regions) {
                if (r.end <= w.start) {
                  shiftAmount += r.duration;
                } else if (r.start < w.start && r.end > w.start) {
                  shiftAmount += (w.start - r.start);
                }
              }
              const newStart = Math.max(0, Number((w.start - shiftAmount).toFixed(2)));
              const newEnd = Math.max(newStart + 0.1, Number((w.end - shiftAmount).toFixed(2)));
              return {
                ...w,
                start: newStart,
                end: newEnd
              };
            });

          const totalCut = data.total_silence_duration || 0;
          set({
            transcript: shiftedWords,
            videoSegments: newVideoSegments.length > 0 ? newVideoSegments : videoSegments,
            silenceRegions: regions,
            removedSilenceDuration: totalCut,
            duration: Math.max(5, Number((duration - totalCut).toFixed(2))),
            isDetectingSilence: false
          });
        } else {
          set({ isDetectingSilence: false });
        }
      } else {
        set({ isDetectingSilence: false });
      }
    } catch (e) {
      console.warn("Silence detection error:", e);
      set({ isDetectingSilence: false });
    }
  },

  undoSilenceRemoval: () => {
    const backup = get().silenceBackup;
    if (backup) {
      set({
        transcript: backup.transcript,
        videoSegments: backup.videoSegments,
        silenceRegions: [],
        removedSilenceDuration: 0,
        duration: backup.duration,
        silenceBackup: null
      });
    }
  }
}));

/**
 * Undo / redo for everything that makes up the edit (captions, shorts, cuts, style, B-roll, video settings).
 * View state (playhead, zoom, tabs) is deliberately not part of it.
 */
export const history = createHistory<VideoStoreState>({
  getState: () => useVideoStore.getState(),
  setState: (partial) => useVideoStore.setState(partial),
  subscribe: (listener) => useVideoStore.subscribe(listener),
  keys: [
    'projectTitle', 'transcript', 'clips', 'videoSegments', 'activeTemplateId', 'customStyleOverrides',
    'brollList', 'aspectRatio', 'videoVolume', 'videoSpeed', 'videoScale', 'videoPosition', 'videoFitMode',
    'showEmojis', 'silenceRegions', 'removedSilenceDuration', 'silenceBackup',
  ],
  passiveKeys: ['duration'],
  quietMs: 500,
  limit: 100,
});
