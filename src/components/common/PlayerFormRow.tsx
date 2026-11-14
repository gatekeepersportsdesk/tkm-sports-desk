import React from 'react';
import { PlayerCardForm } from '../../lib/player_card_form';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface Props {
  form: PlayerCardForm;
  unit?: string;
  lineMoved?: { oldLine: number; newLine: number };
  className?: string;
}

export const PlayerFormRow: React.FC<Props> = ({ form, unit = '', lineMoved, className = '' }) => {
  const { l5, l10, oppBadge, minutesTrend, whyThisLean } = form;

  const hitRateColor = (rate: number) => {
    if (rate >= 70) return 'text-emerald-400 font-bold';
    if (rate >= 50) return 'text-cyan-300 font-semibold';
    if (rate >= 40) return 'text-slate-300';
    return 'text-rose-400';
  };

  return (
    <div className={`mt-1.5 pt-1.5 border-t border-[#1a2333] flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] font-mono select-none ${className}`}>
      {/* L5 & L10 Form Metrics */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[#556277] uppercase font-bold text-[9px] tracking-wider">Form:</span>

        {/* L5 Window */}
        {l5.games > 0 ? (
          <span className="bg-[#121927] border border-[#222d3e] rounded px-1.5 py-0.5 text-slate-300" title={`Last 5 games: cleared in ${l5.hits}/${l5.games} games, avg ${l5.avgStat} ${unit}`}>
            <span className="text-[#8b97ac] mr-1">L5</span>
            <span className={hitRateColor(l5.hitRatePct)}>{l5.hitRatePct}%</span>
            <span className="text-[#556277] ml-1">({l5.hits}/{l5.games} · avg {l5.avgStat}{unit})</span>
          </span>
        ) : (
          <span className="text-[#556277]">L5: --</span>
        )}

        {/* L10 Window */}
        {l10.games > 0 && (
          <span className="bg-[#121927] border border-[#222d3e] rounded px-1.5 py-0.5 text-slate-300" title={`Last 10 games: cleared in ${l10.hits}/${l10.games} games, avg ${l10.avgStat} ${unit}`}>
            <span className="text-[#8b97ac] mr-1">L10</span>
            <span className={hitRateColor(l10.hitRatePct)}>{l10.hitRatePct}%</span>
            <span className="text-[#556277] ml-1">({l10.hits}/{l10.games} · avg {l10.avgStat}{unit})</span>
          </span>
        )}

        {/* Opponent Defense Factor Badge */}
        {oppBadge && (
          <span
            className={`px-1.5 py-0.5 rounded border font-semibold ${
              oppBadge.includes('Soft')
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                : 'bg-rose-950/60 text-rose-300 border-rose-800'
            }`}
            title={oppBadge.includes('Soft') ? 'Opponent allows above-average stats (Bottom 10 Defense)' : 'Opponent suppresses stats (Top 10 Defense)'}
          >
            {oppBadge}
          </span>
        )}

        {/* NBA Minutes Trend */}
        {minutesTrend && (
          <span
            className={`px-1.5 py-0.5 rounded border font-semibold flex items-center gap-1 ${
              minutesTrend.direction === 'up'
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                : 'bg-amber-950/60 text-amber-300 border-amber-800'
            }`}
            title={`Minutes change: L5 avg vs season avg (${minutesTrend.diff > 0 ? '+' : ''}${minutesTrend.diff} min)`}
          >
            {minutesTrend.direction === 'up' ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-amber-400" />}
            <span>{minutesTrend.text}</span>
          </span>
        )}

        {/* Line Movement */}
        {lineMoved && lineMoved.oldLine !== lineMoved.newLine && (
          <span
            className="px-1.5 py-0.5 rounded border bg-cyan-950/60 text-cyan-300 border-cyan-800 font-semibold"
            title={`Line moved from ${lineMoved.oldLine} to ${lineMoved.newLine}`}
          >
            {lineMoved.newLine > lineMoved.oldLine ? '▲' : '▼'} Line {lineMoved.oldLine} → {lineMoved.newLine}
          </span>
        )}
      </div>

      {/* Why This Lean Summary */}
      {whyThisLean && (
        <div className="text-[10px] text-[#8b97ac] italic truncate max-w-full lg:max-w-md" title={whyThisLean}>
          <span className="text-cyan-400 not-italic font-semibold mr-1">Why:</span>
          {whyThisLean}
        </div>
      )}
    </div>
  );
};
