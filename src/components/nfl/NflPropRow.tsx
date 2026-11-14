import React, { useState } from 'react';
import { NflPropSnapshot } from '../../types/nfl';
import { NflPlayerDrawer } from './NflPlayerDrawer';
import { ChevronDown, ChevronUp, Crown } from 'lucide-react';
import { MarketVarianceInfo, getNflMarketVariance } from '../../lib/market_variance';
import { MarketVarianceBadge } from '../common/MarketVarianceBadge';
import { useDisplaySettings } from '../common/DisplaySettingsContext';
import { computePlayerCardForm, getEdgeColorClass } from '../../lib/player_card_form';
import { PlayerFormRow } from '../common/PlayerFormRow';

interface NflPropRowProps {
  snapshot: NflPropSnapshot;
  isBetPlaced: boolean;
  isPotd?: boolean;
  onRecordBet: (snap: NflPropSnapshot) => void;
  onUpdateLine?: (player: string, line: number, overOdds: string, underOdds: string) => void;
  teammates?: NflPropSnapshot[];
  variance?: MarketVarianceInfo;
  onLogBet?: (draft: { sport: 'nfl'; player: string; team?: string; opp?: string; market: string; side: 'OVER' | 'UNDER'; line: number; odds: number }) => void;
}

export const NflPropRow: React.FC<NflPropRowProps> = ({
  snapshot,
  isBetPlaced,
  isPotd,
  onRecordBet,
  onUpdateLine,
  teammates,
  variance: customVariance,
  onLogBet
}) => {
  const { formatStake } = useDisplaySettings();
  const [expanded, setExpanded] = useState(false);
  const [lineInput, setLineInput] = useState<string>(String(snapshot.line));
  const [overOddsInput, setOverOddsInput] = useState<string>(snapshot.overOdds || '');
  const [underOddsInput, setUnderOddsInput] = useState<string>(snapshot.underOdds || '');
  const variance = customVariance ?? getNflMarketVariance(snapshot);

  // Sync internal inputs when prop updates
  React.useEffect(() => {
    setLineInput(String(snapshot.line));
    setOverOddsInput(snapshot.overOdds);
    setUnderOddsInput(snapshot.underOdds);
  }, [snapshot.line, snapshot.overOdds, snapshot.underOdds]);

  const handleLineCommit = (newLineStr: string, newOver: string, newUnder: string) => {
    const parsedLine = parseFloat(newLineStr);
    if (!isNaN(parsedLine) && parsedLine >= 0 && onUpdateLine) {
      onUpdateLine(snapshot.player, parsedLine, newOver, newUnder);
    }
  };

  const edgePts = (snapshot.edge * 100).toFixed(1);
  const isPlay = snapshot.cardStatus === 'BET';

  const statusBadge = isPlay ? (
    <span className="text-[11px] font-mono px-2.5 py-0.5 rounded font-bold bg-emerald-950 text-emerald-300 border border-emerald-500 shadow-sm shadow-emerald-900/50">
      PLAY
    </span>
  ) : snapshot.hasMarket === false ? (
    <span className="text-[11px] font-mono px-2 py-0.5 rounded font-medium bg-slate-900 text-slate-500 border border-slate-700" title="Enter the book's line and both odds to price this prop">
      NO ODDS
    </span>
  ) : (
    <span className="text-[11px] font-mono px-2 py-0.5 rounded font-medium bg-slate-800 text-slate-400 border border-slate-700">
      PASS
    </span>
  );

  const leanBadgeStyles = {
    OVER: 'bg-emerald-950 text-emerald-400 border border-emerald-800',
    UNDER: 'bg-orange-950 text-orange-400 border border-orange-800'
  };

  return (
    <div className={`border rounded-xl transition overflow-hidden mb-2.5 ${
      isPotd
        ? 'border-amber-400/90 bg-amber-950/15 shadow-sm shadow-amber-950/40'
        : isPlay
          ? 'border-emerald-500/60 bg-[#0c161d] shadow-sm shadow-emerald-950/40'
          : 'border-[#222d3e] bg-[#0f1520] hover:border-slate-600'
    }`}>
      <div
        onClick={() => setExpanded(!expanded)}
        className="p-3 sm:p-3.5 cursor-pointer flex flex-col gap-2.5 select-none"
      >
        {/* Line 1: Player info + Status Badges */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 overflow-hidden">
            {isPotd && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-400 text-slate-950 shrink-0" title="Pick of the Day">
                <Crown className="w-3 h-3 fill-current" /> POTD
              </span>
            )}
            <span className="font-bold text-white text-sm sm:text-base truncate">
              {snapshot.player}
            </span>
            <span className="font-mono text-[11px] bg-[#182232] text-sky-400 px-1.5 py-0.5 rounded border border-[#222d3e]">
              {snapshot.pos}
            </span>
            <span className="text-xs text-[#8b97ac] font-mono">
              {snapshot.team}
            </span>
            <MarketVarianceBadge info={variance} />
            {snapshot.availability && snapshot.availability !== 'ACTIVE' && snapshot.availability !== 'UNKNOWN' && (
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                snapshot.availability === 'IR' || snapshot.availability === 'OUT' || snapshot.availability === 'INACTIVE'
                  ? 'bg-rose-950 text-rose-300 border-rose-600 animate-pulse'
                  : 'bg-amber-950 text-amber-300 border-amber-600'
              }`}>
                {snapshot.availability}
              </span>
            )}
            {snapshot.availability === 'UNKNOWN' && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-slate-900 text-slate-400 border-slate-600" title="No injury report loaded — confirm status before betting">
                AVAIL ?
              </span>
            )}
            {snapshot.priorWeight !== undefined && snapshot.priorWeight > 0 && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-purple-950/80 text-purple-300 border-purple-700 font-semibold"
                title={`Rate Prior (${snapshot.priorSource || 'historical'}): ${snapshot.priorAvg?.toFixed(1)} avg rec (${snapshot.priorGames} games, weight ${Math.round(snapshot.priorWeight * 100)}%)`}
              >
                PRIOR {Math.round(snapshot.priorWeight * 100)}%
              </span>
            )}
            {snapshot.inputsSource === 'ESTIMATED' && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-amber-950/80 text-amber-300 border-amber-600 font-semibold" title="Estimated input stats — cannot be BET/PLAY">
                EST. INPUTS
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isBetPlaced && (
              <span className="text-[10px] font-mono font-bold bg-sky-900 text-sky-200 px-2 py-0.5 rounded border border-sky-600">
                PLACED {formatStake(1.0)}
              </span>
            )}
            {statusBadge}
            {onLogBet && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  const side = snapshot.lean;
                  const oddsRaw = side === 'OVER' ? snapshot.overOdds : snapshot.underOdds;
                  const parsedOdds = oddsRaw ? parseInt(oddsRaw.replace('+', ''), 10) : -110;
                  onLogBet({
                    sport: 'nfl',
                    player: snapshot.player,
                    team: snapshot.team,
                    opp: snapshot.gameKey || '',
                    market: 'receptions',
                    side,
                    line: snapshot.line,
                    odds: !isNaN(parsedOdds) ? parsedOdds : -110
                  });
                }}
                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#182232] hover:bg-emerald-950 text-emerald-400 hover:text-emerald-300 border border-[#222d3e] hover:border-emerald-600 transition cursor-pointer"
                title="Log this bet to personal tracker"
              >
                + Bet
              </button>
            )}
            <button className="text-[#8b97ac] hover:text-white transition">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Gate Reason Note */}
        {snapshot.cardReason && (snapshot.availability !== 'ACTIVE' || snapshot.inputsSource === 'ESTIMATED' || snapshot.cardStatus === 'PASS') && (
          <div className="text-[11px] font-mono text-[#8b97ac] italic truncate">
            Gate: <span className={snapshot.availability === 'IR' || snapshot.availability === 'OUT' ? 'text-rose-400 font-semibold' : 'text-slate-300'}>{snapshot.cardReason}</span>
          </div>
        )}

        {/* Line 2: Interactive editable line & odds from sportsbook */}
        <div
          className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-[#222d3e]/60"
          onClick={e => e.stopPropagation()}
        >
          {/* Sportsbook line & odds editors */}
          <div className="flex items-center gap-2 font-mono text-xs">
            <label className="text-[10px] text-[#8b97ac] flex flex-col">
              Line
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="15.5"
                value={lineInput}
                onChange={e => {
                  setLineInput(e.target.value);
                  handleLineCommit(e.target.value, overOddsInput, underOddsInput);
                }}
                className="w-16 bg-[#0b0f14] border border-[#222d3e] rounded px-1.5 py-1 text-xs font-mono text-center text-white font-bold outline-none focus:border-sky-400 mt-0.5"
                title="Edit sportsbook line (e.g. 2.5, 3.5, 4.5)"
              />
            </label>

            <label className="text-[10px] text-[#8b97ac] flex flex-col">
              Over Odds
              <input
                type="text"
                value={overOddsInput}
                placeholder="-115"
                onChange={e => {
                  setOverOddsInput(e.target.value);
                  handleLineCommit(lineInput, e.target.value, underOddsInput);
                }}
                className="w-16 bg-[#0b0f14] border border-[#222d3e] rounded px-1.5 py-1 text-xs font-mono text-center text-white outline-none focus:border-sky-400 mt-0.5"
                title="Sportsbook Over Odds (e.g. -115)"
              />
            </label>

            <label className="text-[10px] text-[#8b97ac] flex flex-col">
              Under Odds
              <input
                type="text"
                value={underOddsInput}
                placeholder="-115"
                onChange={e => {
                  setUnderOddsInput(e.target.value);
                  handleLineCommit(lineInput, overOddsInput, e.target.value);
                }}
                className="w-16 bg-[#0b0f14] border border-[#222d3e] rounded px-1.5 py-1 text-xs font-mono text-center text-white outline-none focus:border-sky-400 mt-0.5"
                title="Sportsbook Under Odds (e.g. -115)"
              />
            </label>
          </div>

          {/* Model calculation results */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${leanBadgeStyles[snapshot.lean]}`}>
              {snapshot.lean} {snapshot.line.toFixed(1)} rec (
              <span className={getEdgeColorClass(snapshot.edge * 100, snapshot.hasMarket !== false)}>
                {snapshot.edge >= 0 ? '+' : ''}{edgePts} pts
              </span>
              )
            </span>
          </div>
        </div>

        {/* Line 3: Model mu, Season avg, Model win % vs Market fair % */}
        <div className="flex flex-wrap items-center justify-between text-xs text-[#8b97ac] font-mono pt-1.5 border-t border-[#222d3e]/70 gap-y-1">
          <div>
            Model &mu;: <span className="text-sky-400 font-bold">{snapshot.mu.toFixed(2)}</span> &middot; Szn avg: <span className="text-white font-medium">{snapshot.seasonAvg.toFixed(2)}</span>
          </div>
          <div>
            Model Win: <span className="text-emerald-400 font-semibold">{((snapshot.lean === 'OVER' ? snapshot.p_over : snapshot.p_under) * 100).toFixed(1)}%</span> vs Fair Mkt: <span className="text-white font-medium">{((snapshot.lean === 'OVER' ? snapshot.fair_over : snapshot.fair_under) * 100).toFixed(1)}%</span>
          </div>
        </div>

        {/* Compact L5 / L10 Form & Context Row (real logs only, never synthetic) */}
        <PlayerFormRow
          form={computePlayerCardForm(
            Array.isArray((snapshot as any).recentReceptions) ? (snapshot as any).recentReceptions : [],
            snapshot.line,
            snapshot.lean,
            {
              edge: snapshot.edge * 100,
              marketLabel: 'rec'
            }
          )}
          unit="rec"
        />
      </div>

      {expanded && (
        <NflPlayerDrawer
          snapshot={snapshot}
          isBetPlaced={isBetPlaced}
          onRecordBet={onRecordBet}
          teammates={teammates}
          variance={variance}
        />
      )}
    </div>
  );
};
