import React, { useRef, useState } from 'react';
import { Scissors, Flame, Pencil, Trash2, Plus, Crosshair, FolderOpen, Layers } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useVideoStore } from '../../store/useVideoStore';
import { apiUrl } from '../../config';
import { formatTime } from '../../utils/timeFormat';
import { snapToWord } from '../../utils/clipEdit';
import { buildExportPayload, shortFileName } from '../../utils/exportPayload';
import { batchSummary, BatchItem, runBatchExport } from '../../utils/batchExport';
import templatesData from '../../data/templates.json';
import { SubtitlePreset } from '../../types';

const inputCls =
  'bg-zinc-950/80 border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors';
const smallBtn =
  'px-1.5 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-[10px] font-mono text-zinc-200 transition-colors';

export const ShortsPanel: React.FC = () => {
  const {
    clips, selectedClipId, selectClip, setClips, updateClip, deleteClip, addClip,
    transcript, duration, currentTime, setCurrentTime, setIsExportModalOpen,
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
      currentTime: s.currentTime,
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

  const exportAll = async () => {
    if (!clips.length || batchRunning) return;
    if (!videoFile && !serverVideoPath) {
      setNote('Open a video first.');
      return;
    }
    setNote(null);
    setBatchRunning(true);
    stopRef.current = false;
    setBatchItems(clips.map((c) => ({ clipId: c.id, title: c.title, status: 'queued', progress: 0 })));
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

      const presets = templatesData as SubtitlePreset[];
      const preset = presets.find((p) => p.id === activeTemplateId) || presets[0];
      const list = [...clips].sort((a, b) => a.start - b.start);
      await runBatchExport({
        clips: list,
        buildPayload: (clip, index) =>
          buildExportPayload({
            videoPath, transcript, preset, customStyleOverrides, brollList, showEmojis,
            outputFilename: shortFileName(index, clip.title, list.length),
            resolution: '1080x1920',
            clip,
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
          target_clips_count: Math.max(1, count),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setClips(data.clips || []);
        setEditingId(null);
        setNote(`${(data.clips || []).length} short(s) found`);
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
    const start = maybeSnap(currentTime, 'start');
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
            <span>How many</span>
            <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} className={`${inputCls} w-full`} />
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
          <span>Export all ({clips.length})</span>
        </button>
        <label className="flex items-center space-x-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} className="accent-indigo-500" />
          <span>Snap to words</span>
        </label>
      </div>
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
        {clips.map((clip) => {
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
                    <div className="flex items-center space-x-1 text-[10px] font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full border border-amber-500/30">
                      <Flame className="w-3 h-3 fill-amber-400 text-amber-400" />
                      <span>{clip.virality_score}%</span>
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

                  {(['start', 'end'] as const).map((edge) => (
                    <div key={edge} className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400">
                        <span>{edge === 'start' ? 'Start' : 'End'}, s</span>
                        <button
                          onClick={() => updateClip(clip.id, { [edge]: maybeSnap(currentTime, edge) }, edge)}
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
