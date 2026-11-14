import React from 'react';
import { NhlSettings } from '../../types/nhl';
import { NhlTuning, NHL_TUNING_META, NHL_TUNING_DEFAULTS, NHL_FITTED_KEYS } from '../../model/nhl_engine';

interface Props {
  settings: NhlSettings;
  tuning: NhlTuning;
  onSettings: (s: NhlSettings) => void;
  onTuning: (t: NhlTuning) => void;
}

const statusStyle: Record<string, string> = {
  'fitted from data': 'bg-emerald-950 text-emerald-300 border-emerald-800',
  'frozen from sog_v1': 'bg-sky-950 text-sky-300 border-sky-800',
  'prior — not fitted': 'bg-amber-950 text-amber-300 border-amber-800',
  'prior — not measured': 'bg-amber-950 text-amber-300 border-amber-800',
  setting: 'bg-slate-800 text-slate-300 border-slate-600'
};

export const NhlSettingsModal: React.FC<Props> = ({ settings, tuning, onSettings, onTuning }) => {
  const keys = Object.keys(NHL_TUNING_META) as (keyof NhlTuning)[];
  const changed = keys.filter(k => tuning[k] !== NHL_TUNING_DEFAULTS[k]).length;
  return (
    <div className="space-y-4">
      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e]">
        <div className="border-b border-[#222d3e] pb-3 mb-4">
          <h2 className="text-lg font-bold uppercase tracking-wide text-white">NHL Desk Settings (sog_v2 · shots + points)</h2>
          <p className="text-xs text-[#8b97ac]">Qualification thresholds, then every prior / frozen model value. Changes apply immediately and are saved on this device.</p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 text-xs font-mono mb-6">
          <label className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] block">
            <span className="block text-[#8b97ac] uppercase text-[11px] mb-1">Min edge (pp)</span>
            <input type="number" step="0.5" value={settings.edgeThreshold}
              onChange={e => onSettings({ ...settings, edgeThreshold: parseFloat(e.target.value) || 5 })}
              className="w-full bg-[#182232] border border-[#222d3e] rounded-lg p-2 text-white outline-none focus:border-cyan-400" />
            <span className="text-[10px] text-[#556277] mt-1 block">Edge vs the de-vigged price. EV &gt; 0 is always required as well.</span>
          </label>
          <label className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] block">
            <span className="block text-[#8b97ac] uppercase text-[11px] mb-1">Worst chalk (American)</span>
            <input type="number" value={settings.maxJuice}
              onChange={e => onSettings({ ...settings, maxJuice: parseInt(e.target.value) || -200 })}
              className="w-full bg-[#182232] border border-[#222d3e] rounded-lg p-2 text-white outline-none focus:border-cyan-400" />
            <span className="text-[10px] text-[#556277] mt-1 block">Applies to whichever side you would bet.</span>
          </label>
          <label className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] flex items-center justify-between gap-3">
            <span>
              <span className="text-white font-bold block">Qualifying rows only</span>
              <span className="text-[10px] text-[#556277]">Hide every PASS row</span>
            </span>
            <input type="checkbox" checked={settings.showStabsOnly}
              onChange={e => onSettings({ ...settings, showStabsOnly: e.target.checked })} className="w-4 h-4 accent-cyan-400" />
          </label>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-white">Model parameters</h3>
          <button onClick={() => onTuning({ ...NHL_TUNING_DEFAULTS })} disabled={!changed}
            className="text-xs font-mono px-3 py-1 rounded-lg border border-[#222d3e] text-[#8b97ac] hover:text-white disabled:opacity-40">
            Reset to defaults{changed ? ` (${changed} changed)` : ''}
          </button>
        </div>
        <p className="text-[11px] text-[#8b97ac] mb-3">
          {NHL_FITTED_KEYS.length ? `${NHL_FITTED_KEYS.length} of these were fitted on real game logs (green); the rest are still priors.` : 'None of these were fitted on NHL data yet (run scripts/fit_nhl_moneypuck.py on your MoneyPuck files).'} Use the scoreboard's interval coverage and reliability bins to move them, and don't trust a change before ~200 graded rows per market. Logged ledger rows keep the dispersion r they were priced with.
        </p>

        <div className="grid sm:grid-cols-2 gap-3 text-xs font-mono">
          {keys.map(k => {
            const m = NHL_TUNING_META[k];
            return (
              <label key={k} className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] block">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[#8b97ac] uppercase text-[11px]">{m.label}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${statusStyle[m.status]}`}>{m.status}</span>
                </div>
                <input type="number" min={m.min} max={m.max} step={m.step} value={tuning[k]}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v)) onTuning({ ...tuning, [k]: Math.min(m.max, Math.max(m.min, v)) });
                  }}
                  className="w-full bg-[#182232] border border-[#222d3e] rounded-lg p-2 text-white outline-none focus:border-cyan-400" />
                <span className="text-[10px] text-[#556277] mt-1 block">default {NHL_TUNING_DEFAULTS[k]}{m.help ? ` · ${m.help}` : ''}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
};
