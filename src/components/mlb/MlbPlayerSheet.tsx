import React from 'react';
import { MlbBatterInput, MlbHitProjection, MlbGateResult } from '../../types/mlb';
import { MLB_DEFAULT_TUNE } from '../../model/mlb_engine';

interface MlbPlayerSheetProps {
  row: {
    batter: MlbBatterInput;
    hit: MlbHitProjection;
    gate: MlbGateResult;
    game: { away: string; home: string; park: number };
    price: { over: string; under: string };
  };
  onClose: () => void;
}

export const MlbPlayerSheet: React.FC<MlbPlayerSheetProps> = ({ row, onClose }) => {
  const { batter, hit, gate, game, price } = row;

  // Poisson-Binomial Hit Distribution
  const n = Math.max(1, Math.round(hit.ab));
  const p = Math.min(0.45, Math.max(0.15, hit.ba));
  const bin = (k: number) => {
    let c = 1;
    for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
    return c * Math.pow(p, k) * Math.pow(1 - p, n - k);
  };
  const z = bin(0);
  const one = bin(1);
  const two = bin(2);
  const three = Math.max(0, 1 - z - one - two);

  const barData = [
    { label: "0 hits", p: z },
    { label: "1 hit", p: one },
    { label: "2 hits", p: two },
    { label: "3+ hits", p: three }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-4">
      <div
        className="bg-[#121824] border border-[#222d3e] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[#222d3e] pb-3">
          <div>
            <span className="text-xs font-mono text-[#8b97ac]">
              {batter.team} &middot; Batting Slot {batter.slot} &middot; {batter.hand || 'R'}HB
            </span>
            <h2 className="text-2xl font-bold font-display uppercase tracking-wide text-white">
              {batter.name}
            </h2>
            <p className="text-xs text-[#8b97ac]">
              vs {batter.oppSp} ({batter.oppHand}) &middot; Park factor: {game.park.toFixed(3)}
            </p>
          </div>
          <button onClick={onClose} className="text-[#8b97ac] hover:text-white text-2xl font-bold p-1">
            &times;
          </button>
        </div>

        {/* Quick Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
          <div className="bg-[#182232] p-2.5 rounded-xl border border-[#222d3e]">
            <span className="text-[#8b97ac] text-[11px]">Gate Call</span>
            <p className={`text-lg font-bold ${gate.call === 'PLAY' ? 'text-emerald-400' : 'text-slate-400'}`}>
              {gate.call}
            </p>
          </div>
          <div className="bg-[#182232] p-2.5 rounded-xl border border-[#222d3e]">
            <span className="text-[#8b97ac] text-[11px]">Model Calibrated %</span>
            <p className="text-lg font-bold text-amber-400">
              {(gate.modelP * 100).toFixed(1)}%
            </p>
          </div>
          <div className="bg-[#182232] p-2.5 rounded-xl border border-[#222d3e]">
            <span className="text-[#8b97ac] text-[11px]">Market Fair (De-vig)</span>
            <p className="text-lg font-bold text-white">
              {gate.fair ? `${(gate.fair * 100).toFixed(1)}%` : '—'}
            </p>
          </div>
          <div className="bg-[#182232] p-2.5 rounded-xl border border-[#222d3e]">
            <span className="text-[#8b97ac] text-[11px]">Edge</span>
            <p className="text-lg font-bold text-emerald-400">
              {gate.edge ? `+${gate.edge.toFixed(1)} pts` : '—'}
            </p>
          </div>
          <div className="bg-[#182232] p-2.5 rounded-xl border border-[#222d3e]">
            <span className="text-[#8b97ac] text-[11px]">Kelly Stake (1/4)</span>
            <p className="text-lg font-bold text-white">
              {gate.stake}
            </p>
          </div>
          <div className="bg-[#182232] p-2.5 rounded-xl border border-[#222d3e]">
            <span className="text-[#8b97ac] text-[11px]">Hand Advantage</span>
            <p className="text-lg font-bold text-sky-400 uppercase">
              {gate.platoon}
            </p>
          </div>
        </div>

        {/* Why this Call Section */}
        <div className="bg-[#182232] p-3.5 rounded-xl border border-[#222d3e] space-y-1.5">
          <h3 className="text-xs font-bold font-display uppercase tracking-wider text-white">
            Why This Call (Gate Logic &amp; Constraints)
          </h3>
          <ul className="space-y-1 text-xs text-[#8b97ac]">
            {gate.why.map((w, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <span className="text-amber-400">&#8250;</span>
                <span className="text-white">{w}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Poisson-Binomial Hit Distribution Visualizer */}
        <div className="bg-[#182232] p-3.5 rounded-xl border border-[#222d3e]">
          <h3 className="text-xs font-bold font-display uppercase tracking-wider text-white mb-2">
            Poisson-Binomial Hit Distribution (AB ~ {hit.ab.toFixed(1)})
          </h3>
          <div className="flex items-end gap-3 h-28 bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            {barData.map(b => (
              <div key={b.label} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                <span className="text-[10px] font-mono text-[#8b97ac]">
                  {Math.round(b.p * 100)}%
                </span>
                <div
                  className={`w-full rounded-t transition-all ${b.label === '0 hits' ? 'bg-slate-700' : 'bg-amber-400'}`}
                  style={{ height: `${Math.max(6, b.p * 75)}px` }}
                />
                <span className="text-[10px] text-white font-mono">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step-by-Step Mathematical Derivation */}
        <div className="bg-[#182232] p-3.5 rounded-xl border border-[#222d3e] space-y-2 text-xs font-mono">
          <h3 className="text-xs font-bold font-display uppercase tracking-wider text-white">
            Mathematical Derivation (v5.8 11-Step Engine)
          </h3>
          <div className="space-y-1 text-[#8b97ac]">
            <p>1. Regressed Season BA: <span className="text-white font-medium">{batter.seasonBa.toFixed(3)}</span> regressed toward league ({MLB_DEFAULT_TUNE.lgBa})</p>
            <p>2. Starter K% Suppression: Starter K% is <span className="text-white font-medium">{hit.k.toFixed(1)}%</span> (kCoef = {MLB_DEFAULT_TUNE.kCoef})</p>
            <p>3. Park Multiplier: <span className="text-white font-medium">{game.park.toFixed(3)}</span> with 50% dampening</p>
            <p>4. Projected Expected AB: <span className="text-white font-medium">{hit.ab.toFixed(2)}</span> (Slot {batter.slot} share)</p>
            <p>5. Reference Anchor Centering: Aligned with top-3 anchor ({MLB_DEFAULT_TUNE.baseTop3HitRate}) with slope {MLB_DEFAULT_TUNE.compressionSlope}</p>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-[#222d3e]">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#182232] hover:bg-[#222d3e] text-white rounded-xl text-xs font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
