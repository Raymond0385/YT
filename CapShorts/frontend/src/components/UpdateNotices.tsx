import React, { useEffect, useRef, useState } from 'react';
import { Download, Sparkles, X } from 'lucide-react';
import { apiUrl } from '../config';
import { useVideoStore } from '../store/useVideoStore';
import { ChangeSection, changeLines, downloadAndInstall, loadCheckOnStart } from '../utils/updater';

/** The changes of one or more versions, newest first. */
export const ChangeList: React.FC<{ sections: ChangeSection[] }> = ({ sections }) => (
  <div className="space-y-3">
    {sections.map((s) => (
      <div key={s.version}>
        <div className="text-xs font-bold text-white">
          v{s.version} <span className="text-zinc-500 font-normal">{s.date}</span>
        </div>
        <ul className="mt-1 space-y-0.5">
          {changeLines(s.body).map((l, i) =>
            l.kind === 'heading' ? (
              <li key={i} className="text-[10px] uppercase tracking-wide text-indigo-300 font-semibold pt-1.5">{l.text}</li>
            ) : (
              <li key={i} className={`text-[11px] text-zinc-300 leading-snug ${l.kind === 'item' ? 'pl-3 relative before:content-["•"] before:absolute before:left-0 before:text-zinc-500' : ''}`}>
                {l.text}
              </li>
            ),
          )}
        </ul>
      </div>
    ))}
  </div>
);

interface UpdateInfo {
  update_available: boolean;
  latest_version: string;
  current_version: string;
  asset_size_mb?: number;
  changes?: ChangeSection[];
}

/**
 * On start: "what's new" after an update, and a notice when a newer version is out (with its changes and a
 * one-click update). Both appear once the engine is up.
 */
export const UpdateNotices: React.FC = () => {
  const online = useVideoStore((s) => s.engineHealth?.status === 'online');
  const [whatsNew, setWhatsNew] = useState<{ to: string; sections: ChangeSection[] } | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; progress: number; message?: string } | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (!online || checked.current) return;
    checked.current = true;
    void fetch(apiUrl('/api/system/whats-new'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.show && d.sections?.length) setWhatsNew({ to: d.to, sections: d.sections }); })
      .catch(() => undefined);
    if (loadCheckOnStart()) {
      void fetch(apiUrl('/api/system/update-status'))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.update_available) setUpdate(d); })
        .catch(() => undefined);
    }
  }, [online]);

  const closeWhatsNew = () => {
    setWhatsNew(null);
    void fetch(apiUrl('/api/system/whats-new/seen'), { method: 'POST' }).catch(() => undefined);
  };

  const install = () => {
    setProgress({ phase: 'downloading', progress: 0 });
    void downloadAndInstall((p) => setProgress(p));
  };

  return (
    <>
      {whatsNew && (
        <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="whats-new">
          <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl bg-zinc-900 border border-white/10 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">What's new in Kadr {whatsNew.to}</h3>
              </div>
              <button onClick={closeWhatsNew} className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06]"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 overflow-y-auto"><ChangeList sections={whatsNew.sections} /></div>
            <div className="px-5 py-3 border-t border-white/[0.08] flex justify-end">
              <button onClick={closeWhatsNew} className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white" data-testid="whats-new-ok">Got it</button>
            </div>
          </div>
        </div>
      )}

      {update && !whatsNew && (
        <div className="fixed bottom-4 right-4 z-[80] w-80 rounded-2xl bg-zinc-900/95 border border-indigo-500/40 shadow-2xl p-3.5 space-y-2" data-testid="update-notice">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-bold text-white">Kadr {update.latest_version} is available</div>
              <div className="text-[10px] text-zinc-400">You have {update.current_version}{update.asset_size_mb ? ` · ${update.asset_size_mb} MB` : ''}</div>
            </div>
            {!progress && <button onClick={() => setUpdate(null)} className="p-0.5 text-zinc-500 hover:text-white" title="Later"><X className="w-3.5 h-3.5" /></button>}
          </div>
          {!!update.changes?.length && (
            <>
              <button onClick={() => setShowChanges((v) => !v)} className="text-[11px] text-indigo-300 hover:text-white underline" data-testid="update-changes-toggle">
                {showChanges ? 'Hide changes' : "What's new"}
              </button>
              {showChanges && <div className="max-h-56 overflow-y-auto pr-1"><ChangeList sections={update.changes} /></div>}
            </>
          )}
          {progress ? (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress.progress}%` }} /></div>
              <p className={`text-[10px] ${progress.phase === 'error' ? 'text-red-400' : 'text-zinc-400'}`}>
                {progress.phase === 'downloading' ? `Downloading... ${progress.progress}%`
                  : progress.phase === 'launching' ? 'Starting the installer...'
                  : progress.phase === 'launched' ? 'The installer is open: it will close Kadr and update it.'
                  : progress.message}
              </p>
              {progress.phase === 'error' && <button onClick={install} className="text-[11px] text-indigo-300 underline">Try again</button>}
            </div>
          ) : (
            <button onClick={install} className="w-full flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white" data-testid="update-install">
              <Download className="w-3.5 h-3.5" />
              <span>Update now</span>
            </button>
          )}
        </div>
      )}
    </>
  );
};
