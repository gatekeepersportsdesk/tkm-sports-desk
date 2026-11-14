import React from 'react';
import { PickOfTheDay } from '../../lib/pick_of_the_day';
import { Crown, Zap, Trophy } from 'lucide-react';
import { fmtAmerican } from '../../lib/odds';

interface Props {
  pick: PickOfTheDay | null;
  sportLabel: string;
  isOverallBest?: boolean;
}

export const PickOfTheDayCard: React.FC<Props> = ({ pick, sportLabel, isOverallBest }) => {
  if (!pick) {
    return (
      <div className="bg-[#121824] rounded-2xl border border-[#222d3e] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0f1520] border border-[#222d3e] flex items-center justify-center text-[#556277] shrink-0">
            <Crown className="w-4 h-4 text-[#556277]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-[#8b97ac]">
                {sportLabel} · Pick of the Day
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#182232] text-amber-400 border border-amber-500/30 font-semibold">
                Odds Required
              </span>
            </div>
            <p className="text-xs font-mono font-bold text-white mt-1">
              Import odds to unlock Pick of the Day.
            </p>
            <p className="text-[11px] font-mono text-[#8b97ac] mt-0.5">
              Ranked strictly by EV at posted book price among bettable rows only. Requires positive EV (&gt; 0) and real sportsbook lines.
            </p>
          </div>
        </div>
        <div className="text-[11px] font-mono text-[#556277] shrink-0 hidden md:block">
          Odds-Gated · Pure Math
        </div>
      </div>
    );
  }

  const oddsStr = fmtAmerican(pick.odds);
  const evPct = (pick.ev * 100).toFixed(1);
  const isValidEdge = pick.edge != null && Number.isFinite(pick.edge) && Math.abs(pick.edge) <= 50;
  const edgePts = isValidEdge ? `${pick.edge >= 0 ? '+' : ''}${pick.edge.toFixed(1)}pp` : '—';
  const probPct = (pick.modelProb * 100).toFixed(1);

  return (
    <div className={`rounded-2xl border p-4 shadow-lg transition relative overflow-hidden ${
      isOverallBest
        ? 'bg-gradient-to-r from-[#111c2a] via-[#122030] to-[#121824] border-amber-500/60 shadow-amber-950/20'
        : 'bg-gradient-to-r from-[#0d1622] to-[#121824] border-cyan-500/50 shadow-cyan-950/20'
    }`}>
      {/* Top Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#222d3e]/70 mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg flex items-center justify-center ${
            isOverallBest ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-amber-400/90 text-slate-950 font-bold'
          }`}>
            <Crown className="w-3.5 h-3.5 fill-current" />
          </div>
          <span className="text-xs font-mono uppercase tracking-wider font-bold text-white">
            {sportLabel} · Pick of the Day
          </span>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-500/60 flex items-center gap-1">
            <Crown className="w-3 h-3 text-amber-400" />
            POTD
          </span>
          {isOverallBest && (
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 flex items-center gap-1">
              <Trophy className="w-3 h-3 fill-current" />
              Slate Best EV
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-[#8b97ac] flex-wrap">
          {pick.capturedAt && (
            <span className="px-2 py-0.5 rounded bg-[#182232] text-cyan-400 border border-[#222d3e] font-semibold">
              Calculated: {new Date(pick.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <span>Ranked strictly by EV at posted price · Bettable verified</span>
        </div>
      </div>

      {/* Main Pick Content */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Player and Selection */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base sm:text-lg font-bold text-white font-display uppercase tracking-wide">
              {pick.player}
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#182232] text-cyan-300 border border-[#222d3e]">
              {pick.team} {pick.opp ? `vs ${pick.opp}` : ''}
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#0f1520] text-[#8b97ac] border border-[#222d3e]">
              {pick.marketLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide border ${
              pick.side === 'over'
                ? 'bg-emerald-950 text-emerald-300 border-emerald-500'
                : 'bg-orange-950 text-orange-300 border-orange-500'
            }`}>
              {pick.side.toUpperCase()} {pick.line}
            </span>
            <span className="text-xs font-mono font-bold text-white bg-[#0f1520] border border-[#222d3e] px-2.5 py-1 rounded-lg">
              {oddsStr}
            </span>
          </div>
        </div>

        {/* Math & EV Metrics */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="bg-[#0f1520] border border-[#222d3e] rounded-xl px-3 py-1.5 text-center min-w-[85px]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase block">Model Win</span>
            <span className="text-xs sm:text-sm font-mono font-bold text-white">{probPct}%</span>
          </div>

          <div className="bg-[#0f1520] border border-[#222d3e] rounded-xl px-3 py-1.5 text-center min-w-[85px]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase block">Edge</span>
            <span className="text-xs sm:text-sm font-mono font-bold text-emerald-400">{edgePts}</span>
          </div>

          <div className="bg-emerald-950/80 border border-emerald-500 rounded-xl px-3.5 py-1.5 text-center min-w-[100px] shadow-sm shadow-emerald-950/50 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-emerald-300 uppercase font-bold flex items-center justify-center gap-1">
              <Zap className="w-3 h-3 text-emerald-400 fill-current animate-pulse" />
              Top EV
            </span>
            <span className="text-sm sm:text-base font-mono font-bold text-emerald-300">
              +{evPct}% EV
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
