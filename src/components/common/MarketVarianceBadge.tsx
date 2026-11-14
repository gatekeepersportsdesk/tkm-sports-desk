import React, { useState, useRef, useEffect } from 'react';
import { Zap, AlertTriangle, TrendingUp, TrendingDown, Layers, HelpCircle, X } from 'lucide-react';
import { MarketVarianceInfo } from '../../lib/market_variance';

interface Props {
  info: MarketVarianceInfo;
  compact?: boolean;
}

export const MarketVarianceBadge: React.FC<Props> = ({ info, compact = false }) => {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (info.level === 'NORMAL') {
    return null;
  }

  const isHigh = info.level === 'HIGH';

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className={`flex items-center gap-1 font-mono text-[10px] tracking-wide rounded px-1.5 py-0.5 cursor-pointer transition select-none ${
          isHigh
            ? 'bg-amber-950/80 text-amber-300 border border-amber-500/70 hover:bg-amber-900/90 shadow-sm shadow-amber-950/50 font-bold'
            : 'bg-sky-950/70 text-sky-300 border border-sky-600/50 hover:bg-sky-900/80 font-medium'
        }`}
        title="Click to view market variance & line movement breakdown"
      >
        <Zap className={`w-3 h-3 ${isHigh ? 'text-amber-400 animate-pulse' : 'text-sky-400'}`} />
        <span>{isHigh ? (compact ? 'VARIANCE' : 'HIGH VARIANCE') : 'LINE SHIFT'}</span>
        {info.shiftPct != null && Math.abs(info.shiftPct) >= 20 && (
          <span className="opacity-90 font-mono text-[9px] hidden sm:inline">
            ({info.shiftPct > 0 ? '+' : ''}{info.shiftPct.toFixed(0)}%)
          </span>
        )}
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-50 left-0 sm:left-auto sm:right-0 mt-1.5 w-72 sm:w-80 bg-[#101726] border border-amber-500/40 rounded-xl p-3 shadow-2xl text-xs font-mono text-slate-200"
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#222d3e]">
            <div className="flex items-center gap-1.5 text-amber-300 font-bold">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>{isHigh ? 'High Market Variance Flag' : 'Market Movement & Shift'}</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2 mb-3">
            <div className="text-[11px] text-[#8b97ac]">
              Detected indicators triggering this variance alert:
            </div>
            <ul className="space-y-1">
              {info.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-200/90 bg-amber-950/30 p-1.5 rounded border border-amber-800/30">
                  <span className="text-amber-400 font-bold mt-0.5">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-[#0b0f14] p-2 rounded-lg border border-[#222d3e] space-y-1.5 text-[11px]">
            <div className="flex justify-between items-center text-slate-400">
              <span>Model Probability:</span>
              <span className="text-cyan-400 font-bold">{(info.modelProb * 100).toFixed(1)}%</span>
            </div>
            {info.marketImpliedProb != null && (
              <div className="flex justify-between items-center text-slate-400">
                <span>Market Implied P:</span>
                <span className="text-white font-medium">{(info.marketImpliedProb * 100).toFixed(1)}%</span>
              </div>
            )}
            {info.probDivergence != null && (
              <div className="flex justify-between items-center text-slate-400">
                <span>Model vs Market Δ:</span>
                <span className="text-amber-300 font-bold">{info.probDivergence.toFixed(1)} pp</span>
              </div>
            )}
            {info.baselineAvg != null && (
              <div className="flex justify-between items-center text-slate-400 pt-1 border-t border-[#222d3e]/50">
                <span>Daily-Card Baseline:</span>
                <span className="text-slate-300 font-medium">{info.baselineAvg.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-slate-400">
              <span>Current Projected &mu;:</span>
              <span className="text-cyan-300 font-bold">{info.projectedMu.toFixed(2)}</span>
            </div>
            {info.shiftPct != null && (
              <div className="flex justify-between items-center text-slate-400">
                <span>Baseline Shift:</span>
                <span className={info.shiftPct >= 0 ? 'text-emerald-400 font-bold' : 'text-orange-400 font-bold'}>
                  {info.shiftPct >= 0 ? '+' : ''}{info.shiftPct.toFixed(1)}%
                </span>
              </div>
            )}
            {info.externalMovement && (
              <div className="flex justify-between items-center text-slate-400 pt-1 border-t border-[#222d3e]/50">
                <span>Sportsbook Spread:</span>
                <span className="text-sky-300 font-bold">
                  {info.externalMovement.minLine} - {info.externalMovement.maxLine} ({info.externalMovement.bookCount} books)
                </span>
              </div>
            )}
          </div>

          <div className="mt-2 text-[9px] text-[#556277] leading-tight">
            High market variance signals significant bookmaker disagreement, sharp model divergence, or heavy daily card projection shift from baseline.
          </div>
        </div>
      )}
    </div>
  );
};
