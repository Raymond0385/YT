import React, { useState } from 'react';
import { Eye, EyeOff, Film, Music, Plus, Trash2, Volume2, VolumeX } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useVideoStore } from '../../store/useVideoStore';
import { ExtraTrack, TrackItem } from '../../types';
import { importMedia } from '../../utils/tracks';

export const EXTRA_ROW_H = 44;

export type TrackDragMode = 'move' | 'start' | 'end';

// written out in full so Tailwind generates them
const ITEM_STYLE = {
  video: { selected: 'bg-violet-500/40 border-violet-200 text-white z-10', idle: 'bg-violet-500/20 border-violet-500/50 text-violet-100' },
  audio: { selected: 'bg-teal-500/40 border-teal-200 text-white z-10', idle: 'bg-teal-500/20 border-teal-500/50 text-teal-100' },
} as const;

/** Adds a media file to a track at the playhead. */
function useAddMedia() {
  const addTrackItem = useVideoStore((s) => s.addTrackItem);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const add = async (trackId: string, file: File | undefined) => {
    if (!file) return;
    setBusy(trackId);
    setError(null);
    try {
      const media = await importMedia(file);
      addTrackItem(trackId, media, useVideoStore.getState().currentTime);
    } catch (e: any) {
      setError(e?.message || 'Could not add the file');
    } finally {
      setBusy(null);
    }
  };
  return { add, busy, error };
}

/** Left column: one header per extra track, and the buttons that add tracks. */
export const ExtraTrackHeaders: React.FC = () => {
  const { extraTracks, addTrack, updateTrack, removeTrack } = useVideoStore(useShallow((s) => ({
    extraTracks: s.extraTracks, addTrack: s.addTrack, updateTrack: s.updateTrack, removeTrack: s.removeTrack,
  })));
  const { add, busy, error } = useAddMedia();
  return (
    <>
      {extraTracks.map((t) => (
        <div key={t.id} style={{ height: EXTRA_ROW_H }} className="border-b border-white/[0.06] px-2 flex items-center justify-between text-xs bg-zinc-950/30" data-testid="extra-track-header">
          <div className="flex items-center space-x-1.5 min-w-0">
            {t.kind === 'video' ? <Film className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" /> : <Music className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />}
            <span className="text-[11px] font-bold text-zinc-200 truncate">{t.name}</span>
          </div>
          <div className="flex items-center">
            <label className={`p-1 rounded hover:bg-white/[0.06] cursor-pointer ${busy === t.id ? 'opacity-40 pointer-events-none' : 'text-zinc-400 hover:text-white'}`}
                   title={t.kind === 'video' ? 'Add a video or image layer at the playhead' : 'Add music or a voice-over at the playhead'}>
              <Plus className="w-3 h-3" />
              <input type="file" className="hidden" accept={t.kind === 'video' ? 'video/*,image/*' : 'audio/*,video/*'} data-testid="extra-track-add"
                     onChange={(e) => { void add(t.id, e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <button onClick={() => updateTrack(t.id, { muted: !t.muted })} className="p-1 rounded text-zinc-500 hover:text-white hover:bg-white/[0.06]"
                    title={t.kind === 'video' ? (t.muted ? 'Show' : 'Hide') : (t.muted ? 'Unmute' : 'Mute')}>
              {t.kind === 'video' ? (t.muted ? <EyeOff className="w-3 h-3 text-amber-400" /> : <Eye className="w-3 h-3" />)
                : (t.muted ? <VolumeX className="w-3 h-3 text-amber-400" /> : <Volume2 className="w-3 h-3" />)}
            </button>
            <button onClick={() => { if (!t.items.length || window.confirm(`Delete ${t.name} and everything on it?`)) removeTrack(t.id); }}
                    className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-white/[0.06]" title="Delete track" data-testid="extra-track-remove">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
      <div className="px-2 py-1.5 flex flex-col gap-1">
        <button onClick={() => addTrack('video')} className="text-[10px] px-1.5 py-1 rounded-md bg-violet-500/10 border border-violet-500/30 text-violet-200 hover:bg-violet-500/20" data-testid="add-video-track">+ Video track</button>
        <button onClick={() => addTrack('audio')} className="text-[10px] px-1.5 py-1 rounded-md bg-teal-500/10 border border-teal-500/30 text-teal-200 hover:bg-teal-500/20" data-testid="add-audio-track">+ Audio track</button>
        {error && <span className="text-[9px] text-red-400 leading-tight">{error}</span>}
      </div>
    </>
  );
};

/** Right side: the items of every extra track, positioned on the time axis. */
export const ExtraTrackLanes: React.FC<{
  timelineZoom: number;
  onDragStart: (track: ExtraTrack, item: TrackItem, mode: TrackDragMode, e: React.MouseEvent) => void;
}> = ({ timelineZoom, onDragStart }) => {
  const { extraTracks, selected, selectTrackItem } = useVideoStore(useShallow((s) => ({
    extraTracks: s.extraTracks, selected: s.selectedTrackItem, selectTrackItem: s.selectTrackItem,
  })));
  return (
    <>
      {extraTracks.map((t) => (
        <div key={t.id} style={{ height: EXTRA_ROW_H }} className={`relative border-b border-white/[0.06] ${t.muted ? 'opacity-40' : ''}`} data-testid="extra-track-lane">
          {t.items.map((it) => {
            const isSel = selected?.itemId === it.id;
            return (
              <div
                key={it.id}
                data-testid="extra-track-item"
                data-item-id={it.id}
                onClick={(e) => { e.stopPropagation(); selectTrackItem({ trackId: t.id, itemId: it.id }); }}
                onMouseDown={(e) => { if (e.button === 0) { e.stopPropagation(); onDragStart(t, it, 'move', e); } }}
                style={{ left: it.start * timelineZoom, width: Math.max(8, it.duration * timelineZoom), top: 5, height: EXTRA_ROW_H - 10 }}
                className={`absolute rounded-md border flex items-center overflow-hidden cursor-grab active:cursor-grabbing text-[10px] font-semibold ${
                  isSel ? ITEM_STYLE[t.kind].selected : ITEM_STYLE[t.kind].idle
                }`}
                title={`${it.name} (${it.start.toFixed(1)}s, ${it.duration.toFixed(1)}s). Drag to move, drag the edges to trim.`}
              >
                <div onMouseDown={(e) => { e.stopPropagation(); onDragStart(t, it, 'start', e); }} className="w-1.5 h-full flex-shrink-0 cursor-ew-resize bg-white/20 hover:bg-white/50" data-testid="extra-item-start" />
                <span className="truncate px-1 pointer-events-none">{it.name}</span>
                <div className="flex-1" />
                <div onMouseDown={(e) => { e.stopPropagation(); onDragStart(t, it, 'end', e); }} className="w-1.5 h-full flex-shrink-0 cursor-ew-resize bg-white/20 hover:bg-white/50" data-testid="extra-item-end" />
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
};

const num = 'w-12 bg-zinc-950 border border-white/[0.08] rounded px-1 py-0.5 text-[10px] text-white';

/** Settings of the selected track item, shown above the tracks. */
export const TrackItemBar: React.FC = () => {
  const { extraTracks, selected, updateTrackItem, removeTrackItem, selectTrackItem } = useVideoStore(useShallow((s) => ({
    extraTracks: s.extraTracks, selected: s.selectedTrackItem, updateTrackItem: s.updateTrackItem,
    removeTrackItem: s.removeTrackItem, selectTrackItem: s.selectTrackItem,
  })));
  const track = extraTracks.find((t) => t.id === selected?.trackId);
  const item = track?.items.find((i) => i.id === selected?.itemId);
  if (!track || !item) return null;
  const set = (changes: Partial<TrackItem>) => updateTrackItem(track.id, item.id, changes);
  const field = (label: string, key: keyof TrackItem, min: number, max: number, step: number, pct = false) => (
    <label className="flex items-center space-x-1" key={key}>
      <span className="text-zinc-400">{label}</span>
      <input
        type="number" min={pct ? min * 100 : min} max={pct ? max * 100 : max} step={pct ? step * 100 : step}
        value={pct ? Math.round((item[key] as number) * 100) : (item[key] as number)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) set({ [key]: Math.min(max, Math.max(min, pct ? v / 100 : v)) } as Partial<TrackItem>);
        }}
        className={num}
        data-testid={`item-${key}`}
      />
      {pct && <span className="text-zinc-500">%</span>}
    </label>
  );
  return (
    <div className="h-9 border-b border-white/[0.08] px-3 flex items-center gap-3 bg-zinc-950/70 text-[10px] overflow-x-auto no-scrollbar" data-testid="track-item-bar">
      <span className="font-semibold text-zinc-200 truncate max-w-[160px]">{item.name}</span>
      {track.kind === 'video' ? (
        <>
          {field('X', 'x', 0, 1, 0.01, true)}
          {field('Y', 'y', 0, 1, 0.01, true)}
          {field('Size', 'scale', 0.05, 1, 0.01, true)}
          {field('Opacity', 'opacity', 0, 1, 0.05, true)}
        </>
      ) : (
        field('Volume', 'volume', 0, 3, 0.05, true)
      )}
      {field('Fade in, s', 'fadeIn', 0, 10, 0.1)}
      {field('Fade out, s', 'fadeOut', 0, 10, 0.1)}
      <button onClick={() => removeTrackItem(track.id, item.id)} className="flex items-center space-x-1 text-red-300 hover:text-red-200" data-testid="item-delete">
        <Trash2 className="w-3 h-3" /><span>Delete</span>
      </button>
      <button onClick={() => selectTrackItem(null)} className="ml-auto text-zinc-500 hover:text-white">Close</button>
    </div>
  );
};
