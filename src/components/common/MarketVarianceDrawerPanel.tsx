import React from 'react';
import { Zap, TrendingUp, TrendingDown, Layers, AlertCircle, Info } from 'lucide-react';
import { MarketVarianceInfo } from '../../lib/market_variance';

interface Props {
  variance: MarketVarianceInfo;
  sportLabel?: string;
  marketUnit?: string;
}

export const MarketVarianceDrawerPanel: React.FC<Props> = ({
  variance,
  sportLabel = 'Player Prop',
  marketUnit = 'units'
}) => {
  const isHigh = variance.level === 'HIGH';
  const isModerate = variance.level === 'MODERATE';

  return (
    <div className={`p-3.5 rounded-xl border text-xs font-mono space-y-2.5 transition ${
      isHigh
        ? 'bg-[#151c28] border-amber-500/50 shadow-md shadow-amber-950/30'
        : isModerate
        ? 'bg-[#111824] border-sky-600/40'
        : 'bg-[#0f1520] border-[#222d3e]'
    }`}>
      <div className="flex items-center justify-between border-b border-[#222d3e] pb-2">
        <div className="flex items-center gap-2">
          <Zap className={`w-4 h-4 ${isHigh ? 'text-amber-400 animate-pulse' : isModerate ? 'text-sky-400' : 'text-slate-400'}`} />
          <span className="font-bold text-white uppercase tracking-wider text-[11px]">
            Market Variance & Line Movement Analysis
          </span>
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
          isHigh
            ? 'bg-amber-950 text-amber-300 border border-amber-600'
            : isModerate
            ? 'bg-sky-950 text-sky-300 border border-sky-600'
            : 'bg-slate-800 text-slate-400 border border-slate-700'
        }`}>
          {variance.level} VARIANCE (Score: {variance.score}/100)
        </span>
      </div>

      {/* Flagged Reasons */}
      <div className="space-y-1">
        <span className="text-[10px] text-[#8b97ac] uppercase tracking-wide block">Variance & Movement Signals:</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {variance.reasons.map((r, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] bg-[#0b0f14] p-1.5 rounded border border-[#222d3e]">
              <span className={`font-bold mt-0.5 ${isHigh ? 'text-amber-400' : 'text-sky-400'}`}>•</span>
              <span className="text-slate-200">{r}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
        <div className="bg-[#0b0f14] p-2 rounded-lg border border-[#222d3e]">
          <span className="text-[9px] text-[#8b97ac] block uppercase">Model Win %</span>
          <span className="text-cyan-400 font-bold text-sm">{(variance.modelProb * 100).toFixed(1)}%</span>
        </div>

        <div className="bg-[#0b0f14] p-2 rounded-lg border border-[#222d3e]">
          <span className="text-[9px] text-[#8b97ac] block uppercase">Market Implied %</span>
          <span className="text-white font-bold text-sm">
            {variance.marketImpliedProb != null ? `${(variance.marketImpliedProb * 100).toFixed(1)}%` : 'Unpriced'}
          </span>
          {variance.probDivergence != null && (
            <span className="block text-[9px] text-amber-400">Δ {variance.probDivergence.toFixed(1)}pp</span>
          )}
        </div>

        <div className="bg-[#0b0f14] p-2 rounded-lg border border-[#222d3e]">
          <span className="text-[9px] text-[#8b97ac] block uppercase">Card Baseline Avg</span>
          <span className="text-slate-300 font-bold text-sm">
            {variance.baselineAvg != null ? `${variance.baselineAvg.toFixed(2)}` : '—'}
          </span>
          {variance.shiftPct != null && (
            <span className={`block text-[9px] font-bold ${variance.shiftPct >= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
              {variance.shiftPct >= 0 ? '+' : ''}{variance.shiftPct.toFixed(1)}% shift
            </span>
          )}
        </div>

        <div className="bg-[#0b0f14] p-2 rounded-lg border border-[#222d3e]">
          <span className="text-[9px] text-[#8b97ac] block uppercase">External Books Spread</span>
          <span className="text-sky-300 font-bold text-sm">
            {variance.externalMovement ? `${variance.externalMovement.lineSpread.toFixed(1)} pts` : 'Single Book'}
          </span>
          {variance.externalMovement && (
            <span className="block text-[9px] text-[#8b97ac]">
              {variance.externalMovement.minLine} - {variance.externalMovement.maxLine} ({variance.externalMovement.bookCount} books)
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
