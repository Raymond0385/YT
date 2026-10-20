import React, { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVideoStore } from '../../store/useVideoStore';
import { TrackItem } from '../../types';
import { fadeFactor, itemMediaTime, itemUrl } from '../../utils/tracks';

/** Keeps a media element on the item's time and playing state. */
function useSync(ref: React.RefObject<HTMLMediaElement>, item: TrackItem, time: number, playing: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const want = itemMediaTime(item, time);
    if (want === null) return;
    if (Math.abs(el.currentTime - want) > (playing ? 0.3 : 0.04)) {
      try { el.currentTime = want; } catch { /* not loaded yet */ }
    }
    if (playing && el.paused) void el.play().catch(() => undefined);
    if (!playing && !el.paused) el.pause();
  }, [ref, item, time, playing]);
}

const VideoLayer: React.FC<{ item: TrackItem; time: number; playing: boolean; stageW: number; stageH: number }> = ({ item, time, playing, stageW, stageH }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useSync(ref, item, time, playing);
  const url = itemUrl(item);
  if (!url) return null;
  const w = item.scale * stageW;
  return (
    <video
      ref={ref}
      src={url}
      muted
      playsInline
      preload="auto"
      className="absolute z-[15] pointer-events-none object-contain"
      data-testid="track-video-layer"
      style={{
        width: `${w}px`,
        left: `${item.x * stageW - w / 2}px`,
        top: `${item.y * stageH}px`,
        transform: 'translateY(-50%)',
        opacity: item.opacity * fadeFactor(item, time),
      }}
    />
  );
};

const SoundLayer: React.FC<{ item: TrackItem; trackVolume: number; time: number; playing: boolean }> = ({ item, trackVolume, time, playing }) => {
  const ref = useRef<HTMLAudioElement>(null);
  useSync(ref, item, time, playing);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, item.volume * trackVolume * fadeFactor(item, time)));
  }, [item, trackVolume, time]);
  const url = itemUrl(item);
  return url ? <audio ref={ref} src={url} preload="auto" data-testid="track-audio-layer" /> : null;
};

/**
 * Extra tracks in the editor preview: video layers over the picture and the sounds, following the playhead,
 * plus the fade from / to black of the export. Same placement numbers as the render (timeline_render.py).
 */
export const TrackPreview: React.FC<{ stageW: number; stageH: number }> = ({ stageW, stageH }) => {
  const { extraTracks, currentTime, isPlaying, fadeIn, fadeOut, duration } = useVideoStore(useShallow((s) => ({
    extraTracks: s.extraTracks, currentTime: s.currentTime, isPlaying: s.isPlaying, fadeIn: s.fadeIn, fadeOut: s.fadeOut, duration: s.duration,
  })));
  const black = Math.max(
    fadeIn > 0 ? 1 - Math.min(1, currentTime / fadeIn) : 0,
    fadeOut > 0 && duration > 0 ? 1 - Math.min(1, (duration - currentTime) / fadeOut) : 0,
  );
  return (
    <>
      {extraTracks.filter((t) => !t.muted).flatMap((t) => t.items
        .filter((it) => itemMediaTime(it, currentTime) !== null)
        .map((it) => (t.kind === 'video'
          ? <VideoLayer key={it.id} item={it} time={currentTime} playing={isPlaying} stageW={stageW} stageH={stageH} />
          : <SoundLayer key={it.id} item={it} trackVolume={t.volume} time={currentTime} playing={isPlaying} />)))}
      {black > 0.001 && <div className="absolute inset-0 z-[35] bg-black pointer-events-none" style={{ opacity: black }} data-testid="fade-overlay" />}
    </>
  );
};
