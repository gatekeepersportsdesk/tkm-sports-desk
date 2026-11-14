import React, { useState } from 'react';
import { MlbBatterInput, MlbHitProjection, MlbGateResult } from '../../types/mlb';

interface MlbBatterCardProps {
  row: {
    batter: MlbBatterInput;
    hit: MlbHitProjection;
    gate: MlbGateResult;
    game: { away: string; home: string; park: number };
    price: { over: string; under: string; line?: number };
  };
  inParlay: boolean;
  onToggleParlay: () => void;
  onOpenSheet: () => void;
  onOddsChange: (side: 'over' | 'under', val: string) => void;
  onLineChange?: (line: number) => void;
  onLogBet?: (draft: { sport: 'mlb'; player: string; team?: string; opp?: string; market: string; side: 'OVER' | 'UNDER'; line: number; odds: number }) => void;
}

export const MlbBatterCard: React.FC<MlbBatterCardProps> = ({
  row,
  inParlay,
  onToggleParlay,
  onOpenSheet,
  onOddsChange,
  onLineChange,
  onLogBet
}) => {
  const { batter, gate, price } = row;
  const currentLine = price.line !== undefined ? price.line : 0.5;
  const [lineInput, setLineInput] = useState<string>(String(currentLine));

  React.useEffect(() => {
    setLineInput(String(price.line !== undefined ? price.line : 0.5));
  }, [price.line]);

  const isPlay = gate.call === 'PLAY';

  const trafficBorder = isPlay
    ? 'border-emerald-500/80 bg-emerald-950/20 shadow-sm shadow-emerald-950/40'
    : 'border-[#222d3e] bg-[#0f1520] hover:border-slate-600';

  const badgeStyle = isPlay
    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500 font-bold shadow-sm shadow-emerald-900/50'
    : 'bg-slate-800 text-slate-400 border border-slate-700 font-medium';

  return (
    <article className={`p-3.5 rounded-xl border ${trafficBorder} flex flex-col justify-between space-y-3 transition`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <button
            onClick={onOpenSheet}
            className="text-left font-bold text-white hover:text-amber-400 transition flex items-center gap-1.5 text-sm sm:text-base font-sans cursor-pointer"
          >
            {batter.name}
          </button>
          <p className="text-[11px] text-[#8b97ac] font-mono">
            {batter.team} &middot; Slot {batter.slot} &middot; {batter.hand ? `${batter.hand}HB` : 'hand ?'} vs {batter.oppSp}
            {gate.quality === 'EST' && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded border bg-amber-950/80 text-amber-300 border-amber-600 font-semibold" title="Live stats missing — cannot be PLAY">EST. INPUTS</span>
            )}
          </p>
        </div>
        <span className={`text-[11px] font-mono px-2.5 py-0.5 rounded ${badgeStyle}`}>
          {gate.call}
        </span>
      </div>

      {/* Sportsbook Line & Odds Inputs + Real-time Calculation */}
      <div className="flex flex-wrap items-end justify-between gap-2 pt-1 border-t border-[#222d3e]/60">
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <label className="text-[10px] text-[#8b97ac] flex flex-col">
            Line (Hits)
            <input
              type="number"
              step="1"
              min="0.5"
              max="4.5"
              value={lineInput}
              onChange={e => {
                setLineInput(e.target.value);
                const parsed = parseFloat(e.target.value);
                if (!isNaN(parsed) && onLineChange) {
                  onLineChange(parsed);
                }
              }}
              className="w-16 bg-[#0b0f14] border border-[#222d3e] rounded px-1.5 py-1 text-xs font-mono text-center text-white font-bold outline-none focus:border-amber-400 mt-0.5"
              title="Sportsbook Hit Line (e.g. 0.5, 1.5)"
            />
          </label>

          <label className="text-[10px] text-[#8b97ac] flex flex-col">
            Over Odds
            <input
              type="text"
              value={price.over || ''}
              placeholder="-165"
              onChange={e => onOddsChange('over', e.target.value)}
              className="w-16 bg-[#0b0f14] border border-[#222d3e] rounded px-1.5 py-1 text-xs font-mono text-center text-white outline-none focus:border-amber-400 mt-0.5"
              title="Sportsbook Over Odds"
            />
          </label>

          <label className="text-[10px] text-[#8b97ac] flex flex-col">
            Under (opt)
            <input
              type="text"
              value={price.under || ''}
              placeholder="+135"
              onChange={e => onOddsChange('under', e.target.value)}
              className="w-16 bg-[#0b0f14] border border-[#222d3e] rounded px-1.5 py-1 text-xs font-mono text-center text-white outline-none focus:border-amber-400 mt-0.5"
              title="Sportsbook Under Odds"
            />
          </label>
        </div>

        <div className="text-right font-mono">
          <p className="text-base font-bold text-white">{(gate.calP * 100).toFixed(1)}%</p>
          <p className={`text-[11px] font-semibold ${gate.edge >= 1.5 ? 'text-emerald-400' : gate.edge < 0 ? 'text-rose-400' : 'text-[#8b97ac]'}`}>
            {price.over ? `${gate.edge >= 0 ? '+' : ''}${gate.edge.toFixed(1)} pts` : 'no price'}
          </p>
          {price.over && gate.ev !== null && gate.ev !== undefined && (
            <p className={`text-[10px] ${gate.ev > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              EV {gate.ev >= 0 ? '+' : ''}{(gate.ev * 100).toFixed(1)}%
            </p>
          )}
        </div>
      </div>

      {/* Plain English Why summary */}
      <p className="text-[11px] text-[#8b97ac] truncate italic">
        {gate.why[0] || (isPlay ? 'All gate criteria satisfied.' : 'Awaiting line or odds.')}
      </p>

      <div className="flex items-center justify-between pt-1 border-t border-[#222d3e]/40">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleParlay}
            className={`text-xs font-semibold font-mono transition cursor-pointer ${
              inParlay ? 'text-amber-400 font-bold' : 'text-[#8b97ac] hover:text-white'
            }`}
          >
            {inParlay ? '✓ In Parlay' : '+ Add to Parlay'}
          </button>
          {onLogBet && (
            <button
              type="button"
              onClick={() => {
                const parsedOdds = price.over ? parseInt(price.over.replace('+', ''), 10) : -150;
                onLogBet({
                  sport: 'mlb',
                  player: batter.name,
                  team: batter.team,
                  opp: batter.oppSp || '',
                  market: 'hits',
                  side: 'OVER',
                  line: currentLine,
                  odds: !isNaN(parsedOdds) ? parsedOdds : -150
                });
              }}
              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#182232] hover:bg-emerald-950 text-emerald-400 hover:text-emerald-300 border border-[#222d3e] hover:border-emerald-600 transition cursor-pointer"
              title="Log this bet to personal tracker"
            >
              + Bet
            </button>
          )}
        </div>
        <span className="text-[10px] text-[#556277] font-mono">
          {gate.stake} stake
        </span>
      </div>
    </article>
  );
};
