import React, { useState } from 'react';
import { FileVideo, FolderOpen } from 'lucide-react';
import { useVideoStore } from '../../store/useVideoStore';
import { videoMatches } from '../../utils/projectFile';

const formatSize = (bytes: number) => (bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : 'unknown size');

/** Shown instead of the import dropzone while a project is open but its video has not been chosen. */
export const ProjectVideoPrompt: React.FC = () => {
  const need = useVideoStore((s) => s.projectNeedsVideo);
  const title = useVideoStore((s) => s.projectTitle);
  const attachProjectVideo = useVideoStore((s) => s.attachProjectVideo);
  const setVideo = useVideoStore((s) => s.setVideo);
  const [warning, setWarning] = useState<string | null>(null);

  if (!need) return null;

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (!videoMatches(need, file)) {
      const ok = window.confirm(
        `This file (${file.name}, ${formatSize(file.size)}) looks different from the video the project was made with ` +
        `(${need.name}, ${formatSize(need.size)}).\n\nCaptions and shorts are timed to the original video. Use this file anyway?`
      );
      if (!ok) {
        setWarning('Pick the original video to keep the captions in sync.');
        return;
      }
    }
    attachProjectVideo(file);
  };

  return (
    <div
      className="w-full max-w-md p-7 rounded-3xl bg-zinc-900/70 backdrop-blur-2xl border border-white/[0.08] shadow-2xl flex flex-col items-center text-center ring-1 ring-white/[0.05]"
      data-testid="project-video-prompt"
    >
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 via-sky-500/10 to-transparent border border-white/[0.12] flex items-center justify-center text-indigo-300 mb-4">
        <FileVideo className="w-6 h-6" />
      </div>
      <h3 className="text-sm font-bold text-white mb-1">Project "{title}" is open</h3>
      <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
        The video itself is not stored in the project file. Choose the original video to continue editing:
        <br />
        <span className="text-zinc-200 font-semibold break-all">{need.name || 'unknown file'}</span>
        <span className="text-zinc-500"> ({formatSize(need.size)})</span>
      </p>
      <label className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 hover:from-indigo-400 hover:to-sky-400 text-white font-semibold text-xs cursor-pointer shadow-lg shadow-indigo-500/25 border border-indigo-400/30 transition-all active:scale-95 tracking-wide">
        <FolderOpen className="w-4 h-4" />
        <span>Choose video file</span>
        <input
          type="file"
          accept="video/*,.mp4,.mov,.webm,.mkv,.avi"
          className="hidden"
          data-testid="project-video-input"
          onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }}
        />
      </label>
      {warning && <p className="text-[11px] text-amber-400 mt-3">{warning}</p>}
      <button
        onClick={() => { if (window.confirm('Close this project and start from scratch?')) setVideo(null, null, ''); }}
        className="text-[11px] text-zinc-500 hover:text-zinc-300 underline mt-4"
      >
        Close project
      </button>
    </div>
  );
};
