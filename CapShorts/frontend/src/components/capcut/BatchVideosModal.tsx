import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Layers, X } from 'lucide-react';
import { apiUrl } from '../../config';
import { useVideoStore } from '../../store/useVideoStore';
import { findPreset } from '../../utils/presets';
import { ExportAllSettings, loadExportAllSettings, saveExportAllSettings } from '../../utils/exportAllSettings';
import { runVideoQueue, VideoJob } from '../../utils/batchVideos';
import { ExportAllSettingsForm } from './ExportAllSettingsForm';

const STATUS_COLOR: Record<VideoJob['status'], string> = {
  queued: 'text-zinc-500', transcribing: 'text-sky-300', rendering: 'text-indigo-300', done: 'text-emerald-300', failed: 'text-red-400', skipped: 'text-zinc-500',
};

/**
 * Several videos at once: each one is recognised, its shorts are found (automatic count) and rendered
 * with the "Export all" settings and the current subtitle style. The editor is not touched.
 */
export const BatchVideosModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [settings, setSettings] = useState<ExportAllSettings>(loadExportAllSettings);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [running, setRunning] = useState(false);
  const [exportDir, setExportDir] = useState('');
  const stopRef = useRef(false);
  const [language, setLanguage] = useState(() => useVideoStore.getState().selectedLanguage || 'auto');

  useEffect(() => {
    if (!open) return;
    fetch(apiUrl('/api/export/settings')).then((r) => (r.ok ? r.json() : null)).then((d) => d?.export_dir && setExportDir(d.export_dir)).catch(() => undefined);
  }, [open]);

  if (!open) return null;

  const changeSettings = (s: ExportAllSettings) => {
    setSettings(s);
    saveExportAllSettings(s);
  };

  const start = async () => {
    if (!files.length) return;
    const s = useVideoStore.getState();
    stopRef.current = false;
    setRunning(true);
    try {
      await runVideoQueue({
        files,
        transcribe: { model: s.selectedModel, language, glossary: s.glossary, enhanceAudio: s.enhanceAudio, groqApiKey: s.groqApiKey },
        exportAll: settings,
        preset: findPreset(s.activeTemplateId, s.userPresets),
        customStyleOverrides: s.customStyleOverrides,
        onUpdate: setJobs,
        shouldStop: () => stopRef.current,
      });
    } finally {
      setRunning(false);
    }
  };

  const total = jobs.reduce((n, j) => n + (j.rendered || 0), 0);

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="batch-videos">
      <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl bg-zinc-900 border border-white/10 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">Make shorts from several videos</h3>
          </div>
          <button onClick={() => { if (!running) onClose(); }} disabled={running} className="p-1 rounded-md text-zinc-400 hover:text-white disabled:opacity-30"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <p className="text-[11px] text-zinc-400">
            Each video is recognised with the current language and model, its shorts are found automatically and rendered with the current subtitle style.
          </p>
          <label className={`flex items-center justify-center space-x-2 px-3 py-2 rounded-xl border border-dashed border-white/15 text-xs text-zinc-200 ${running ? 'opacity-50' : 'cursor-pointer hover:bg-white/[0.03]'}`}>
            <FolderOpen className="w-4 h-4 text-indigo-300" />
            <span>{files.length ? `${files.length} video${files.length === 1 ? '' : 's'} chosen` : 'Choose videos...'}</span>
            <input
              type="file" multiple accept="video/*,.mp4,.mov,.mkv,.webm" className="hidden" disabled={running} data-testid="batch-files"
              onChange={(e) => { setFiles(Array.from(e.target.files || [])); setJobs([]); e.target.value = ''; }}
            />
          </label>

          <label className="block text-[10px] text-zinc-400 space-y-1">
            <span>Language of the videos</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={running}
              className="w-full bg-zinc-950/80 border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-white"
              data-testid="batch-language"
            >
              <option value="auto">Detect for each video</option>
              <option value="ru">Russian (Русский)</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="de">German</option>
              <option value="fr">French</option>
              <option value="hi">Hindi</option>
              <option value="urdu">Urdu (Roman Urdu)</option>
              <option value="ar">Arabic</option>
            </select>
            {language === 'auto' && <span className="block text-zinc-500">If all the videos are in one language, pick it: detection can be wrong on unclear audio.</span>}
          </label>

          <ExportAllSettingsForm value={settings} onChange={changeSettings} exportDir={exportDir} />

          {jobs.length > 0 && (
            <ul className="space-y-1.5" data-testid="batch-jobs">
              {jobs.map((j, i) => (
                <li key={i} className="p-2 rounded-lg bg-zinc-950/60 border border-white/[0.06]" data-testid="batch-job" data-status={j.status}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-200 truncate max-w-[60%]">{j.name}</span>
                    <span className={STATUS_COLOR[j.status]}>
                      {j.status === 'done' ? `${j.rendered ?? 0} short${j.rendered === 1 ? '' : 's'}${j.failed ? `, ${j.failed} failed` : ''}` : j.status}
                    </span>
                  </div>
                  {(j.status === 'transcribing' || j.status === 'rendering') && (
                    <div className="mt-1 h-1 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${j.progress}%` }} /></div>
                  )}
                  {(j.step || j.error) && <p className={`mt-0.5 text-[10px] ${j.error ? 'text-red-400' : 'text-zinc-500'}`}>{j.error || j.step}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/[0.08] flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">{jobs.length ? `${total} short${total === 1 ? '' : 's'} rendered` : ''}</span>
          <div className="flex items-center gap-2">
            {!!total && !running && (
              <button onClick={() => void fetch(apiUrl('/api/export/open-folder'), { method: 'POST' })} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-200 hover:bg-zinc-700">Open folder</button>
            )}
            {running ? (
              <button onClick={() => { stopRef.current = true; }} className="px-4 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-xs font-semibold text-red-200" data-testid="batch-stop-videos">Stop</button>
            ) : (
              <button onClick={() => void start()} disabled={!files.length} className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white disabled:opacity-40" data-testid="batch-start">
                Start
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
