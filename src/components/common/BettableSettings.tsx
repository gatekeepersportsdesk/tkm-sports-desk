import React, { useState } from 'react';
import { BettableConfig, DEFAULT_BETTABLE, FLOOR_META, RankBy } from '../../lib/bettable';
import { useDisplaySettings } from './DisplaySettingsContext';
import { getArchiveNotificationEmail, setArchiveNotificationEmail } from '../../lib/storage_archive';
import { Coins, DollarSign, Mail, Archive } from 'lucide-react';

interface Props { cfg: BettableConfig; onChange: (c: BettableConfig) => void }
const field = 'w-full bg-[#182232] border border-[#222d3e] rounded-lg p-2 text-white outline-none focus:border-cyan-400';

/**
 * Shared across every sport (one config).
 * Controls:
 * 1. Units vs Currency display toggle and dollar multiplier per unit.
 * 2. Bettable filter thresholds (juice, rankBy, floors). Model numbers and the daily card are untouched.
 * 3. Daily card storage archive email notification setting.
 */
export const BettableSettings: React.FC<Props> = ({ cfg, onChange }) => {
  const { displayCfg, setDisplayCfg } = useDisplaySettings();
  const [archiveEmail, setArchiveEmailState] = useState<string>(() => getArchiveNotificationEmail());
  const [emailSavedMsg, setEmailSavedMsg] = useState(false);

  const handleEmailChange = (val: string) => {
    setArchiveEmailState(val);
    setArchiveNotificationEmail(val);
    setEmailSavedMsg(true);
    setTimeout(() => setEmailSavedMsg(false), 2000);
  };

  return (
    <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] space-y-5">
      {/* 1. Units vs Currency Display Toggle */}
      <div className="border-b border-[#222d3e] pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#0f1520] border border-[#222d3e] text-cyan-400">
            {displayCfg.mode === 'currency' ? <DollarSign className="w-4 h-4" /> : <Coins className="w-4 h-4" />}
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-white">
              Stakes &amp; P&amp;L Display Format
            </h3>
            <p className="text-xs text-[#8b97ac]">
              Toggle how stakes, realized returns, and ledger P&amp;L are displayed across all sports desks, history, and scoreboards.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 text-xs font-mono">
          {/* Format Mode Picker */}
          <div className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] space-y-2">
            <span className="block text-[#8b97ac] uppercase text-[11px]">Display Mode</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDisplayCfg(prev => ({ ...prev, mode: 'units' }))}
                className={`py-2 px-3 rounded-lg border text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  displayCfg.mode === 'units'
                    ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold shadow-sm shadow-cyan-950/40'
                    : 'bg-[#182232] text-[#8b97ac] border-[#222d3e] hover:text-white'
                }`}
              >
                <Coins className="w-3.5 h-3.5" />
                Units (u)
              </button>

              <button
                type="button"
                onClick={() => setDisplayCfg(prev => ({ ...prev, mode: 'currency' }))}
                className={`py-2 px-3 rounded-lg border text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  displayCfg.mode === 'currency'
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold shadow-sm shadow-emerald-950/40'
                    : 'bg-[#182232] text-[#8b97ac] border-[#222d3e] hover:text-white'
                }`}
              >
                <DollarSign className="w-3.5 h-3.5" />
                Currency ($)
              </button>
            </div>
            <span className="text-[10px] text-[#556277] block">
              {displayCfg.mode === 'units'
                ? 'Default mode: shows 1.0u, +2.50u, -1.00u.'
                : 'Currency mode: scales every unit by your specified unit value.'}
            </span>
          </div>

          {/* Unit Value Input (Active when Currency is selected) */}
          <div className={`p-3 rounded-xl border transition ${
            displayCfg.mode === 'currency'
              ? 'bg-[#0f1520] border-emerald-500/50'
              : 'bg-[#0f1520]/50 border-[#222d3e] opacity-60'
          }`}>
            <span className="block text-[#8b97ac] uppercase text-[11px] mb-1">
              Unit Value in Dollars (1 unit = $___)
            </span>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-[#8b97ac] font-bold text-xs">$</span>
              <input
                type="number"
                min="0.01"
                step="1"
                disabled={displayCfg.mode !== 'currency'}
                value={displayCfg.unitValue}
                onChange={e => {
                  const val = parseFloat(e.target.value);
                  setDisplayCfg(prev => ({ ...prev, unitValue: Number.isFinite(val) && val > 0 ? val : 1 }));
                }}
                className={`w-full bg-[#182232] border border-[#222d3e] rounded-lg p-2 pl-7 text-white outline-none focus:border-emerald-400 ${
                  displayCfg.mode !== 'currency' ? 'cursor-not-allowed' : ''
                }`}
                placeholder="1"
              />
            </div>
            <span className="text-[10px] text-[#556277] mt-1.5 block">
              {displayCfg.mode === 'currency'
                ? `1.0u will show as $${displayCfg.unitValue}, 2.5u as $${displayCfg.unitValue * 2.5}.`
                : 'Switch to Currency ($) above to configure unit dollar value.'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Bettable Filter Configuration */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-white">Bettable filter (all sports)</h3>
        <p className="text-xs text-[#8b97ac]">
          A row is bettable when inputs are REAL, availability is known and not out / doubtful, expected usage clears the floor, and any posted price on the chosen side is not worse than the juice limit. Hidden rows stay in the model and the daily card; the "Full model" toggle on the desk shows them.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 text-xs font-mono">
        <label className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] block">
          <span className="block text-[#8b97ac] uppercase text-[11px] mb-1">Max juice (American)</span>
          <input type="number" step="5" min="100" value={cfg.maxJuice} onChange={e => onChange({ ...cfg, maxJuice: Math.max(100, parseInt(e.target.value) || 175) })} className={field} />
          <span className="text-[10px] text-[#556277] mt-1 block">175 = nothing priced worse than −175 is bettable.</span>
        </label>
        <label className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] block">
          <span className="block text-[#8b97ac] uppercase text-[11px] mb-1">Default sort</span>
          <select value={cfg.rankBy} onChange={e => onChange({ ...cfg, rankBy: e.target.value as RankBy })} className={field}>
            <option value="ev">EV at the posted price</option><option value="edge">Edge vs de-vigged price</option><option value="p">Model win probability</option>
          </select>
          <span className="text-[10px] text-[#556277] mt-1 block">Unpriced rows always sort below priced ones.</span>
        </label>
        <label className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={cfg.bettableOnly} onChange={e => onChange({ ...cfg, bettableOnly: e.target.checked })} className="accent-cyan-400" />
          <span className="text-[#8b97ac] uppercase text-[11px]">Bettable only by default</span>
        </label>
      </div>

      <div className="grid sm:grid-cols-4 gap-3 text-xs font-mono">
        {FLOOR_META.map(f => (
          <label key={f.key} className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] block">
            <span className="block text-[#8b97ac] text-[11px] mb-1">{f.label}</span>
            <input type="number" step={f.step} min="0" value={cfg.floors[f.key]} onChange={e => onChange({ ...cfg, floors: { ...cfg.floors, [f.key]: Math.max(0, parseFloat(e.target.value) || 0) } })} className={field} />
            {f.help && <span className="text-[10px] text-[#556277] mt-1 block">{f.help}</span>}
          </label>
        ))}
      </div>

      {/* 3. Storage & Auto-Archive Settings */}
      <div className="border-t border-[#222d3e] pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#0f1520] border border-[#222d3e] text-amber-400">
            <Archive className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-white">
              Storage Full &amp; Auto-Archive Backups
            </h3>
            <p className="text-xs text-[#8b97ac]">
              When browser storage fills up, snapshots older than 14 days are automatically archived to a JSON file in your Downloads folder so grading is never blocked and current cards are never lost.
            </p>
          </div>
        </div>

        <div className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] text-xs font-mono space-y-2">
          <label className="block">
            <span className="text-[#8b97ac] uppercase text-[11px] flex items-center gap-1.5 mb-1.5">
              <Mail className="w-3.5 h-3.5 text-cyan-400" />
              Archive Backup Notification Email (Optional)
            </span>
            <input
              type="email"
              value={archiveEmail}
              onChange={e => handleEmailChange(e.target.value)}
              placeholder="e.g. appsbuilder1996@gmail.com"
              className={field}
            />
          </label>
          <div className="flex items-center justify-between text-[10px] text-[#556277]">
            <span>
              If provided, automatically drafts an email backup notification with details when older daily cards are archived to your computer.
            </span>
            {emailSavedMsg && <span className="text-emerald-400 font-bold shrink-0">Saved</span>}
          </div>
        </div>
      </div>

      <button onClick={() => onChange(DEFAULT_BETTABLE)} className="px-2.5 py-1 rounded border border-[#222d3e] text-[11px] font-mono text-[#8b97ac] hover:text-white cursor-pointer">
        Reset filter to defaults
      </button>
    </div>
  );
};
