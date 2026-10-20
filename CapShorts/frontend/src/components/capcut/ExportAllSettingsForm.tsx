import React from 'react';
import { ExportAllSettings } from '../../utils/exportAllSettings';
import { saveFraming } from '../../utils/exportPayload';

const sel = 'w-full bg-zinc-950/80 border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-indigo-500';

/** The settings "Export all" and the batch of videos render with. */
export const ExportAllSettingsForm: React.FC<{ value: ExportAllSettings; onChange: (s: ExportAllSettings) => void; exportDir?: string }> = ({ value, onChange, exportDir }) => {
  const set = <K extends keyof ExportAllSettings>(k: K, v: ExportAllSettings[K]) => {
    if (k === 'framing') saveFraming(v as ExportAllSettings['framing']);
    onChange({ ...value, [k]: v });
  };
  return (
    <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-400" data-testid="export-all-settings">
      <label className="space-y-1">
        <span>Which shorts</span>
        <select className={sel} value={value.which} onChange={(e) => set('which', e.target.value as ExportAllSettings['which'])} data-testid="ea-which">
          <option value="all">All</option>
          <option value="good">Strong and good</option>
          <option value="strong">Strong only</option>
        </select>
      </label>
      <label className="space-y-1">
        <span>Format</span>
        <select className={sel} value={value.resolution} onChange={(e) => set('resolution', e.target.value as ExportAllSettings['resolution'])} data-testid="ea-resolution">
          <option value="1080x1920">9:16 vertical</option>
          <option value="1080x1080">1:1 square</option>
          <option value="1920x1080">16:9 wide</option>
        </select>
      </label>
      <label className="space-y-1">
        <span>Framing (9:16)</span>
        <select className={sel} value={value.framing} onChange={(e) => set('framing', e.target.value as ExportAllSettings['framing'])} data-testid="ea-framing">
          <option value="auto">Follow the speaker</option>
          <option value="blur">Whole picture, blurred background</option>
        </select>
      </label>
      <label className="space-y-1">
        <span>File names</span>
        <select className={sel} value={value.naming} onChange={(e) => set('naming', e.target.value as ExportAllSettings['naming'])} data-testid="ea-naming">
          <option value="number-title">01 - Title</option>
          <option value="title">Title</option>
          <option value="video-number-title">Video - 01 - Title</option>
        </select>
      </label>
      <div className="col-span-2 flex items-center gap-3 text-zinc-300">
        {([['subtitles', 'Subtitles'], ['emoji', 'Emoji'], ['hookTitle', 'Hook titles']] as const).map(([k, label]) => (
          <label key={k} className="flex items-center space-x-1">
            <input type="checkbox" checked={value[k]} onChange={(e) => set(k, e.target.checked)} data-testid={`ea-${k}`} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {exportDir && <p className="col-span-2 text-zinc-500 break-all">Saved to: {exportDir} (change it in the Export window)</p>}
    </div>
  );
};
