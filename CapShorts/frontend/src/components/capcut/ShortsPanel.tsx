import React, { useMemo, useRef, useState } from 'react';
import { Scissors, Flame, Pencil, Trash2, Plus, Crosshair, FolderOpen, Layers, Copy, SplitSquareHorizontal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useVideoStore } from '../../store/useVideoStore';
import { apiUrl } from '../../config';
import { formatTime } from '../../utils/timeFormat';
import { snapToWord, wordIndexesInRange } from '../../utils/clipEdit';
import { suggestTitle, TITLE_DEFAULT_SECONDS, TITLE_STYLES, TitleStyle } from '../../utils/titleOverlay';
import { buildExportPayload, shortFileName } from '../../utils/exportPayload';
import { batchSummary, BatchItem, runBatchExport } from '../../utils/batchExport';
import { findPreset } from '../../utils/presets';
import { exportFileName, ExportAllSettings, loadExportAllSettings, pickClips, saveExportAllSettings } from '../../utils/exportAllSettings';
import { ExportAllSettingsForm } from './ExportAllSettingsForm';
import { BatchVideosModal } from './BatchVideosModal';
import { SubtitlePreset } from '../../types';

/** The detection's tier, or one derived from the score for shorts made before tiers existed. */
export const clipTier = (c: { tier?: 'strong' | 'good' | 'fair'; virality_score: number }) =>
  c.tier ?? (c.virality_score >= 75 ? 'strong' : c.virality_score >= 62 ? 'good' : 'fair');

const TIER_STYLE = {
  strong: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
  good: 'text-sky-300 bg-sky-500/15 border-sky-500/30',
  fair: 'text-zinc-300 bg-zinc-700/40 border-white/10',
} as const;

const inputCls =
  'bg-zinc-950/80 border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors';
const smallBtn =
  'px-1.5 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-[10px] font-mono text-zinc-200 transition-colors';

export const ShortsPanel: React.FC = () => {
  const {
    clips, selectedClipId, selectClip, setClips, updateClip, deleteClip, addClip,
    transcript, duration, setCurrentTime, setIsExportModalOpen, updateWord, duplicateClip, splitClip,
    videoFile, serverVideoPath, activeTemplateId, customStyleOverrides, brollList, showEmojis,
  } = useVideoStore(
    useShallow((s) => ({
      clips: s.clips,
      selectedClipId: s.selectedClipId,
      selectClip: s.selectClip,
      setClips: s.setClips,
      updateClip: s.updateClip,
      deleteClip: s.deleteClip,
      addClip: s.addClip,
      transcript: s.transcript,
      duration: s.duration,
      updateWord: s.updateWord,
      duplicateClip: s.duplicateClip,
      splitClip: s.splitClip,
      setCurrentTime: s.setCurrentTime,
      setIsExportModalOpen: s.setIsExportModalOpen,
      videoFile: s.videoFile,
      serverVideoPath: s.serverVideoPath,
      activeTemplateId: s.activeTemplateId,
      customStyleOverrides: s.customStyleOverrides,
      brollList: s.brollList,
      showEmojis: s.showEmojis,
    }))
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [autoCount, setAutoCount] = useState(true);
  const [onlyStrong, setOnlyStrong] = useState(false);
  const tierCounts = useMemo(() => {
    const t = { strong: 0, good: 0, fair: 0 };
    for (const c of clips) t[clipTier(c)] += 1;
    return t;
  }, [clips]);
  const visibleClips = onlyStrong ? clips.filter((c) => clipTier(c) === 'strong' || c.id === editingId) : clips;
  const editingClip = clips.find((c) => c.id === editingId) || null;
  // Words of the short being edited (indexes into the transcript), for editing its captions in place
  const editingWords = useMemo(
    () => (editingClip ? wordIndexesInRange(transcript, editingClip.start, editingClip.end) : []),
    [transcript, editingClip?.start, editingClip?.end],      // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [snap, setSnap] = useState(true);
  const [minLen, setMinLen] = useState(25);
  const [maxLen, setMaxLen] = useState(60);
  const [count, setCount] = useState(5);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // ---- batch export of all shorts
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDir, setBatchDir] = useState('');
  const stopRef = useRef(false);
  const [exportAllSettings, setExportAllSettings] = useState<ExportAllSettings>(loadExportAllSettings);
  const [showExportSettings, setShowExportSettings] = useState(false);
  const [batchVideosOpen, setBatchVideosOpen] = useState(false);
  const exportList = pickClips(clips, exportAllSettings.which);

  const exportAll = async () => {
    if (!exportList.length || batchRunning) return;
    if (!videoFile && !serverVideoPath) {
      setNote('Open a video first.');
      return;
    }
    setNote(null);
    setBatchRunning(true);
    stopRef.current = false;
    setBatchItems(exportList.map((c) => ({ clipId: c.id, title: c.title, status: 'queued', progress: 0 })));
    try {
      fetch(apiUrl('/api/export/settings')).then((r) => (r.ok ? r.json() : null)).then((d) => d?.export_dir && setBatchDir(d.export_dir)).catch(() => undefined);

      // the engine renders from its own copy of the video: send it once
      let videoPath = serverVideoPath;
      if (!videoPath && videoFile) {
        const form = new FormData();
        form.append('file', videoFile);
        const up = await fetch(apiUrl('/api/upload-video'), { method: 'POST', body: form });
        if (!up.ok) throw new Error('Could not send the video to the render engine');
        videoPath = (await up.json()).video_path;
        useVideoStore.setState({ serverVideoPath: videoPath });
      }

      const preset = findPreset(activeTemplateId, useVideoStore.getState().userPresets);
      const list = exportList;
      const ea = exportAllSettings;
      const videoName = useVideoStore.getState().videoName || videoFile?.name || 'video';
      await runBatchExport({
        clips: list,
        buildPayload: (clip, index) =>
          buildExportPayload({
            videoPath, preset, customStyleOverrides, brollList,
            transcript: ea.subtitles ? transcript : [],
            showEmojis: showEmojis && ea.emoji && ea.subtitles,
            outputFilename: exportFileName(ea.naming, index, clip, list.length, videoName),
            resolution: ea.resolution,
            framing: ea.framing,
            clip: ea.hookTitle ? clip : { start: clip.start, end: clip.end },
          }),
        onUpdate: setBatchItems,
        shouldStop: () => stopRef.current,
      });
    } catch (e: any) {
      setNote(e?.message || 'Batch export failed');
    } finally {
      setBatchRunning(false);
    }
  };

  const openExportFolder = async () => {
    try {
      const r = await fetch(apiUrl('/api/export/open-folder'), { method: 'POST' });
      if (!r.ok) setNote('Could not open the folder');
    } catch {
      setNote('Could not reach the engine');
    }
  };

  const maybeSnap = (t: number, edge: 'start' | 'end') => (snap && transcript.length ? snapToWord(transcript, t, edge) : t);

  const redetect = async () => {
    if (!transcript.length) {
      setNote('Generate captions first, the shorts are cut from the transcript.');
      return;
    }
    if (clips.some((c) => c.custom) && !window.confirm('Re-detect replaces all shorts, including the ones you edited. Continue?')) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(apiUrl('/api/clips/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          words: transcript.map(({ start, end, word, keyword }) => ({ start, end, word, keyword })),
          duration: duration || 60,
          min_clip_duration: Math.max(1, minLen),
          max_clip_duration: Math.max(minLen, maxLen),
          ...(autoCount ? {} : { target_clips_count: Math.max(1, count) }),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setClips(data.clips || []);
        setEditingId(null);
        setNote(null);
      } else {
        setNote('Could not detect shorts');
      }
    } catch {
      setNote('Could not reach the engine');
    } finally {
      setBusy(false);
    }
  };

  const createAtPlayhead = () => {
    const start = maybeSnap(useVideoStore.getState().currentTime, 'start');
    const id = addClip(start, Math.min(duration || start + 30, start + 30), 'My short');
    // snap the end of the new clip too
    const end = maybeSnap(Math.min(duration || start + 30, start + 30), 'end');
    updateClip(id, { end }, 'end');
    setEditingId(id);
  };

  return (
    <div className="space-y-3 animate-fade" data-testid="shorts-panel">
      <div className="flex items-center justify-between pb-1">
        <div>
          <h4 className="text-xs font-bold text-white flex items-center space-x-1.5">
            <Scissors className="w-3.5 h-3.5 text-cyan-400" />
            <span>Shorts ({clips.length})</span>
          </h4>
          <p className="text-[10px] text-zinc-400">Detected highlights. Edit, add or delete them.</p>
        </div>
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="text-[10px] px-2 py-1 rounded-lg bg-zinc-950/80 border border-white/[0.08] text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            Settings
          </button>
          <button
            onClick={redetect}
            disabled={busy}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-zinc-950/80 border border-white/[0.08] text-indigo-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            {busy ? 'Detecting...' : 'Re-detect'}
          </button>
        </div>
      </div>

      {clips.length > 0 && (
        <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.06] space-y-1.5" data-testid="shorts-summary">
          <div className="text-[11px] text-zinc-200">
            <span className="font-bold text-white">{clips.length} short{clips.length === 1 ? '' : 's'}</span>
            {duration > 0 && <span className="text-zinc-400"> from the whole video ({formatTime(duration)})</span>}
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" data-testid="tier-strong">{tierCounts.strong} strong</span>
            <span className="px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30" data-testid="tier-good">{tierCounts.good} good</span>
            <span className="px-1.5 py-0.5 rounded-full bg-zinc-700/40 text-zinc-300 border border-white/10" data-testid="tier-fair">{tierCounts.fair} fair</span>
            {tierCounts.strong > 0 && tierCounts.strong < clips.length && (
              <label className="ml-auto flex items-center space-x-1 text-zinc-400">
                <input type="checkbox" checked={onlyStrong} onChange={(e) => setOnlyStrong(e.target.checked)} data-testid="only-strong" />
                <span>strong only</span>
              </label>
            )}
          </div>
        </div>
      )}

      {showSettings && (
        <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.06]" data-testid="shorts-settings">
          <label className="text-[10px] text-zinc-400 space-y-1">
            <span>Min length, s</span>
            <input type="number" min={5} max={170} value={minLen} onChange={(e) => setMinLen(Number(e.target.value) || 5)} className={`${inputCls} w-full`} />
          </label>
          <label className="text-[10px] text-zinc-400 space-y-1">
            <span>Max length, s</span>
            <input type="number" min={5} max={180} value={maxLen} onChange={(e) => setMaxLen(Number(e.target.value) || 60)} className={`${inputCls} w-full`} />
          </label>
          <label className="text-[10px] text-zinc-400 space-y-1">
            <span className="flex items-center justify-between">
              <span>How many</span>
              <span className="flex items-center space-x-1">
                <input type="checkbox" checked={autoCount} onChange={(e) => setAutoCount(e.target.checked)} data-testid="auto-count" />
                <span>Auto</span>
              </span>
            </span>
            {autoCount ? (
              <div className="text-[10px] text-zinc-500 leading-tight py-1" title="Every distinct moment that is good enough, about one per 2 minutes of video at most">
                as many as the video gives
              </div>
            ) : (
              <input type="number" min={1} max={40} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} className={`${inputCls} w-full`} data-testid="count-input" />
            )}
          </label>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={createAtPlayhead}
          disabled={!duration}
          className="flex items-center space-x-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/25 transition-colors disabled:opacity-40"
          data-testid="add-short"
          title="Create a new short that starts at the playhead"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New short at playhead</span>
        </button>
        <button
          onClick={exportAll}
          disabled={!clips.length || batchRunning}
          className="flex items-center space-x-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/25 transition-colors disabled:opacity-40"
          data-testid="export-all"
          title="Render every short into the export folder"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Export {exportAllSettings.which === 'all' ? 'all' : exportAllSettings.which === 'strong' ? 'strong' : 'best'} ({exportList.length})</span>
        </button>
        <button
          onClick={() => setShowExportSettings((v) => !v)}
          className={`text-[10px] px-2 py-1 rounded-lg border transition-colors ${showExportSettings ? 'bg-indigo-500/25 border-indigo-400/50 text-white' : 'bg-zinc-950/80 border-white/[0.08] text-zinc-300 hover:bg-zinc-800'}`}
          title="How Export all renders: which shorts, format, framing, subtitles, file names"
          data-testid="export-all-settings-toggle"
        >
          ⚙
        </button>
        <label className="flex items-center space-x-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} className="accent-indigo-500" />
          <span>Snap to words</span>
        </label>
      </div>
      {showExportSettings && (
        <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.06] space-y-2">
          <ExportAllSettingsForm
            value={exportAllSettings}
            onChange={(v) => { setExportAllSettings(v); saveExportAllSettings(v); }}
            exportDir={batchDir || undefined}
          />
          <button
            onClick={() => setBatchVideosOpen(true)}
            className="w-full flex items-center justify-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-[11px] text-zinc-200"
            data-testid="open-batch-videos"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Make shorts from several videos...</span>
          </button>
        </div>
      )}
      <BatchVideosModal open={batchVideosOpen} onClose={() => { setBatchVideosOpen(false); setExportAllSettings(loadExportAllSettings()); }} />
      {note && <p className="text-[10px] text-zinc-400">{note}</p>}

      {batchItems.length > 0 && (
        <div className="p-3 rounded-2xl bg-zinc-900/70 border border-white/[0.08] space-y-2" data-testid="batch-panel">
          {(() => {
            const sum = batchSummary(batchItems);
            return (
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-white" data-testid="batch-summary">
                  {batchRunning
                    ? `Exporting ${sum.done + sum.failed + 1 > sum.total ? sum.total : sum.done + sum.failed + 1} of ${sum.total}...`
                    : `Done: ${sum.done} saved${sum.failed ? `, ${sum.failed} failed` : ''}${sum.skipped ? `, ${sum.skipped} skipped` : ''}`}
                </span>
                {batchRunning && (
                  <button onClick={() => { stopRef.current = true; }} className="text-red-300 hover:text-red-200 underline" data-testid="batch-stop">
                    Stop after this one
                  </button>
                )}
              </div>
            );
          })()}
          <ul className="space-y-1.5">
            {batchItems.map((it) => (
              <li key={it.clipId} className="text-[10px]" data-testid="batch-row" data-status={it.status}>
                <div className="flex items-center justify-between">
                  <span className="truncate max-w-[190px] text-zinc-300">{it.title}</span>
                  <span className={
                    it.status === 'done' ? 'text-emerald-400' : it.status === 'failed' ? 'text-red-400' :
                    it.status === 'rendering' ? 'text-indigo-300' : 'text-zinc-500'
                  }>
                    {it.status === 'rendering' ? `${it.progress}%` : it.status}
                  </span>
                </div>
                {it.status === 'rendering' && (
                  <div className="h-1 mt-1 rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full bg-indigo-400 transition-all" style={{ width: `${it.progress}%` }} />
                  </div>
                )}
                {it.error && <p className="text-red-300/90 mt-0.5 break-words">{it.error}</p>}
              </li>
            ))}
          </ul>
          {batchDir && <p className="text-[10px] text-zinc-500 break-all">Folder: {batchDir}</p>}
          {!batchRunning && (
            <div className="flex items-center justify-between pt-1">
              <button onClick={openExportFolder} className="flex items-center space-x-1 text-[11px] text-indigo-300 hover:text-white" data-testid="open-export-folder">
                <FolderOpen className="w-3 h-3" />
                <span>Open folder</span>
              </button>
              <button onClick={() => setBatchItems([])} className="text-[11px] text-zinc-500 hover:text-zinc-300">Close</button>
            </div>
          )}
        </div>
      )}

      {clips.length === 0 && (
        <div className="p-3 rounded-xl border border-dashed border-white/10 text-center text-[11px] text-zinc-500">
          No shorts yet. Generate captions, or add one at the playhead.
        </div>
      )}

      <div className="space-y-2.5">
        {visibleClips.map((clip) => {
          const isSelected = selectedClipId === clip.id;
          const isEditing = editingId === clip.id;
          return (
            <div
              key={clip.id}
              data-testid="short-card"
              onClick={() => { selectClip(clip.id); setCurrentTime(clip.start); }}
              className={`p-3.5 rounded-2xl border cursor-pointer transition-all duration-150 ${
                isSelected
                  ? 'bg-indigo-950/30 border-indigo-400/80 ring-2 ring-indigo-500/30 shadow-lg shadow-indigo-500/10'
                  : 'bg-zinc-900/60 border-white/[0.08] hover:border-white/[0.18] hover:bg-zinc-800/40'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white truncate max-w-[170px]">{clip.title}</span>
                <div className="flex items-center space-x-1.5">
                  {clip.custom ? (
                    <span
                      className="text-[10px] font-bold text-cyan-300 bg-cyan-500/15 px-2 py-0.5 rounded-full border border-cyan-500/30"
                      title={clip.virality_score > 0 ? 'Edited by hand: the original virality score no longer applies' : 'Created by hand'}
                    >
                      {clip.virality_score > 0 ? 'Edited' : 'Custom'}
                    </span>
                  ) : (
                    <div
                      className={`flex items-center space-x-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${TIER_STYLE[clipTier(clip)]}`}
                      title={clip.rank ? `#${clip.rank} of ${clips.length} in this video` : undefined}
                      data-testid="short-tier"
                    >
                      <Flame className="w-3 h-3" />
                      <span>{clip.rank ? `#${clip.rank} · ` : ''}{clip.virality_score}</span>
                    </div>
                  )}
                  <button
                    title="Edit"
                    data-testid="edit-short"
                    onClick={(e) => { e.stopPropagation(); selectClip(clip.id); setEditingId(isEditing ? null : clip.id); }}
                    className={`p-1 rounded-md border transition-colors ${isEditing ? 'bg-indigo-500/30 border-indigo-400/60 text-white' : 'bg-zinc-800 border-white/10 text-zinc-300 hover:text-white'}`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    title="Delete"
                    data-testid="delete-short"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete "${clip.title}"?`)) {
                        deleteClip(clip.id);
                        if (editingId === clip.id) setEditingId(null);
                      }
                    }}
                    className="p-1 rounded-md bg-zinc-800 border border-white/10 text-red-400 hover:text-red-300 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {clip.hook && <p className="text-[11px] text-zinc-300 line-clamp-2 italic mb-2.5">"{clip.hook}"</p>}

              {isEditing && (
                <div className="space-y-2 mb-2.5 p-2.5 rounded-xl bg-black/30 border border-white/[0.06]" onClick={(e) => e.stopPropagation()} data-testid="short-editor">
                  <label className="block text-[10px] text-zinc-400 space-y-1">
                    <span>Title</span>
                    <input value={clip.title} onChange={(e) => updateClip(clip.id, { title: e.target.value })} className={`${inputCls} w-full`} data-testid="short-title" />
                  </label>

                  <div className="space-y-1 p-2 rounded-lg bg-zinc-950/50 border border-white/[0.06]" data-testid="hook-title-editor">
                    <div className="flex items-center justify-between text-[10px] text-zinc-400">
                      <span>Hook title on screen (first seconds)</span>
                      {!clip.titleText && clip.hook && (
                        <button
                          onClick={() => updateClip(clip.id, { titleText: suggestTitle(clip.hook) })}
                          className="text-indigo-300 hover:text-white"
                          data-testid="hook-title-suggest"
                        >
                          Suggest
                        </button>
                      )}
                    </div>
                    <input
                      value={clip.titleText || ''}
                      maxLength={120}
                      placeholder="e.g. 3 mistakes that cost me a year"
                      onChange={(e) => updateClip(clip.id, { titleText: e.target.value })}
                      onFocus={() => setCurrentTime(clip.start)}
                      className={`${inputCls} w-full`}
                      data-testid="hook-title"
                    />
                    {!!clip.titleText && (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={clip.titleSeconds || TITLE_DEFAULT_SECONDS}
                          onChange={(e) => updateClip(clip.id, { titleSeconds: Number(e.target.value) })}
                          className={`${inputCls} flex-1`}
                          data-testid="hook-title-seconds"
                        >
                          {[2, 3, 4, 5, 7, 10].map((n) => <option key={n} value={n}>{n} s</option>)}
                        </select>
                        <select
                          value={clip.titleStyle || 'box'}
                          onChange={(e) => updateClip(clip.id, { titleStyle: e.target.value as TitleStyle })}
                          className={`${inputCls} flex-1`}
                          data-testid="hook-title-style"
                        >
                          {(Object.keys(TITLE_STYLES) as TitleStyle[]).map((k) => <option key={k} value={k}>{TITLE_STYLES[k].label}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {(['start', 'end'] as const).map((edge) => (
                    <div key={edge} className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400">
                        <span>{edge === 'start' ? 'Start' : 'End'}, s</span>
                        <button
                          onClick={() => updateClip(clip.id, { [edge]: maybeSnap(useVideoStore.getState().currentTime, edge) }, edge)}
                          className="flex items-center space-x-1 text-indigo-300 hover:text-white"
                          title="Use the playhead position"
                        >
                          <Crosshair className="w-3 h-3" />
                          <span>= playhead</span>
                        </button>
                      </div>
                      <div className="flex items-center space-x-1">
                        {[-1, -0.1].map((d) => (
                          <button key={d} className={smallBtn} onClick={() => updateClip(clip.id, { [edge]: clip[edge] + d }, edge)}>{d}</button>
                        ))}
                        <input
                          type="number"
                          step={0.1}
                          value={clip[edge]}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) updateClip(clip.id, { [edge]: v }, edge);
                          }}
                          className={`${inputCls} w-20 text-center`}
                          data-testid={`short-${edge}`}
                        />
                        {[0.1, 1].map((d) => (
                          <button key={d} className={smallBtn} onClick={() => updateClip(clip.id, { [edge]: clip[edge] + d }, edge)}>+{d}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className={`text-[10px] ${clip.duration > 60 ? 'text-amber-400' : 'text-zinc-500'}`}>
                    Length {clip.duration}s{clip.duration > 60 ? ' - Shorts work best up to 60 s' : ''}
                  </p>

                  <div className="flex items-center gap-1.5">
                    <button
                      data-testid="duplicate-short"
                      onClick={() => { const id = duplicateClip(clip.id); if (id) setEditingId(id); }}
                      className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-[10px] text-zinc-200"
                      title="Make a copy to try another cut or title"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Duplicate</span>
                    </button>
                    <button
                      data-testid="split-short"
                      onClick={() => {
                        const at = maybeSnap(useVideoStore.getState().currentTime, 'start');
                        if (!splitClip(clip.id, at)) {
                          setNote('Move the playhead inside the short (at least 1 s from its edges) to split it.');
                        }
                      }}
                      className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-[10px] text-zinc-200"
                      title="Cut this short in two at the playhead"
                    >
                      <SplitSquareHorizontal className="w-3 h-3" />
                      <span>Split at playhead</span>
                    </button>
                  </div>

                  <div className="space-y-1" data-testid="short-captions">
                    <span className="block text-[10px] text-zinc-400">Captions in this short ({editingWords.length} words)</span>
                    {editingWords.length === 0 ? (
                      <p className="text-[10px] text-zinc-500">No captions in this range yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto p-1 rounded-lg bg-zinc-950/60 border border-white/[0.06]">
                        {editingWords.map((idx) => {
                          const w = transcript[idx];
                          return (
                            <input
                              key={w.id}
                              value={w.word}
                              data-testid="short-word"
                              onFocus={() => setCurrentTime(w.start)}
                              onChange={(e) => updateWord(idx, { word: e.target.value })}
                              size={Math.max(2, w.word.length)}
                              className={`bg-zinc-900 border rounded px-1 py-0.5 text-[11px] text-white focus:outline-none focus:border-indigo-500 ${
                                w.keyword ? 'border-amber-500/50' : 'border-white/[0.08]'
                              }`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-[10px] text-zinc-400">
                <span className="font-mono">{formatTime(clip.start)} - {formatTime(clip.end)} ({clip.duration}s)</span>
                <button
                  onClick={(e) => { e.stopPropagation(); selectClip(clip.id); setIsExportModalOpen(true); }}
                  className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-indigo-500 to-sky-500 hover:from-indigo-400 hover:to-sky-400 text-white font-semibold text-[10px] shadow-sm transition-all active:scale-95"
                >
                  Export Short
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
