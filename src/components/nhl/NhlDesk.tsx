import React, { useState, useEffect, useMemo } from 'react';
import { NhlSkaterProjection, NhlGameMatchup, NhlMarket, NhlOddsMap, NhlSettings, nhlOddsKey } from '../../types/nhl';
import { NhlPlayerRow } from './NhlPlayerRow';
import { Calendar, Zap, Search, X } from 'lucide-react';
import { evalNhlRow, marketOf } from '../../lib/nhl_board';
import { BettableConfig, bestLine } from '../../lib/bettable';
import { rankDeskRows, DeskSortOption, DESK_SORT_LABELS, formSampleFromLogs } from '../../lib/desk_rank';
import { getNhlMarketVariance, MarketVarianceInfo } from '../../lib/market_variance';
import { getNhlPickOfTheDay } from '../../lib/pick_of_the_day';
import { PickOfTheDayCard } from '../common/PickOfTheDayCard';
import { TodaysPlaysSection, DeskPlayItem } from '../common/TodaysPlaysSection';
import { CardRow } from '../../lib/card_core';
import { calculateEdgePp, calculateEv } from '../../lib/odds';
import { computePlayerCardForm, isFormFightingLean } from '../../lib/player_card_form';
import { isMatchingPotd } from '../../lib/picker_grading';

interface NhlDeskProps {
  date: string;
  setDate: (d: string) => void;
  games: NhlGameMatchup[];
  projections: NhlSkaterProjection[];
  market: NhlMarket;
  setMarket: (m: NhlMarket) => void;
  oddsMap: NhlOddsMap;
  settings: NhlSettings;
  setShowStabsOnly: (v: boolean) => void;
  onOddsChange: (market: NhlMarket, playerId: number, line: number, side: 'over' | 'under', val: number | null) => void;
  onLogRows: () => void;
  onSnapshotAllPredictions?: () => void;
  onOpenScreenshotUpload: () => void;
  statusLines: string[];
  bet: BettableConfig;
  oddsPanel?: React.ReactNode;
  onLogBet?: (draft: { sport: 'nhl'; player: string; team?: string; opp?: string; market: string; side: 'OVER' | 'UNDER'; line: number; odds: number }) => void;
  cardRows?: CardRow[];
  onAddToTicket?: (play: DeskPlayItem) => void;
  onTriggerGrade?: () => Promise<void> | void;
}

export const NhlDesk: React.FC<NhlDeskProps> = ({
  date, setDate, games, projections, market, setMarket, oddsMap, settings,
  setShowStabsOnly, onOddsChange, onLogRows, onSnapshotAllPredictions, onOpenScreenshotUpload, statusLines,
  bet, oddsPanel, onLogBet, cardRows, onAddToTicket, onTriggerGrade
}) => {
  const [selectedGameId, setSelectedGameId] = useState<number | 'ALL'>('ALL');
  const [lines, setLines] = useState<Record<string, number>>({});
  const [fullModel, setFullModel] = useState(!bet.bettableOnly);
  const [pricedOnly, setPricedOnly] = useState(false);
  const [highVarianceOnly, setHighVarianceOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<DeskSortOption>('edge');
  const [deprioritizeWeakForm, setDeprioritizeWeakForm] = useState<boolean>(false);

  useEffect(() => { setFullModel(!bet.bettableOnly); }, [bet.bettableOnly]);

  const onBoard = projections.filter(p => marketOf(p, market) !== null);

  // every priced skater per team-game, so a row's drawer can run the game simulation
  const teamIndex = useMemo(() => {
    const m = new Map<string, NhlSkaterProjection[]>();
    projections.forEach(p => { const k = `${p.gameId ?? ''}|${p.team}`; (m.get(k) || m.set(k, []).get(k)!).push(p); });
    return m;
  }, [projections]);

  const entryFor = (m: NhlMarket, id: number, line: number) => oddsMap[nhlOddsKey(m, id, line)];

  const ranked = useMemo(() => rankDeskRows(onBoard, {
    sport: 'nhl', market, cfg: bet, sortBy, deprioritizeWeakForm,
    linesOf: p => marketOf(p, market)!.lines, defaultLine: p => marketOf(p, market)!.defaultLine, picked: p => lines[`${market}:${p.playerId}`],
    entryAt: (p, l) => entryFor(market, p.playerId, l),
    evalAt: (p, l) => {
      const r = evalNhlRow(p, market, l, entryFor(market, p.playerId, l), settings);
      if (!r) return null;
      const d = r.decision;
      return { hasMarket: d.hasMarket, evOver: d.evOver, evUnder: d.evUnder, edgeOver: d.edgeOver, edgeUnder: d.edgeUnder, pOver: r.pOver, pUnder: r.pUnder };
    },
    mu: p => marketOf(p, market)!.mu, pm: () => null, inputs: p => p.inputsSource, availability: p => p.availability,
    formOf: (p, l, side) => formSampleFromLogs(market === 'sog' ? p.recentShots : p.recentPoints, l, side)
  }), [onBoard, projections, market, bet, lines, oddsMap, settings, sortBy, deprioritizeWeakForm]);

  const lineFor = (p: NhlSkaterProjection) => ranked.find(r => r.p === p)?.line ?? marketOf(p, market)!.defaultLine;
  const tagOf = (p: NhlSkaterProjection) => evalNhlRow(p, market, lineFor(p), entryFor(market, p.playerId, lineFor(p)), settings)?.decision.tag ?? 'PASS';
  const plays = onBoard.filter(p => tagOf(p) !== 'PASS').length;

  const varianceMap = useMemo(() => {
    const map = new Map<number, MarketVarianceInfo>();
    onBoard.forEach(p => {
      const l = lineFor(p);
      const entry = entryFor(market, p.playerId, l);
      map.set(p.playerId, getNhlMarketVariance(p, market, l, entry));
    });
    return map;
  }, [onBoard, market, lines, oddsMap, ranked]);

  const highVarianceCount = useMemo(() => {
    return Array.from(varianceMap.values()).filter(v => v.isHighVariance).length;
  }, [varianceMap]);

  // Pick of the Day: Highest EV bettable play across NHL markets ('sog', 'pts') (stable per date)
  const pickOfTheDay = useMemo(() => {
    return getNhlPickOfTheDay(projections, oddsMap, settings, bet, date);
  }, [projections, oddsMap, settings, bet, date]);

  // Multi-Market Today's Plays: Shots on Goal ('sog') AND Points ('pts')
  const todaysPlays: DeskPlayItem[] = useMemo(() => {
    const list: DeskPlayItem[] = [];
    const seen = new Set<string>();
    const nhlMarkets: NhlMarket[] = ['sog', 'pts'];

    for (const m of nhlMarkets) {
      for (const p of projections) {
        const mp = marketOf(p, m);
        if (!mp) continue;

        const pricedLines = mp.lines.filter(l => {
          const e = entryFor(m, p.playerId, l);
          return !!e && (e.over != null || e.under != null);
        });
        if (pricedLines.length === 0) continue;

        const evalFn = (l: number) => {
          const r = evalNhlRow(p, m, l, entryFor(m, p.playerId, l), settings);
          if (!r) return null;
          const d = r.decision;
          return { hasMarket: d.hasMarket, evOver: d.evOver, evUnder: d.evUnder, edgeOver: d.edgeOver, edgeUnder: d.edgeUnder, pOver: r.pOver, pUnder: r.pUnder };
        };
        const best = bestLine(pricedLines, evalFn);
        const pickedLine = lines[`${m}:${p.playerId}`];
        const line = pickedLine ?? best?.line ?? pricedLines[0];
        const entry = entryFor(m, p.playerId, line);
        const ev = evalNhlRow(p, m, line, entry, settings);
        if (!ev) continue;
        const d = ev.decision;
        const side: 'OVER' | 'UNDER' = d.tag === 'FADE' ? 'UNDER' : 'OVER';
        const postedOdds = side === 'UNDER' ? entry?.under : entry?.over;
        if (postedOdds == null) continue;
        const prob = side === 'UNDER' ? ev.pUnder : ev.pOver;
        const edgePp = calculateEdgePp(prob, postedOdds);
        const evVal = calculateEv(prob, postedOdds);
        if (edgePp === null) continue;

        const playId = `${p.playerId}:${m}:${line}`;
        if (seen.has(playId)) continue;
        seen.add(playId);

        const unit = m === 'sog' ? 'SOG' : 'pts';
        const rawLogs = m === 'sog' ? p.recentShots : p.recentPoints;
        const cardForm = computePlayerCardForm(
          rawLogs || [],
          line,
          side,
          {
            oppFactor: mp.oppFactor,
            edge: edgePp,
            marketLabel: unit
          }
        );
        const formWarning = isFormFightingLean(cardForm, side, line);
        const itemMarket = m === 'sog' ? 'shots' : 'points';

        list.push({
          id: playId,
          player: p.name,
          team: p.team,
          opp: p.opp || '',
          market: itemMarket,
          marketLabel: m === 'sog' ? 'Shots on Goal' : 'Points',
          side,
          line,
          odds: postedOdds,
          prob,
          edge: edgePp,
          ev: evVal,
          hasOdds: true,
          modelMu: mp.mu,
          unit,
          form: cardForm,
          formWarning,
          isPotd: isMatchingPotd({ player: p.name, market: itemMarket, side, line }, pickOfTheDay)
        });
      }
    }
    return list;
  }, [projections, lines, oddsMap, settings, pickOfTheDay]);

  const visibleRows = ranked.filter(r => {
    if (selectedGameId !== 'ALL' && r.p.gameId !== selectedGameId) return false;
    if (settings.showStabsOnly && tagOf(r.p) === 'PASS') return false;
    if (!fullModel && r.issue) return false;
    if (pricedOnly && !r.priced) return false;
    if (highVarianceOnly && !varianceMap.get(r.p.playerId)?.isHighVariance) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchName = r.p.name.toLowerCase().includes(q);
      const matchTeam = r.p.team.toLowerCase().includes(q);
      const matchOpp = (r.p.opp || '').toLowerCase().includes(q);
      if (!matchName && !matchTeam && !matchOpp) return false;
    }
    return true;
  });

  const visible = visibleRows.map(r => r.p);
  const hidden = ranked.filter(r => (selectedGameId === 'ALL' || r.p.gameId === selectedGameId) && r.issue).length;
  const priced = Object.values(oddsMap).filter(e => e.over != null || e.under != null).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#121824] p-3.5 rounded-2xl border border-[#222d3e]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-[#8b97ac] font-mono">
            <Calendar className="w-4 h-4 text-cyan-400" />
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="bg-[#0b0f14] border border-[#222d3e] px-2.5 py-1 rounded-lg text-white font-mono text-xs outline-none focus:border-cyan-400" />
          </div>

          <div className="flex items-center gap-1 bg-[#0f1520] p-1 rounded-xl border border-[#222d3e]">
            {(['sog', 'pts'] as NhlMarket[]).map(m => (
              <button key={m} onClick={() => setMarket(m)}
                className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg transition cursor-pointer ${market === m ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'}`}>
                {m === 'sog' ? 'Shots on Goal' : 'Points'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button onClick={() => setSelectedGameId('ALL')}
              className={`px-3 py-1 rounded-full text-xs font-mono cursor-pointer ${selectedGameId === 'ALL' ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#0f1520] text-[#8b97ac] border border-[#222d3e] hover:text-white'}`}>
              All ({onBoard.length})
            </button>
            {games.map(g => (
              <button key={g.gameId} onClick={() => setSelectedGameId(g.gameId)}
                className={`px-3 py-1 rounded-full text-xs font-mono whitespace-nowrap cursor-pointer ${selectedGameId === g.gameId ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#0f1520] text-[#8b97ac] border border-[#222d3e] hover:text-white'}`}>
                {g.awayTeam} @ {g.homeTeam}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs font-mono text-[#8b97ac] cursor-pointer" title="Bettable = REAL inputs, known availability, real usage, sane juice. Off shows every modelled row.">
            <input type="checkbox" checked={fullModel} onChange={e => setFullModel(e.target.checked)} className="accent-cyan-400" />
            Full model{fullModel ? '' : ` (${hidden} hidden)`}
          </label>
          <label className="flex items-center gap-1.5 text-xs font-mono text-[#8b97ac] cursor-pointer">
            <input type="checkbox" checked={pricedOnly} onChange={e => setPricedOnly(e.target.checked)} className="accent-cyan-400" />
            Priced only
          </label>
          <label className="flex items-center gap-1.5 text-xs font-mono text-[#8b97ac] cursor-pointer">
            <input type="checkbox" checked={settings.showStabsOnly} onChange={e => setShowStabsOnly(e.target.checked)} className="accent-cyan-400" />
            Qualifying only ({plays})
          </label>
          <button
            onClick={() => setHighVarianceOnly(!highVarianceOnly)}
            className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-xl border flex items-center gap-1.5 transition cursor-pointer ${
              highVarianceOnly
                ? 'bg-amber-950 text-amber-300 border-amber-500 font-bold shadow-sm shadow-amber-950/50'
                : 'bg-[#182232] text-[#8b97ac] border-[#222d3e] hover:text-white'
            }`}
            title="Filter lines flagged with high market variance or significant daily card shifts"
          >
            <Zap className={`w-3.5 h-3.5 ${highVarianceOnly ? 'text-amber-400 animate-pulse' : 'text-slate-400'}`} />
            <span>High Variance ({highVarianceCount})</span>
          </button>
          <button onClick={onLogRows} disabled={!priced}
            className="px-3 py-1.5 bg-[#182232] hover:bg-[#202d42] disabled:opacity-40 text-slate-400 hover:text-white border border-[#222d3e] text-xs font-mono rounded-xl transition cursor-pointer"
            title="Optional force re-log: Official priced snapshot is automatically captured upon odds import">
            Log priced rows (Optional)
          </button>
          {onSnapshotAllPredictions && (
            <button onClick={onSnapshotAllPredictions}
              className="px-3 py-1.5 bg-[#182232] hover:bg-[#202d42] text-slate-400 hover:text-white border border-[#222d3e] text-xs font-mono rounded-xl transition cursor-pointer flex items-center gap-1.5"
              title="Optional force snapshot: Daily card tracks model projections automatically">
              📸 Snapshot All (Optional)
            </button>
          )}
          <button onClick={onOpenScreenshotUpload}
            className="px-3.5 py-1.5 bg-[#182232] hover:bg-[#222d3e] text-cyan-300 border border-cyan-500/40 text-xs font-mono font-semibold rounded-xl transition cursor-pointer">
            📷 Upload Lines Screenshot
          </button>
        </div>
      </div>

      {/* Pick of the Day (NHL Shots + Points) */}
      <PickOfTheDayCard pick={pickOfTheDay} sportLabel="NHL Shots + Points" />

      {/* Today's Plays (Multi-Market: Shots + Points) */}
      <TodaysPlaysSection
        sportLabel="NHL"
        sportKey="nhl"
        plays={todaysPlays}
        pickOfTheDay={pickOfTheDay}
        date={date}
        cardRows={cardRows}
        onAddToTicket={onAddToTicket}
        onTriggerGrade={onTriggerGrade}
      />

      {/* Search, Sort and Reset Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#556277] absolute left-2.5" />
            <input
              type="text"
              placeholder="Search skater, team or opponent…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-[#0f1520] border border-[#222d3e] text-white text-xs pl-8 pr-7 py-1.5 rounded-xl font-mono focus:border-cyan-400 outline-none w-56 sm:w-72"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 text-[#556277] hover:text-white cursor-pointer" title="Clear search">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Desk Sort Controls */}
          <div className="flex items-center gap-1 bg-[#0f1520] p-1 rounded-xl border border-[#222d3e] flex-wrap">
            <span className="text-[10px] font-mono text-[#556277] uppercase px-1.5 font-bold">Sort:</span>
            {(['edge', 'prob', 'combined', 'form', 'process'] as DeskSortOption[]).map(opt => (
              <button
                key={opt}
                onClick={() => setSortBy(opt)}
                className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg transition cursor-pointer ${
                  sortBy === opt ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
                }`}
              >
                {opt === 'edge' ? 'Edge'
                  : opt === 'prob' ? 'Model Prob'
                  : opt === 'combined' ? 'Combined'
                  : opt === 'form' ? 'Form (L10/L5)'
                  : 'Process'}
              </button>
            ))}
            <button
              onClick={() => setDeprioritizeWeakForm(v => !v)}
              className={`px-2 py-1 text-[11px] font-mono rounded-lg border transition cursor-pointer ${
                deprioritizeWeakForm
                  ? 'bg-amber-950/80 text-amber-300 border-amber-500/70 font-bold'
                  : 'bg-[#121824] text-[#8b97ac] border-[#222d3e] hover:text-white'
              }`}
              title="Push rows with L10 hit rate below 40% on the picked side below stronger-form rows"
            >
              L10 &lt;40% ↓
            </button>
            <span className="text-[10px] font-mono text-cyan-300 px-1.5" title="Active desk sort mode">
              Active: <strong>{DESK_SORT_LABELS[sortBy]}</strong>
            </span>
          </div>
        </div>

        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-[11px] font-mono text-cyan-400 hover:underline cursor-pointer"
          >
            Reset search
          </button>
        )}
      </div>

      {oddsPanel}

      {statusLines.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {statusLines.map(s => (
            <span key={s} className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-cyan-950/60 border border-cyan-700/60 text-cyan-300">{s}</span>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-[#556277] bg-[#121824] rounded-2xl border border-[#222d3e] font-mono text-xs">
            {games.length === 0
              ? 'No NHL schedule loaded for this date (official NHL API unreachable or no games). Nothing is invented offline.'
              : searchQuery.trim()
                ? `No skaters match "${searchQuery.trim()}".`
                : fullModel ? 'No skaters match the current filter.' : `No bettable skaters match (${hidden} low-usage / unavailable / estimated rows are hidden: tick Full model to see them).`}
          </div>
        ) : visibleRows.map(({ p, best, issue }) => (
          <div key={`${p.playerId}_${p.gameId}`}>
            {(best || (fullModel && issue)) && (
              <div className="flex flex-wrap gap-1.5 px-2 pb-0.5 text-[10px] font-mono">
                {best && <span className="px-1.5 py-0.5 rounded border border-emerald-700 text-emerald-300 bg-emerald-950/40">BEST LINE {best.side.toUpperCase()} {best.line}{best.ev !== null ? ` · EV ${(best.ev * 100).toFixed(1)}%` : best.edge !== null ? ` · edge ${best.edge.toFixed(1)}pp` : ''}</span>}
                {fullModel && issue && <span className="px-1.5 py-0.5 rounded border border-amber-700 text-amber-300 bg-amber-950/30">not bettable: {issue}</span>}
              </div>
            )}
            <NhlPlayerRow
              projection={p}
              teammates={teamIndex.get(`${p.gameId ?? ''}|${p.team}`)}
              market={market}
              entryFor={entryFor}
              settings={settings}
              selectedLine={lineFor(p)}
              isPotd={pickOfTheDay != null && pickOfTheDay.market === market && pickOfTheDay.player === p.name && Math.abs(pickOfTheDay.line - lineFor(p)) < 1e-6}
              onOddsChange={onOddsChange}
              onSelectLine={(m, id, l) => setLines(prev => ({ ...prev, [`${m}:${id}`]: l }))}
              variance={varianceMap.get(p.playerId)}
              onLogBet={onLogBet}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
