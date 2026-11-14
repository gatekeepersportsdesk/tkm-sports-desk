import React, { useState } from 'react';
import { NbaMarket, NbaOddsEntry, NbaPlayerProjection, NbaSettings, NBA_MARKET_UNIT } from '../../types/nba';
import { evalNbaRow } from '../../lib/nba_board';
import { parseAmericanOdds } from '../../model/nhl_engine';
import { NbaPlayerDrawer } from './NbaPlayerDrawer';
import { ChevronDown, ChevronUp, Crown } from 'lucide-react';
import { MarketVarianceInfo, getNbaMarketVariance } from '../../lib/market_variance';
import { MarketVarianceBadge } from '../common/MarketVarianceBadge';
import { computePlayerCardForm, getEdgeColorClass } from '../../lib/player_card_form';
import { PlayerFormRow } from '../common/PlayerFormRow';

interface Props {
  projection: NbaPlayerProjection;
  gamePlayers: NbaPlayerProjection[];
  market: NbaMarket;
  entryFor: (market: NbaMarket, playerId: number, line: number) => NbaOddsEntry | undefined;
  settings: NbaSettings;
  selectedLine?: number;
  isPotd?: boolean;
  onOddsChange: (market: NbaMarket, playerId: number, line: number, side: 'over' | 'under', val: number | null) => void;
  onSelectLine: (market: NbaMarket, playerId: number, line: number) => void;
  variance?: MarketVarianceInfo;
  onLogBet?: (draft: { sport: 'nba'; player: string; team?: string; opp?: string; market: string; side: 'OVER' | 'UNDER'; line: number; odds: number }) => void;
}

const fmt = (n: number | null | undefined) => (n == null ? '' : n > 0 ? `+${n}` : `${n}`);
const UNIT = NBA_MARKET_UNIT;

const marketKeyMap: Record<NbaMarket, NbaMarket> = {
  pts: 'pts',
  reb: 'reb',
  ast: 'ast',
  tpm: 'tpm',
  pra: 'pra',
  stl: 'stl',
  blk: 'blk'
};

const NbaPlayerRowComponent: React.FC<Props> = ({
  projection, gamePlayers, market, entryFor, settings, selectedLine, isPotd, onOddsChange, onSelectLine, variance: customVariance, onLogBet
}) => {
  const [expanded, setExpanded] = useState(false);
  const mp = projection.markets[market];
  const line = selectedLine ?? mp.defaultLine;
  const entry = entryFor(market, projection.playerId, line);
  const ev = evalNbaRow(projection, market, line, entry, settings);
  const d = ev.decision;
  const qualifies = d.tag !== 'PASS';
  const variance = customVariance ?? getNbaMarketVariance(projection, market, line, entry);

  const badge =
    d.tag === 'STAB' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500 font-bold'
    : d.tag === 'FADE' ? 'bg-orange-950 text-orange-300 border border-orange-500 font-bold'
    : 'bg-slate-800 text-slate-400 border border-slate-700 font-medium';

  const flags: string[] = [];
  if (projection.inputsSource !== 'REAL') flags.push('EST');
  if (projection.availability === 'UNKNOWN') flags.push('AVAIL?');
  else if (projection.availability !== 'ACTIVE') flags.push(projection.availability);
  if (projection.lostRotation > 0) flags.push('TM OUT');
  if (projection.group === 'new') flags.push(projection.gp < 20 && projection.priorGp === 0 ? 'ROOKIE/NEW' : 'LITTLE HISTORY');
  if (projection.group === 'changer') flags.push('NEW TEAM');

  const statKey = marketKeyMap[market];
  const recentStatLogs = (projection.recentLogs && projection.recentLogs.length > 0)
    ? projection.recentLogs.map(l => l.counts[statKey]).reverse()
    : [];

  const seasonMinAvg = projection.pm;
  const cardForm = computePlayerCardForm(
    recentStatLogs,
    line,
    d.tag === 'FADE' ? 'UNDER' : 'OVER',
    {
      oppFactor: mp.oppFactor,
      edge: d.edge,
      seasonMinAvg,
      recentMinutes: projection.recentMinutes,
      marketLabel: UNIT[market]
    }
  );

  return (
    <div className={`border rounded-xl transition overflow-hidden mb-2 ${
      isPotd
        ? 'border-amber-400/90 bg-amber-950/15 shadow-sm shadow-amber-950/40'
        : qualifies
          ? 'border-emerald-500/70 bg-[#0c161d]'
          : 'border-[#222d3e] bg-[#0f1520] hover:border-slate-600'
    }`}>
      <div onClick={() => setExpanded(!expanded)} className="p-3 cursor-pointer select-none">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-[230px] flex-wrap">
            {isPotd && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-400 text-slate-950" title="Pick of the Day">
                <Crown className="w-3 h-3 fill-current" /> POTD
              </span>
            )}
            <span className="font-bold text-white text-sm">{projection.name}</span>
            <span className="font-mono text-[10px] bg-[#182232] text-cyan-400 px-1.5 py-0.5 rounded border border-[#222d3e]">{projection.pos}</span>
            <span className="text-xs font-mono text-[#8b97ac]">{projection.team} {projection.home ? 'vs' : '@'} {projection.opp}</span>
            <MarketVarianceBadge info={variance} />
            {mp.priorWeight !== undefined && mp.priorWeight > 0 && (
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-700 font-semibold"
                title={`Rate Prior (${mp.priorSource || 'historical'}): ${mp.priorPerGame?.toFixed(1)} ${UNIT[market]}/g (${mp.priorGp} GP, weight ${Math.round(mp.priorWeight * 100)}%)`}
              >
                PRIOR {Math.round(mp.priorWeight * 100)}%
              </span>
            )}
            {flags.map(f => (
              <span key={f} className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700">{f}</span>
            ))}
          </div>

          <div className="flex items-center gap-3 text-xs font-mono" onClick={e => e.stopPropagation()}>
            <div>
              <span className="text-[#8b97ac] text-[10px] block">Model &mu; · min</span>
              <span className="text-cyan-400 font-bold">{mp.mu.toFixed(1)} {UNIT[market]}</span>
              <span className="text-[#556277]"> · {mp.pm.toFixed(0)}</span>
            </div>
            <label className="text-[10px] text-[#8b97ac] flex flex-col">
              Line
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={line}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val > 0) onSelectLine(market, projection.playerId, val);
                  }}
                  className="w-14 bg-[#0b0f14] border border-[#222d3e] rounded px-1.5 py-1 text-xs font-mono font-bold text-white text-center outline-none focus:border-cyan-400"
                  title="Type custom line"
                />
                <select
                  value={line}
                  onChange={e => onSelectLine(market, projection.playerId, parseFloat(e.target.value))}
                  className="bg-[#0b0f14] border border-[#222d3e] rounded px-1 py-1 text-[11px] font-mono text-[#8b97ac] outline-none focus:border-cyan-400 cursor-pointer"
                  title="Pick preset line"
                >
                  {Array.from(new Set([...mp.lines, line])).sort((a,b)=>a-b).map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </label>
            <div>
              <span className="text-[#8b97ac] text-[10px] block">P(O {line}) / P(U)</span>
              <span className="text-white font-bold">{(ev.pOver * 100).toFixed(1)}% / {(ev.pUnder * 100).toFixed(1)}%</span>
            </div>
          </div>

          <div className="flex items-center gap-3 justify-between lg:justify-end" onClick={e => e.stopPropagation()}>
            {(['over', 'under'] as const).map(side => (
              <label key={side} className="flex items-center gap-1 font-mono text-[10px] text-[#8b97ac]">
                {side === 'over' ? 'O' : 'U'}
                <input type="text" placeholder={side === 'over' ? '-115' : '-105'}
                  defaultValue={fmt(side === 'over' ? entry?.over : entry?.under)}
                  key={`${projection.playerId}-${line}-${side}-${fmt(side === 'over' ? entry?.over : entry?.under)}`}
                  onBlur={e => onOddsChange(market, projection.playerId, line, side, parseAmericanOdds(e.target.value))}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-16 bg-[#0b0f14] border border-[#222d3e] rounded px-2 py-1 text-xs font-mono text-center text-white outline-none focus:border-cyan-400" />
              </label>
            ))}
            <div className="text-right font-mono text-xs min-w-[70px]">
              <span className="text-[10px] text-[#8b97ac] block">Edge / EV</span>
              <span className={`block ${getEdgeColorClass(d.edge, d.hasMarket)}`}>
                {d.hasMarket ? `${d.edge >= 0 ? '+' : ''}${d.edge.toFixed(1)}pp` : 'no price'}
              </span>
              {d.ev !== null && <span className="block text-[10px] text-[#8b97ac]">EV {(d.ev * 100).toFixed(1)}%</span>}
            </div>
            <span className={`text-[11px] font-mono px-2.5 py-0.5 rounded ${badge}`}>{d.tag}</span>
            {onLogBet && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  const s = d.tag === 'FADE' ? 'UNDER' : 'OVER';
                  const oddsVal = (s === 'UNDER' ? entry?.under : entry?.over) || -110;
                  onLogBet({
                    sport: 'nba',
                    player: projection.name,
                    team: projection.team,
                    opp: projection.opp,
                    market,
                    side: s,
                    line,
                    odds: oddsVal
                  });
                }}
                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#182232] hover:bg-emerald-950 text-emerald-400 hover:text-emerald-300 border border-[#222d3e] hover:border-emerald-600 transition cursor-pointer"
                title="Log this bet to personal tracker"
              >
                + Bet
              </button>
            )}
            <button onClick={() => setExpanded(!expanded)} className="text-[#8b97ac] hover:text-white cursor-pointer ml-1">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Compact L5 / L10 Form & Context Row */}
        <PlayerFormRow form={cardForm} unit={UNIT[market]} />
      </div>
      {expanded && <NbaPlayerDrawer projection={projection} market={market} line={line} evalRow={ev} gamePlayers={gamePlayers} variance={variance} />}
    </div>
  );
};

export const NbaPlayerRow = React.memo(NbaPlayerRowComponent);

