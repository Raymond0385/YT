import React, { useState, useMemo } from 'react';
import {
  FolderOpen,
  Subtitles,
  Type,
  Music,
  Film,
  Scissors,
  Upload,
  Sparkles,
  Play,
  RotateCcw,
  Check,
  Search,
  Sliders,
  Volume2,
  VolumeX,
  Flame,
  Plus,
  Trash2,
  Key,
  Clock,
  Download,
  AlertCircle,
  CirclePlay,
  Loader2
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useVideoStore } from '../../store/useVideoStore';
import { apiUrl } from '../../config';
import { ShortsPanel } from './ShortsPanel';
import { SubtitlePreset, VideoClip, BrollClip } from '../../types';
import templatesData from '../../data/templates.json';
import { formatTime, formatTimeWithMs } from '../../utils/timeFormat';
import { formatCasing } from '../../utils/styleHelper';

type LibraryTab = 'youtube' | 'media' | 'captions' | 'text' | 'audio' | 'broll' | 'shorts';

const TEMPLATE_CATEGORIES = ["All", "Viral Shorts", "Neon & Gaming", "Documentary & Clean", "Karaoke Sweep", "Urdu"];

export const MediaLibraryPanel: React.FC = () => {
  const [scriptText, setScriptText] = React.useState('');
  const [localNotice, setLocalNotice] = React.useState<string | null>(null);
  const {
    videoFile,
    videoUrl,
    videoName,
    duration,
    setCurrentTime,
    setVideo,
    selectedLanguage,
    setSelectedLanguage,
    selectedModel,
    setSelectedModel,
    glossary,
    setGlossary,
    enhanceAudio,
    setEnhanceAudio,
    retryWeak,
    setRetryWeak,
    detectedLanguage,
    glossarySets,
    saveGlossarySet,
    deleteGlossarySet,
    applyGlossaryToTranscript,
    alignTranscriptToText,
    transcript,
    activeTemplateId,
    setActiveTemplate,
    customStyleOverrides,
    updateCustomStyle,
    groqApiKey,
    setGroqApiKey,
    isTranscribing,
    transcribeProgress,
    transcribingStep,
    transcribeError,
    clearTranscribeError,
    startTranscription,
    cancelTranscription,
    clips,
    selectedClipId,
    selectClip,
    setClips,
    brollList,
    toggleBroll,
    addBroll,
    removeBroll,
    videoVolume,
    setVideoVolume,
    videoSpeed,
    setVideoSpeed,
    setIsExportModalOpen
  } = useVideoStore(
    useShallow((state) => ({
      videoFile: state.videoFile,
      videoUrl: state.videoUrl,
      videoName: state.videoName,
      duration: state.duration,
      setCurrentTime: state.setCurrentTime,
      setVideo: state.setVideo,
      selectedLanguage: state.selectedLanguage,
      setSelectedLanguage: state.setSelectedLanguage,
      selectedModel: state.selectedModel,
      setSelectedModel: state.setSelectedModel,
      glossary: state.glossary,
      setGlossary: state.setGlossary,
      enhanceAudio: state.enhanceAudio,
      setEnhanceAudio: state.setEnhanceAudio,
      retryWeak: state.retryWeak,
      setRetryWeak: state.setRetryWeak,
      detectedLanguage: state.detectedLanguage,
      glossarySets: state.glossarySets,
      saveGlossarySet: state.saveGlossarySet,
      deleteGlossarySet: state.deleteGlossarySet,
      applyGlossaryToTranscript: state.applyGlossaryToTranscript,
      alignTranscriptToText: state.alignTranscriptToText,
      transcript: state.transcript,
      activeTemplateId: state.activeTemplateId,
      setActiveTemplate: state.setActiveTemplate,
      customStyleOverrides: state.customStyleOverrides,
      updateCustomStyle: state.updateCustomStyle,
      groqApiKey: state.groqApiKey,
      setGroqApiKey: state.setGroqApiKey,
      isTranscribing: state.isTranscribing,
      transcribeProgress: state.transcribeProgress,
      transcribingStep: state.transcribingStep,
      transcribeError: state.transcribeError,
      clearTranscribeError: state.clearTranscribeError,
      startTranscription: state.startTranscription,
      cancelTranscription: state.cancelTranscription,
      clips: state.clips,
      selectedClipId: state.selectedClipId,
      selectClip: state.selectClip,
      setClips: state.setClips,
      brollList: state.brollList,
      toggleBroll: state.toggleBroll,
      addBroll: state.addBroll,
      removeBroll: state.removeBroll,
      videoVolume: state.videoVolume,
      setVideoVolume: state.setVideoVolume,
      videoSpeed: state.videoSpeed,
      setVideoSpeed: state.setVideoSpeed,
      setIsExportModalOpen: state.setIsExportModalOpen,
    }))
  );

  const activeTab = useVideoStore((s) => s.libraryTab) as LibraryTab;
  const setActiveTab = useVideoStore((s) => s.setLibraryTab) as (tab: LibraryTab) => void;

  // Templates State
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  // B-Roll State
  const [brollKeyword, setBrollKeyword] = useState('');
  const [brollResults, setBrollResults] = useState<any[]>([]);
  const [isSearchingBroll, setIsSearchingBroll] = useState(false);
  const [pexelsKey, setPexelsKey] = useState(() => localStorage.getItem('opencaption_pexels_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(false);

  // YouTube import state
  const [ytUrl, setYtUrl] = useState('');
  const [ytQuality, setYtQuality] = useState('1080');
  const [ytInfo, setYtInfo] = useState<{ title: string; duration: number; thumbnail?: string; uploader?: string } | null>(null);
  const [ytBusy, setYtBusy] = useState<'info' | 'download' | null>(null);
  const [ytProgress, setYtProgress] = useState(0);
  const [ytStep, setYtStep] = useState('');
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytDir, setYtDir] = useState('');
  const [ytDirDraft, setYtDirDraft] = useState('');
  const [ytSavedTo, setYtSavedTo] = useState<string | null>(null);

  React.useEffect(() => {
    fetch(apiUrl('/api/youtube/settings'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.download_dir) {
          setYtDir(d.download_dir);
          setYtDirDraft(d.download_dir);
        }
      })
      .catch(() => { /* backend offline: folder shows once it is reachable */ });
  }, []);

  const saveYoutubeDir = async (dir: string) => {
    setYtError(null);
    try {
      const res = await fetch(apiUrl('/api/youtube/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ download_dir: dir })
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Could not use this folder'));
      const d = await res.json();
      setYtDir(d.download_dir);
      setYtDirDraft(d.download_dir);
    } catch (e: any) {
      setYtError(e?.message || 'Could not use this folder');
    }
  };

  const browseYoutubeDir = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false, defaultPath: ytDir || undefined });
      if (typeof picked === 'string') await saveYoutubeDir(picked);
    } catch {
      setYtError('Folder picker is available in the desktop app. Type the full folder path instead.');
    }
  };

  const readApiError = async (res: Response, fallback: string) => {
    try {
      const data = await res.json();
      return typeof data.detail === 'string' ? data.detail : fallback;
    } catch {
      return fallback;
    }
  };

  const handleYoutubeInfo = async () => {
    if (!ytUrl.trim()) return;
    setYtBusy('info');
    setYtError(null);
    setYtInfo(null);
    try {
      const res = await fetch(apiUrl('/api/youtube/info'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ytUrl.trim() })
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Could not read this video'));
      setYtInfo(await res.json());
    } catch (e: any) {
      setYtError(e?.message || 'Could not read this video');
    } finally {
      setYtBusy(null);
    }
  };

  const handleYoutubeDownload = async () => {
    if (!ytUrl.trim()) return;
    setYtBusy('download');
    setYtError(null);
    setYtProgress(1);
    setYtStep('Starting download...');
    setYtSavedTo(null);
    try {
      const startRes = await fetch(apiUrl('/api/youtube/download'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ytUrl.trim(), quality: ytQuality })
      });
      if (!startRes.ok) throw new Error(await readApiError(startRes, 'Could not start download'));
      const { task_id } = await startRes.json();

      let done = false;
      let savedTo = '';
      while (!done) {
        await new Promise((r) => setTimeout(r, 1000));
        const progRes = await fetch(apiUrl(`/api/youtube/progress/${task_id}`));
        if (!progRes.ok) throw new Error('Download task lost');
        const prog = await progRes.json();
        setYtProgress(prog.progress ?? 0);
        setYtStep(prog.step || '');
        if (prog.status === 'error') throw new Error(prog.error || 'Download failed');
        if (prog.status === 'completed') {
          done = true;
          savedTo = prog.saved_to || '';
        }
      }

      setYtStep('Loading video into the editor...');
      const fileRes = await fetch(apiUrl(`/api/youtube/file/${task_id}`));
      if (!fileRes.ok) throw new Error('Could not load downloaded video');
      const blob = await fileRes.blob();
      const baseName = (ytInfo?.title || 'youtube-video').replace(/[^\w\- .]+/g, ' ').trim().slice(0, 80) || 'youtube-video';
      const file = new File([blob], `${baseName}.mp4`, { type: 'video/mp4' });
      setVideo(file, URL.createObjectURL(file), file.name);
      setActiveTab('captions');
      setYtProgress(100);
      setYtStep('Done');
      setYtSavedTo(savedTo || null);
    } catch (e: any) {
      setYtError(e?.message || 'Download failed');
    } finally {
      setYtBusy(null);
    }
  };

  const presets = templatesData as SubtitlePreset[];

  const filteredPresets = useMemo(() => {
    return presets.filter(p => {
      const matchesCat = selectedCategory === "All" || p.category === selectedCategory;
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            p.fontFamily.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            p.category.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [presets, selectedCategory, searchQuery]);

  const activePreset = useMemo(() => {
    const found = presets.find(p => p.id === activeTemplateId) || presets[0];
    return { ...found, ...customStyleOverrides };
  }, [presets, activeTemplateId, customStyleOverrides]);

  const handleVideoUpload = async (file: File) => {
    const url = URL.createObjectURL(file);
    setVideo(file, url, file.name);
    setActiveTab('captions');
    await startTranscription(file, selectedModel, selectedLanguage);
  };

  const handleStartTranscribe = () => {
    if (!videoFile) return;
    startTranscription(videoFile, selectedModel, selectedLanguage);
  };

  const handleBrollSearch = async (kw: string) => {
    if (!kw.trim()) return;
    setBrollKeyword(kw);
    setIsSearchingBroll(true);
    try {
      const queryParams = new URLSearchParams({ keyword: kw, api_key: pexelsKey });
      const res = await fetch(apiUrl(`/api/broll/search?${queryParams}`));
      if (res.ok) {
        const data = await res.json();
        setBrollResults(data.results || []);
      }
    } catch (e) {
      console.warn("B-roll search error:", e);
    } finally {
      setIsSearchingBroll(false);
    }
  };

  const handleInsertBroll = (clip: any) => {
    const matchedWord = transcript.find(w => w.word.toLowerCase().includes(clip.keyword));
    const start = matchedWord ? matchedWord.start : useVideoStore.getState().currentTime;
    const end = start + Math.min(clip.duration || 3, 3.0);
    addBroll({
      id: `broll-${Date.now()}`,
      keyword: clip.keyword,
      title: clip.title || `${clip.keyword.toUpperCase()} Clip`,
      preview_url: clip.preview_url,
      video_url: clip.video_url,
      duration: clip.duration || 3,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      enabled: true
    });
  };

  return (
    <div className="w-[380px] lg:w-[420px] h-full flex flex-col bg-[#101014]/95 backdrop-blur-2xl border-r border-white/[0.08] select-none flex-shrink-0">
      {/* Top macOS Segmented Tab Strip */}
      <div className="h-13 border-b border-white/[0.08] px-2.5 flex items-center bg-zinc-950/40 backdrop-blur-md">
        <div className="flex items-center space-x-1 p-1 bg-zinc-900/80 rounded-xl border border-white/[0.06] w-full overflow-x-auto no-scrollbar shadow-inner">
          <button
            onClick={() => setActiveTab('youtube')}
            className={`flex-1 flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'youtube'
                ? 'bg-zinc-800 text-white shadow-xs ring-1 ring-white/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <CirclePlay className="w-3.5 h-3.5 text-red-400" />
            <span>YouTube</span>
          </button>

          <button
            onClick={() => setActiveTab('captions')}
            className={`flex-1 flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'captions'
                ? 'bg-zinc-800 text-white shadow-xs ring-1 ring-white/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Subtitles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Captions</span>
            <span className="text-[9px] px-1 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">AI</span>
          </button>

          <button
            onClick={() => setActiveTab('text')}
            className={`flex-1 flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'text'
                ? 'bg-zinc-800 text-white shadow-xs ring-1 ring-white/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Type className="w-3.5 h-3.5 text-sky-400" />
            <span>Styles</span>
          </button>

          <button
            onClick={() => setActiveTab('shorts')}
            className={`flex-1 flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'shorts'
                ? 'bg-zinc-800 text-white shadow-xs ring-1 ring-white/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span>Shorts</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.08] text-zinc-300 font-mono">
              {clips.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('broll')}
            className={`flex-1 flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'broll'
                ? 'bg-zinc-800 text-white shadow-xs ring-1 ring-white/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Film className="w-3.5 h-3.5 text-emerald-400" />
            <span>B-Roll</span>
          </button>

          <button
            onClick={() => setActiveTab('media')}
            className={`flex-1 flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'media'
                ? 'bg-zinc-800 text-white shadow-xs ring-1 ring-white/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5 text-purple-400" />
            <span>Media</span>
          </button>

          <button
            onClick={() => setActiveTab('audio')}
            className={`flex-1 flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'audio'
                ? 'bg-zinc-800 text-white shadow-xs ring-1 ring-white/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Music className="w-3.5 h-3.5 text-pink-400" />
            <span>Audio</span>
          </button>
        </div>
      </div>

      {/* Main Tab Content Area */}
      <div className="flex-1 overflow-y-auto p-3.5 text-zinc-200 space-y-4">
        {/* ======================= YOUTUBE TAB ======================= */}
        {activeTab === 'youtube' && (
          <div className="space-y-3" data-testid="youtube-tab">
            <div className="flex items-center space-x-2">
              <CirclePlay className="w-4 h-4 text-red-400" />
              <h4 className="text-xs font-bold text-white tracking-tight">Import from YouTube</h4>
            </div>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Paste a link, download the video and edit it here. Use only videos you own or have permission to use.
            </p>
            <input
              value={ytUrl}
              onChange={(e) => { setYtUrl(e.target.value); setYtInfo(null); setYtError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleYoutubeInfo(); }}
              placeholder="https://www.youtube.com/watch?v=..."
              disabled={ytBusy !== null}
              className="w-full bg-zinc-950/80 border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <div className="space-y-1" data-testid="youtube-folder">
              <label className="text-[11px] font-semibold text-zinc-300">Save to folder</label>
              <div className="flex items-center space-x-2">
                <input
                  value={ytDirDraft}
                  onChange={(e) => setYtDirDraft(e.target.value)}
                  onBlur={() => { if (ytDirDraft.trim() && ytDirDraft !== ytDir) saveYoutubeDir(ytDirDraft); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveYoutubeDir(ytDirDraft); }}
                  disabled={ytBusy !== null}
                  placeholder="C:\Users\you\Downloads"
                  className="flex-1 min-w-0 bg-zinc-950/80 border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <button
                  onClick={browseYoutubeDir}
                  disabled={ytBusy !== null}
                  className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white border border-white/10 disabled:opacity-50 flex items-center space-x-1"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Browse</span>
                </button>
              </div>
              <p className="text-[10px] text-zinc-500">Downloads are saved only here (default: Downloads).</p>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={ytQuality}
                onChange={(e) => setYtQuality(e.target.value)}
                disabled={ytBusy !== null}
                className="flex-1 bg-zinc-950/80 border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="360">360p</option>
                <option value="480">480p</option>
                <option value="720">720p</option>
                <option value="1080">1080p</option>
                <option value="1440">1440p</option>
                <option value="best">Best available</option>
              </select>
              <button
                onClick={handleYoutubeInfo}
                disabled={!ytUrl.trim() || ytBusy !== null}
                className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white border border-white/10 disabled:opacity-50 flex items-center space-x-1"
              >
                {ytBusy === 'info' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                <span>Check link</span>
              </button>
            </div>

            {ytInfo && (
              <div className="flex space-x-3 p-2.5 rounded-xl bg-zinc-900/70 border border-white/[0.06]">
                {ytInfo.thumbnail && (
                  <img src={ytInfo.thumbnail} alt="" referrerPolicy="no-referrer" className="w-24 h-14 object-cover rounded-lg flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white line-clamp-2">{ytInfo.title}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">
                    {ytInfo.uploader ? `${ytInfo.uploader} · ` : ''}{Math.floor(ytInfo.duration / 60)}:{String(ytInfo.duration % 60).padStart(2, '0')}
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handleYoutubeDownload}
              disabled={!ytUrl.trim() || ytBusy !== null}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white font-semibold text-xs shadow-lg shadow-red-500/20 flex items-center justify-center space-x-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ytBusy === 'download' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>{ytBusy === 'download' ? 'Downloading...' : 'Download & open in editor'}</span>
            </button>

            {ytBusy === 'download' && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span className="truncate max-w-[240px]">{ytStep}</span>
                  <span className="font-mono text-cyan-400">{ytProgress}%</span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-gradient-to-r from-red-400 to-rose-400 h-1.5 rounded-full transition-all duration-300" style={{ width: `${Math.max(3, ytProgress)}%` }} />
                </div>
              </div>
            )}

            {ytSavedTo && (
              <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-[11px] break-all" data-testid="youtube-saved">
                Saved to: {ytSavedTo}
              </div>
            )}

            {ytError && (
              <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs flex items-start space-x-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{ytError}</span>
              </div>
            )}
          </div>
        )}

        {/* ======================= AUTO CAPTIONS TAB ======================= */}
        {activeTab === 'captions' && (
          <div className="space-y-4 animate-fade">
            <div className="bg-zinc-900/70 border border-white/[0.08] rounded-2xl p-4 space-y-3.5 shadow-sm ring-1 ring-white/[0.04]">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500/20 to-sky-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-sm">
                    <Sparkles className="w-4 h-4 text-indigo-300" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white tracking-tight">Auto Captions & Subtitles</h4>
                    <p className="text-[10px] text-zinc-400">Generate viral word-accurate captions with AI.</p>
                  </div>
                </div>
              </div>

              {/* Language Selector */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-zinc-300 flex items-center justify-between">
                  <span>Language</span>
                  <span className="text-[10px] text-indigo-400">Auto Word Timestamps</span>
                </label>
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="w-full bg-zinc-950/80 border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                >
                  <option value="auto">Auto Detect</option>
                  <option value="urdu">Urdu (Roman Urdu)</option>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="es">Spanish</option>
                  <option value="ar">Arabic</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="ru">Russian (Русский)</option>
                  <option value="ur_script">Urdu Script (اردو خط)</option>
                </select>
                {detectedLanguage && selectedLanguage === 'auto' && (
                  <p
                    className={`text-[10px] ${detectedLanguage.probability !== null && detectedLanguage.probability < 0.6 ? 'text-amber-400' : 'text-emerald-400'}`}
                    data-testid="detected-language"
                  >
                    Detected: {detectedLanguage.code.toUpperCase()}
                    {detectedLanguage.probability !== null ? ` (${Math.round(detectedLanguage.probability * 100)}%)` : ''}
                    {detectedLanguage.probability !== null && detectedLanguage.probability < 0.6
                      ? ' - not sure. Pick the language manually and generate again.'
                      : ''}
                  </p>
                )}
              </div>

              {/* Model Choice */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-zinc-300">Speech Engine</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-zinc-950/80 border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                >
                  <option value="whisper-large-v3-turbo">⚡ Ultra Fast Cloud Engine (~2-3s) [Recommended]</option>
                  <option value="base">💻 Standard Offline Engine (On-Device)</option>
                  <option value="small">💻 High Accuracy Offline Engine (On-Device)</option>
                  <option value="turbo">🎯 Turbo - accurate offline (large-v3-turbo, ~1.5 GB first run)</option>
                  <option value="large-v3">🏆 Large-v3 - best offline accuracy (~3 GB first run, slow)</option>
                </select>
              </div>

              <div className="space-y-1.5" data-testid="asr-options">
                <label className="flex items-start space-x-2 text-[11px] text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={enhanceAudio} onChange={(e) => setEnhanceAudio(e.target.checked)} className="mt-0.5 accent-indigo-500" />
                  <span>Clean up audio first <span className="text-zinc-500">(noise, rumble, loudness)</span></span>
                </label>
                <label className="flex items-start space-x-2 text-[11px] text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={retryWeak} onChange={(e) => setRetryWeak(e.target.checked)} className="mt-0.5 accent-indigo-500" />
                  <span>Re-check uncertain parts with the large model <span className="text-zinc-500">(offline engines only, downloads ~1.5 GB once)</span></span>
                </label>
              </div>

              {/* Glossary: names/terms Whisper often mishears */}
              <div className="space-y-1.5" data-testid="glossary-block">
                <label className="text-[11px] font-semibold text-zinc-300">Glossary (names &amp; terms)</label>
                <textarea
                  value={glossary}
                  onChange={(e) => setGlossary(e.target.value)}
                  rows={2}
                  placeholder="ChatGPT, Kubernetes, Kadr"
                  className="w-full bg-zinc-950/80 border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                />
                <div className="flex items-center space-x-2" data-testid="glossary-sets">
                  <select
                    value=""
                    onChange={(e) => {
                      const found = glossarySets.find((x) => x.name === e.target.value);
                      if (found) setGlossary(found.terms);
                    }}
                    className="flex-1 min-w-0 bg-zinc-950/80 border border-white/[0.08] rounded-lg px-2 py-1 text-[10px] text-zinc-300 cursor-pointer"
                  >
                    <option value="">{glossarySets.length ? 'Load saved set...' : 'No saved sets yet'}</option>
                    {glossarySets.map((x) => (
                      <option key={x.name} value={x.name}>{x.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const name = window.prompt('Name for this glossary set (e.g. project or channel)');
                      if (name) saveGlossarySet(name);
                    }}
                    disabled={!glossary.trim()}
                    className="text-[10px] text-indigo-400 hover:underline disabled:opacity-40 disabled:no-underline whitespace-nowrap"
                  >
                    Save as set
                  </button>
                  {glossarySets.length > 0 && (
                    <button
                      onClick={() => {
                        const name = window.prompt('Delete which saved set? Type its name:\n' + glossarySets.map((x) => x.name).join(', '));
                        if (name) deleteGlossarySet(name.trim());
                      }}
                      className="text-[10px] text-red-400 hover:underline whitespace-nowrap"
                    >
                      Delete
                    </button>
                  )}
                </div>
                {transcript.length > 0 && (
                  <button
                    onClick={async () => {
                      const n = await applyGlossaryToTranscript();
                      setLocalNotice(n > 0 ? `Glossary applied: ${n} word(s) fixed` : 'Glossary: nothing to fix');
                    }}
                    disabled={!glossary.trim()}
                    className="text-[10px] text-indigo-400 hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Apply glossary to current captions
                  </button>
                )}
              </div>

              {/* Paste a script: keep word timings, replace the text */}
              {transcript.length > 0 && (
                <div className="space-y-1.5" data-testid="align-block">
                  <label className="text-[11px] font-semibold text-zinc-300">Fix text from script</label>
                  <textarea
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                    rows={3}
                    placeholder="Paste the correct text. Existing word timings are kept."
                    className="w-full bg-zinc-950/80 border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                  />
                  <button
                    onClick={async () => {
                      const ok = await alignTranscriptToText(scriptText);
                      setLocalNotice(ok ? 'Captions updated from script' : 'Could not align script');
                      if (ok) setScriptText('');
                    }}
                    disabled={!scriptText.trim()}
                    className="text-[10px] text-indigo-400 hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Align script to captions
                  </button>
                </div>
              )}
              {localNotice && <div className="text-[10px] text-emerald-400">{localNotice}</div>}

              {/* Transcribe Action Button */}
              <button
                onClick={handleStartTranscribe}
                disabled={!videoFile || isTranscribing}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 hover:from-indigo-400 hover:to-sky-400 text-white font-semibold text-xs shadow-lg shadow-indigo-500/25 border border-indigo-400/30 flex items-center justify-center space-x-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed tracking-wide"
              >
                <Subtitles className="w-4 h-4 stroke-[2.2]" />
                <span>{isTranscribing ? 'Generating Auto Captions...' : 'Generate Auto Captions'}</span>
              </button>

              {/* Transcribe Progress Bar */}
              {isTranscribing && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-[10px] text-zinc-400">
                    <span className="truncate max-w-[200px]">{transcribingStep || 'Processing audio...'}</span>
                    <span className="font-mono text-cyan-400">{transcribeProgress}%</span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-cyan-400 to-teal-400 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(5, transcribeProgress)}%` }}
                    />
                  </div>
                  <button
                    onClick={cancelTranscription}
                    className="text-[10px] text-red-400 hover:underline pt-0.5 block mx-auto"
                  >
                    Cancel transcription
                  </button>
                </div>
              )}

              {/* Transcription Error Banner */}
              {transcribeError && (
                <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs flex flex-col space-y-1">
                  <div className="flex items-center justify-between font-bold">
                    <div className="flex items-center space-x-1.5 text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>Transcription Failed</span>
                    </div>
                    <button
                      onClick={clearTranscribeError}
                      className="text-[10px] text-zinc-400 hover:text-white px-1"
                    >
                      ✕
                    </button>
                  </div>
                  <span className="text-[10px] text-red-200/80 leading-relaxed">{transcribeError}</span>
                </div>
              )}
            </div>

            {/* Current Transcript Stats */}
            <div className="bg-zinc-900/70 border border-white/[0.08] rounded-2xl p-3.5 flex items-center justify-between text-xs shadow-sm ring-1 ring-white/[0.04]">
              <span className="text-zinc-400">Total Word Tokens:</span>
              <span className="font-mono font-bold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md">
                {transcript.length} words
              </span>
            </div>
          </div>
        )}

        {/* ======================= TEXT TEMPLATES TAB ======================= */}
        {activeTab === 'text' && (
          <div className="space-y-3.5 animate-fade">
            {/* Search and Category Filter */}
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search 100+ styles (e.g. MrBeast, Hormozi)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-950/80 border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 no-scrollbar">
                {TEMPLATE_CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold transition-all ${
                      selectedCategory === cat
                        ? 'bg-zinc-800 text-white shadow-xs ring-1 ring-white/10 font-bold'
                        : 'bg-zinc-950/70 text-zinc-400 hover:text-zinc-200 border border-white/[0.06] hover:bg-white/[0.04]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Templates Grid */}
            <div className="grid grid-cols-2 gap-2.5 max-h-[calc(100vh-230px)] overflow-y-auto pr-1">
              {filteredPresets.map(preset => {
                const isSelected = preset.id === activeTemplateId;
                return (
                  <div
                    key={preset.id}
                    onClick={() => setActiveTemplate(preset.id)}
                    className={`relative p-3 rounded-2xl border cursor-pointer transition-all duration-150 flex flex-col justify-between h-24 ${
                      isSelected
                        ? 'bg-indigo-950/30 border-indigo-400/80 ring-2 ring-indigo-500/30 shadow-lg shadow-indigo-500/10'
                        : 'bg-zinc-900/60 border-white/[0.08] hover:border-white/[0.18] hover:bg-zinc-800/50'
                    }`}
                  >
                    {/* Top title & active check */}
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-white truncate max-w-[120px]">
                        {preset.name}
                      </span>
                      {isSelected && (
                        <div className="w-4 h-4 rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 flex items-center justify-center shadow-xs">
                          <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
                        </div>
                      )}
                    </div>

                    {/* Live styled sample text preview */}
                    <div className="my-auto flex items-center justify-center py-1">
                      <span
                        className="font-black text-xs tracking-tight"
                        style={{
                          fontFamily: `${preset.fontFamily}, 'Montserrat', sans-serif`,
                          color: preset.highlightColor || preset.primaryColor,
                          WebkitTextStroke: preset.outlineWidth > 0 ? `1.5px ${preset.outlineColor}` : undefined,
                          paintOrder: 'stroke fill',
                          textShadow: preset.shadowDepth > 0 ? `0px 2px 4px ${preset.shadowColor}` : undefined,
                        }}
                      >
                        {formatCasing("SAMPLE TEXT", preset.textCasing)}
                      </span>
                    </div>

                    {/* Bottom tags */}
                    <div className="flex items-center justify-between text-[9px] text-zinc-500">
                      <span className="truncate max-w-[80px]">{preset.category}</span>
                      <span className="capitalize text-indigo-400 font-mono font-medium">{preset.animationTrigger}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ======================= MEDIA TAB ======================= */}
        {activeTab === 'media' && (
          <div className="space-y-4 animate-fade">
            {videoFile || videoUrl ? (
              <div className="bg-[#202024] border border-[#27272a] rounded-xl p-4 space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 flex-shrink-0">
                    <Film className="w-6 h-6" />
                  </div>
                  <div className="overflow-hidden">
                    <h4 className="text-xs font-bold text-white truncate">{videoName || videoFile?.name || 'Imported Video'}</h4>
                    <p className="text-[10px] text-zinc-400 font-mono">
                      Duration: {formatTime(duration)} ({duration.toFixed(1)}s)
                    </p>
                    {videoFile && (
                      <p className="text-[10px] text-zinc-500 font-mono">
                        Size: {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
                      </p>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-[#27272a]">
                  <label className="w-full py-2 px-3 rounded-lg bg-[#141416] hover:bg-zinc-800 border border-[#27272a] text-xs font-semibold text-zinc-200 cursor-pointer flex items-center justify-center space-x-2 transition-colors">
                    <Upload className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Replace Video File</span>
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleVideoUpload(file);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file && (file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|webm|mkv|avi)$/i))) {
                    handleVideoUpload(file);
                  }
                }}
                className="border-2 border-dashed border-[#27272a] hover:border-cyan-500/60 rounded-2xl p-6 text-center space-y-3 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 text-cyan-400 mx-auto flex items-center justify-center">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Import Video</h4>
                  <p className="text-xs text-zinc-400 mt-1">Drag & drop video to auto-generate captions & viral shorts</p>
                </div>
                <label className="inline-block px-4 py-2 rounded-lg bg-cyan-400 text-black font-bold text-xs cursor-pointer hover:bg-cyan-300 transition-colors">
                  Browse Files
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleVideoUpload(file);
                      }
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {/* ======================= AI SHORTS TAB ======================= */}
        {activeTab === 'shorts' && <ShortsPanel />}

        {/* ======================= B-ROLL TAB ======================= */}
        {activeTab === 'broll' && (
          <div className="space-y-3 animate-fade">
            <div className="space-y-2">
              <div className="flex space-x-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search B-Roll stock (e.g. money, city, coding)..."
                    value={brollKeyword}
                    onChange={(e) => setBrollKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleBrollSearch(brollKeyword);
                    }}
                    className="w-full bg-[#141416] border border-[#27272a] rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <button
                  onClick={() => handleBrollSearch(brollKeyword)}
                  className="px-3 py-1.5 rounded-lg bg-cyan-400 text-black font-bold text-xs hover:bg-cyan-300"
                >
                  Search
                </button>
              </div>
            </div>

            {/* Search Results */}
            {brollResults.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {brollResults.map((r, i) => (
                  <div key={i} className="bg-[#202024] border border-[#27272a] rounded-lg p-1.5 space-y-1">
                    <img src={r.preview_url} alt="" className="w-full h-20 object-cover rounded" />
                    <button
                      onClick={() => handleInsertBroll(r)}
                      className="w-full py-1 text-[10px] font-bold bg-cyan-400/20 text-cyan-300 rounded hover:bg-cyan-400/30"
                    >
                      + Add to Timeline
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Active B-Roll list */}
            <div className="space-y-1.5 pt-2">
              <span className="text-[11px] font-bold text-zinc-300">Active B-Roll Overlays ({brollList.length})</span>
              {brollList.map(b => (
                <div key={b.id} className="flex items-center justify-between p-2 rounded-lg bg-[#202024] border border-[#27272a] text-xs">
                  <span className="text-zinc-200 font-medium truncate max-w-[140px]">{b.keyword}</span>
                  <span className="font-mono text-[10px] text-zinc-400">{b.start}s - {b.end}s</span>
                  <button
                    onClick={() => removeBroll(b.id)}
                    className="p-1 hover:text-red-400 text-zinc-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ======================= AUDIO TAB ======================= */}
        {activeTab === 'audio' && (
          <div className="space-y-4 animate-fade">
            <div className="bg-[#202024] border border-[#27272a] rounded-xl p-3.5 space-y-3">
              <h4 className="text-xs font-bold text-white flex items-center space-x-1.5">
                <Volume2 className="w-4 h-4 text-cyan-400" />
                <span>Audio Track Controls</span>
              </h4>

              <div className="space-y-1">
                <div className="flex justify-between text-xs text-zinc-300">
                  <span>Track Volume:</span>
                  <span className="font-mono text-cyan-400">{Math.round(videoVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={videoVolume}
                  onChange={(e) => setVideoVolume(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              <div className="space-y-1 pt-2">
                <div className="flex justify-between text-xs text-zinc-300">
                  <span>Playback Speed:</span>
                  <span className="font-mono text-cyan-400">{videoSpeed}x</span>
                </div>
                <div className="grid grid-cols-5 gap-1 pt-1">
                  {[0.5, 0.75, 1.0, 1.25, 1.5].map(s => (
                    <button
                      key={s}
                      onClick={() => setVideoSpeed(s)}
                      className={`py-1 rounded text-xs font-mono font-semibold ${
                        videoSpeed === s
                          ? 'bg-cyan-500 text-black font-bold'
                          : 'bg-[#141416] text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
