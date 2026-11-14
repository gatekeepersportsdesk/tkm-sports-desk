import React, { useState } from 'react';
import { MLB_DEFAULT_TUNE } from '../../model/mlb_engine';
import { RotateCcw } from 'lucide-react';

interface MlbSettingsProps {
  tune: typeof MLB_DEFAULT_TUNE;
  onUpdateTune: (updated: typeof MLB_DEFAULT_TUNE) => void;
  onResetTune: () => void;
}

export const MlbSettings: React.FC<MlbSettingsProps> = ({
  tune,
  onUpdateTune,
  onResetTune
}) => {
  // Text drafts: a half-typed value ("-", "0.") must never reach the engine as NaN/string.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const handleChange = (key: string, value: string) => {
    setDrafts(d => ({ ...d, [key]: value }));
    const updated = { ...tune };
    if (value === "true") (updated as any)[key] = true;
    else if (value === "false") (updated as any)[key] = false;
    else {
      const num = Number(value);
      if (value.trim() === '' || !Number.isFinite(num)) return; // keep the last valid value
      (updated as any)[key] = num;
    }
    onUpdateTune(updated);
  };

  return (
    <div className="space-y-4">
      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e]">
        <div className="flex items-center justify-between border-b border-[#222d3e] pb-3 mb-4">
          <div>
            <h2 className="text-lg font-bold font-display uppercase tracking-wide text-white">
              TUNE Parameters (Engine v5.8)
            </h2>
            <p className="text-xs text-[#8b97ac]">
              Model constants. Edit with care — every change is checked by the reference-hitter anchor and the ledger, not by the screen.
            </p>
          </div>
          <button
            onClick={() => { setDrafts({}); onResetTune(); }}
            className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs font-mono rounded-lg flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Defaults
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs font-mono">
          {Object.entries(tune).map(([k, val]) => {
            if (typeof val === 'object') return null;
            return (
              <label key={k} className="flex flex-col gap-1 p-2.5 bg-[#0f1520] rounded-xl border border-[#222d3e]">
                <span className="text-[#8b97ac] text-[11px]">{k}</span>
                <input
                  type="text"
                  value={drafts[k] ?? String(val)}
                  onChange={e => handleChange(k, e.target.value)}
                  className="bg-[#182232] border border-[#222d3e] rounded-lg px-2.5 py-1.5 text-white font-mono outline-none focus:border-amber-400"
                />
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
};
