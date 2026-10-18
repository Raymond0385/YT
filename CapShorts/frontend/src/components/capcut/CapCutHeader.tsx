import React, { useState, useEffect } from 'react';
import {
  Film,
  Smartphone,
  Monitor,
  Square,
  Share2,
  RefreshCw,
  Undo2,
  Redo2,
  Settings,
  Edit3,
  Check,
  Save,
  FolderOpen,
  ChevronDown,
  History,
  RotateCcw
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useVideoStore } from '../../store/useVideoStore';
import { AspectRatio } from '../../types';
import { apiUrl } from '../../config';
import { useProjectActions } from '../../utils/useProjectActions';
import { useHistoryState } from '../../utils/useHistoryState';
import { history } from '../../store/useVideoStore';
import { timeAgo } from '../../utils/recents';

export const CapCutHeader: React.FC = () => {
  const {
    aspectRatio,
    setAspectRatio,
    isExporting,
    setIsExportModalOpen,
    setIsSettingsModalOpen,
    videoFile,
    setVideo,
    projectTitle,
    setProjectTitle
  } = useVideoStore(
    useShallow((state) => ({
      aspectRatio: state.aspectRatio,
      setAspectRatio: state.setAspectRatio,
      isExporting: state.isExporting,
      setIsExportModalOpen: state.setIsExportModalOpen,
      setIsSettingsModalOpen: state.setIsSettingsModalOpen,
      videoFile: state.videoFile,
      setVideo: state.setVideo,
      projectTitle: state.projectTitle,
      setProjectTitle: state.setProjectTitle,
    }))
  );

  const [hasUpdate, setHasUpdate] = useState(false);
  const project = useProjectActions();
  const { canUndo, canRedo } = useHistoryState();
  const [recentOpen, setRecentOpen] = useState(false);

  // close the recent list when clicking elsewhere
  useEffect(() => {
    if (!recentOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[data-testid=recent-wrap]')) setRecentOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [recentOpen]);

  // Ctrl+Z undo, Ctrl+Y / Shift+Ctrl+Z redo. Inside text fields the browser's own undo keeps working.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(projectTitle);

  useEffect(() => {
    fetch(apiUrl('/api/system/update-status'))
      .then((res) => res.json())
      .then((data) => {
        if (data?.update_available) setHasUpdate(true);
      })
      .catch(() => {});
  }, []);

  const handleSaveTitle = () => {
    if (tempTitle.trim()) {
      setProjectTitle(tempTitle.trim());
    }
    setIsEditingTitle(false);
  };

  const handleReset = () => {
    if (confirm("Reset current project and load a new video?")) {
      setVideo(null, null, '');
    }
  };

  return (
    <header className="h-13 bg-[#0d0d11]/95 backdrop-blur-2xl border-b border-white/[0.08] px-3.5 flex items-center justify-between z-30 select-none text-zinc-100 flex-shrink-0 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
      {/* Left: Brand + Project Title + Undo/Redo */}
      <div className="flex items-center space-x-3">
        {/* Kadr Brand Logo Badge */}
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 via-sky-500 to-cyan-400 p-[1px] shadow-sm shadow-indigo-500/25 ring-1 ring-white/15 flex items-center justify-center">
            <img
              src="/logo.png"
              alt="Kadr"
              className="w-full h-full rounded-[7px] object-contain bg-[#121216]"
            />
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="font-bold text-sm tracking-tight text-white font-['Plus_Jakarta_Sans',sans-serif]">
              <span className="bg-gradient-to-r from-indigo-300 via-sky-300 to-cyan-200 bg-clip-text text-transparent">Kadr</span>
            </span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 tracking-wider">
              STUDIO
            </span>
          </div>
        </div>

        <div className="h-4 w-[1px] bg-white/[0.08]" />

        {/* Project Title Editor */}
        <div className="flex items-center space-x-1.5">
          {isEditingTitle ? (
            <div className="flex items-center space-x-1">
              <input
                type="text"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                autoFocus
                className="bg-zinc-900/90 border border-indigo-500/80 rounded-md px-2.5 py-1 text-xs text-white font-medium focus:outline-none w-48 shadow-inner ring-1 ring-indigo-500/30"
              />
              <button
                onClick={handleSaveTitle}
                className="p-1 hover:bg-white/[0.08] text-indigo-400 rounded-md transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setTempTitle(projectTitle);
                setIsEditingTitle(true);
              }}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md hover:bg-white/[0.06] text-xs text-zinc-300 font-medium group transition-all border border-transparent hover:border-white/[0.08]"
              title="Click to rename project"
            >
              <span className="truncate max-w-[170px] text-zinc-200">{projectTitle}</span>
              <Edit3 className="w-3 h-3 text-zinc-500 opacity-40 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>

        {/* Undo / Redo controls */}
        <div className="flex items-center space-x-0.5 bg-zinc-900/70 border border-white/[0.06] rounded-lg p-0.5">
          <button
            onClick={() => history.undo()}
            disabled={!canUndo}
            className={`p-1 rounded-md transition-colors ${canUndo ? 'text-zinc-200 hover:bg-white/[0.08]' : 'text-zinc-600 cursor-not-allowed'}`}
            title="Undo (Ctrl+Z)"
            data-testid="undo"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => history.redo()}
            disabled={!canRedo}
            className={`p-1 rounded-md transition-colors ${canRedo ? 'text-zinc-200 hover:bg-white/[0.08]' : 'text-zinc-600 cursor-not-allowed'}`}
            title="Redo (Ctrl+Y)"
            data-testid="redo"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Center: macOS Segmented Aspect Ratio Switcher */}
      <div className="flex items-center bg-zinc-900/90 border border-white/[0.07] rounded-xl p-1 shadow-inner">
        <button
          onClick={() => setAspectRatio('9:16')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
            aspectRatio === '9:16'
              ? 'bg-zinc-800 text-white shadow-sm ring-1 ring-white/10'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
          }`}
          title="9:16 Vertical (Shorts, Reels, TikTok)"
        >
          <Smartphone className={`w-3.5 h-3.5 ${aspectRatio === '9:16' ? 'text-indigo-400' : 'text-zinc-400'}`} />
          <span>9:16 Shorts</span>
        </button>
        <button
          onClick={() => setAspectRatio('16:9')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
            aspectRatio === '16:9'
              ? 'bg-zinc-800 text-white shadow-sm ring-1 ring-white/10'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
          }`}
          title="16:9 Landscape (YouTube)"
        >
          <Monitor className={`w-3.5 h-3.5 ${aspectRatio === '16:9' ? 'text-indigo-400' : 'text-zinc-400'}`} />
          <span>16:9 Wide</span>
        </button>
        <button
          onClick={() => setAspectRatio('1:1')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
            aspectRatio === '1:1'
              ? 'bg-zinc-800 text-white shadow-sm ring-1 ring-white/10'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
          }`}
          title="1:1 Square (Instagram Post)"
        >
          <Square className={`w-3.5 h-3.5 ${aspectRatio === '1:1' ? 'text-indigo-400' : 'text-zinc-400'}`} />
          <span>1:1 Square</span>
        </button>
      </div>

      {/* Right: Actions & Export Button */}
      <div className="flex items-center space-x-2.5">
        {/* Project file: open / save */}
        <div className="flex items-center space-x-1 relative" data-testid="project-actions">
          <div className="relative flex items-center" data-testid="recent-wrap">
            <button
              onClick={() => void project.open()}
              className="flex items-center space-x-1.5 pl-2.5 pr-2 py-1.5 rounded-l-lg bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 font-medium text-xs border border-white/[0.08] transition-all active:scale-95"
              title="Open a project file (Ctrl+O)"
              data-testid="project-open"
            >
              <FolderOpen className="w-3 h-3 text-amber-400" />
              <span className="hidden xl:inline">Open</span>
            </button>
            <button
              onClick={() => setRecentOpen((v) => !v)}
              className="px-1.5 py-1.5 rounded-r-lg bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-400 border border-l-0 border-white/[0.08] transition-all"
              title="Recent projects"
              data-testid="recent-toggle"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
            {recentOpen && (
              <div className="absolute top-full left-0 mt-2 w-72 rounded-xl bg-zinc-900 border border-white/[0.1] shadow-2xl z-50 overflow-hidden" data-testid="recent-menu">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 flex items-center space-x-1.5 border-b border-white/[0.06]">
                  <History className="w-3 h-3" />
                  <span>Recent projects</span>
                </div>
                {project.recents.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-zinc-500" data-testid="recent-empty">Nothing here yet. Saved and opened projects appear in this list.</p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto">
                    {project.recents.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => { setRecentOpen(false); void project.openRecent(r.id); }}
                          className="w-full text-left px-3 py-2 hover:bg-white/[0.06] transition-colors"
                          data-testid="recent-item"
                        >
                          <span className="block text-xs text-zinc-200 truncate">{r.name}</span>
                          <span className="block text-[10px] text-zinc-500">
                            {timeAgo(r.openedAt, Date.now())}{r.handle ? '' : ' - pick the file via Open'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {project.recents.length > 0 && (
                  <button
                    onClick={() => { void project.clearRecents(); }}
                    className="w-full text-left px-3 py-2 text-[11px] text-zinc-500 hover:text-zinc-300 border-t border-white/[0.06]"
                    data-testid="recent-clear"
                  >
                    Clear list
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => void project.save(false)}
            className="relative flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 font-medium text-xs border border-white/[0.08] transition-all active:scale-95"
            title={`Save project${project.fileName ? ` to ${project.fileName}` : ''} (Ctrl+S)`}
            data-testid="project-save"
          >
            <Save className="w-3 h-3 text-emerald-400" />
            <span className="hidden xl:inline">Save</span>
            {project.dirty && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-zinc-950" title="Unsaved changes" data-testid="project-dirty" />
            )}
          </button>
          <button
            onClick={() => void project.saveAs()}
            className="px-2 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-400 hover:text-zinc-200 text-[11px] border border-white/[0.08] transition-all active:scale-95"
            title="Save project as... (Shift+Ctrl+S)"
            data-testid="project-save-as"
          >
            <span className="hidden xl:inline">Save as</span>
            <span className="xl:hidden">As...</span>
          </button>
          {project.notice && (
            <div
              className={`absolute top-full right-0 mt-2 px-3 py-1.5 rounded-lg text-[11px] font-medium shadow-xl border whitespace-nowrap z-50 ${
                project.notice.kind === 'error'
                  ? 'bg-red-950/90 border-red-500/50 text-red-200'
                  : 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              }`}
              data-testid="project-notice"
            >
              {project.notice.text}
            </div>
          )}
        </div>

        {/* Replace/New Video */}
        {videoFile && (
          <button
            onClick={handleReset}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 font-medium text-xs border border-white/[0.08] transition-all active:scale-95"
            title="Import different video"
          >
            <RefreshCw className="w-3 h-3 text-indigo-400" />
            <span>New</span>
          </button>
        )}

        {/* Premium Studio Export Button */}
        <button
          onClick={() => setIsExportModalOpen(true)}
          disabled={isExporting}
          className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 hover:from-indigo-400 hover:to-sky-400 text-white font-semibold text-xs shadow-lg shadow-indigo-500/25 border border-indigo-400/30 transition-all active:scale-95 disabled:opacity-50 tracking-wide"
        >
          <Share2 className="w-3.5 h-3.5 text-white stroke-[2.2]" />
          <span>{isExporting ? 'Exporting...' : 'Export Video'}</span>
        </button>

        {/* Settings button with update notification badge */}
        <button
          onClick={() => setIsSettingsModalOpen(true)}
          className="relative p-2 rounded-lg hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors border border-transparent hover:border-white/[0.06]"
          title={hasUpdate ? "New Update Available! Open Settings" : "System & AI Settings"}
        >
          <Settings className="w-4 h-4" />
          {hasUpdate && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-zinc-950 animate-pulse" />
          )}
        </button>
      </div>
      {project.recovery && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-3 px-4 py-2.5 rounded-xl bg-amber-950/95 border border-amber-500/50 text-amber-100 text-xs shadow-2xl"
          data-testid="recovery-banner"
        >
          <RotateCcw className="w-4 h-4 text-amber-300 flex-shrink-0" />
          <span>
            Unsaved work was found: <b>{project.recovery.title}</b> ({timeAgo(project.recovery.savedAt, Date.now())})
          </span>
          <button onClick={project.restoreDraft} className="px-2.5 py-1 rounded-lg bg-amber-400 text-black font-semibold hover:bg-amber-300" data-testid="recovery-restore">Restore</button>
          <button onClick={project.discardDraft} className="px-2 py-1 text-amber-200/80 hover:text-white underline" data-testid="recovery-discard">Discard</button>
        </div>
      )}
    </header>
  );
};
