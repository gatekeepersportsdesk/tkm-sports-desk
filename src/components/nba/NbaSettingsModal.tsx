import React from 'react';
import { NbaSettings } from '../../types/nba';
import { NbaTuning, NBA_TUNING_META, NBA_TUNING_DEFAULTS, NBA_CONFIG } from '../../model/nba_engine';
import { NBA_MARKETS, NBA_MARKET_LABEL } from '../../types/nba';

interface Props {
  settings: NbaSettings;
  tuning: NbaTuning;
  onSettings: (s: NbaSettings) => void;
  onTuning: (t: NbaTuning) => void;
}

const statusStyle: Record<string, string> = {
  'fitted x scale': 'bg-emerald-950 text-emerald-300 border-emerald-800',
  setting: 'bg-slate-800 text-slate-300 border-slate-600'
};

export const NbaSettingsModal: React.FC<Props> = ({ settings, tuning, onSettings, onTuning }) => {
  const keys = Object.keys(NBA_TUNING_META) as (keyof NbaTuning)[];
  const changed = keys.filter(k => tuning[k] !== NBA_TUNING_DEFAULTS[k]).length;
  return (
    <div className="space-y-4">
      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e]">
        <div className="border-b border-[#222d3e] pb-3 mb-4">
          <h2 className="text-lg font-bold uppercase tracking-wide text-white">NBA Desk Settings (nba_v2 · seven markets)</h2>
          <p className="text-xs text-[#8b97ac]">Qualification thresholds, scales on the fitted values, and the fitted table itself. Changes apply immediately and are saved on this device.</p>
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
          <button onClick={() => onTuning({ ...NBA_TUNING_DEFAULTS })} disabled={!changed}
            className="text-xs font-mono px-3 py-1 rounded-lg border border-[#222d3e] text-[#8b97ac] hover:text-white disabled:opacity-40">
            Reset to defaults{changed ? ` (${changed} changed)` : ''}
          </button>
        </div>
        <p className="text-[11px] text-[#8b97ac] mb-3">The fitted coefficients below were estimated on real 2023-24 to 2025-26 NBA box scores and are not editable here; the scales multiply them (1 = as fitted). Don't move a scale before ~200 graded rows per market; use the scoreboard's interval coverage to judge. Logged ledger rows keep the dispersion r they were priced with.</p>

        <div className="grid sm:grid-cols-2 gap-3 text-xs font-mono">
          {keys.map(k => {
            const m = NBA_TUNING_META[k];
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
                <span className="text-[10px] text-[#556277] mt-1 block">default {NBA_TUNING_DEFAULTS[k]}{m.help ? ` · ${m.help}` : ''}</span>
              </label>
            );
          })}
        </div>

        <h3 className="text-sm font-bold uppercase tracking-wide text-white mt-6 mb-2">Fitted table (read-only)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead><tr className="border-b border-[#222d3e] text-[#8b97ac] uppercase text-[11px]">
              <th className="py-1.5 px-2">Market</th><th className="py-1.5 px-2 text-right">Rate K / pos K</th>
              <th className="py-1.5 px-2 text-right">Min. K / W(last5)</th><th className="py-1.5 px-2 text-right">Opp coef</th><th className="py-1.5 px-2 text-right">Absence coef / slope</th><th className="py-1.5 px-2 text-right">r = A·(min/30)^B</th>
              <th className="py-1.5 px-2 text-right">Team changer (K× · r× · level)</th><th className="py-1.5 px-2 text-right">Rookie / &lt;20 gm (K× · r× · level)</th>
            </tr></thead>
            <tbody>
              {NBA_MARKETS.map(m => { const q = NBA_CONFIG.fit.params[m]; const c = q.groups.changer, n = q.groups.new; return (
                <tr key={m} className="border-b border-[#222d3e]/50 text-white">
                  <td className="py-1.5 px-2 font-bold">{NBA_MARKET_LABEL[m]}</td><td className="py-1.5 px-2 text-right">{q.K} / {q.PK}</td>
                  <td className="py-1.5 px-2 text-right">{q.KM} / {q.W}</td><td className="py-1.5 px-2 text-right">{q.oppCoef.toFixed(3)}</td><td className="py-1.5 px-2 text-right">{q.absCoef.toFixed(3)} / {q.absSlope.toFixed(3)}</td><td className="py-1.5 px-2 text-right">{q.rA}·(min/30)^{q.rB}</td>
                  <td className="py-1.5 px-2 text-right">{c.kMult} · {c.rScale} · {c.lvl}</td><td className="py-1.5 px-2 text-right">{n.kMult} · {n.rScale} · {n.lvl}</td>
                </tr>); })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-[#556277] mt-2">{NBA_CONFIG.fit.source}. The absence coefficient was fitted on players who actually missed games, so a live injury report (which includes players who then play) may deserve an absence scale below 1.</p>
      </div>
    </div>
  );
};
