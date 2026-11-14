import React, { useState, useEffect, useMemo } from 'react';
import { NbaMarket, NBA_MARKETS, NbaOddsEntry, NbaPlayerProjection, NbaSettings, nbaOddsKey, NBA_MARKET_UNIT, NBA_MARKET_LABEL } from '../../types/nba';
import { NbaMatchup, NbaOddsMap, evalNbaRow } from '../../lib/nba_board';
import { NbaPlayerRow } from './NbaPlayerRow';
import { Calendar, Search, X, Zap, ChevronDown, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { BettableConfig, bestLine } from '../../lib/bettable';
import { rankDeskRows, DeskSortOption, DESK_SORT_LABELS, formSampleFromLogs } from '../../lib/desk_rank';
import { getNbaMarketVariance, MarketVarianceInfo } from '../../lib/market_variance';
import { getNbaPickOfTheDay } from '../../lib/pick_of_the_day';
import { PickOfTheDayCard } from '../common/PickOfTheDayCard';
import { TodaysPlaysSection, DeskPlayItem } from '../common/TodaysPlaysSection';
import { CardRow } from '../../lib/card_core';
import { calculateEdgePp, calculateEv } from '../../lib/odds';
import { computePlayerCardForm, isFormFightingLean } from '../../lib/player_card_form';
import { isMatchingPotd } from '../../lib/picker_grading';

interface Props {
  date: string;
  setDate: (d: string) => void;
  games: NbaMatchup[];
  projections: NbaPlayerProjection[];
  market: NbaMarket;
  setMarket: (m: NbaMarket) => void;
  oddsMap: NbaOddsMap;
  settings: NbaSettings;
  setShowStabsOnly: (v: boolean) => void;
  onOddsChange: (market: NbaMarket, playerId: number, line: number, side: 'over' | 'under', val: number | null) => void;
  onLogRows: () => void;
  onSnapshotAllPredictions?: () => void;
  onOpenScreenshotUpload: () => void;
  statusLines: string[];
  bet: BettableConfig;
  oddsPanel?: React.ReactNode;
  onLogBet?: (draft: { sport: 'nba'; player: string; team?: string; opp?: string; market: string; side: 'OVER' | 'UNDER'; line: number; odds: number }) => void;
  cardRows?: CardRow[];
  onAddToTicket?: (play: DeskPlayItem) => void;
  onTriggerGrade?: () => Promise<void> | void;
  onRefreshSlate?: () => Promise<void> | void;
}

const PAGE_SIZE = 30;

export const NbaDesk: React.FC<Props> = ({
  date, setDate, games, projections, market, setMarket, oddsMap, settings,
  setShowStabsOnly, onOddsChange, onLogRows, onSnapshotAllPredictions, onOpenScreenshotUpload, statusLines,
  bet, oddsPanel, onLogBet, cardRows, onAddToTicket, onTriggerGrade, onRefreshSlate
}) => {
  const [selectedGameId, setSelectedGameId] = useState<string | 'ALL'>('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lines, setLines] = useState<Record<string, number>>({});
  const [fullModel, setFullModel] = useState(!bet.bettableOnly);
  const [pricedOnly, setPricedOnly] = useState(false);
  const [highVarianceOnly, setHighVarianceOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [showAllRows, setShowAllRows] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<DeskSortOption>('edge');
  const [deprioritizeWeakForm, setDeprioritizeWeakForm] = useState<boolean>(false);

  useEffect(() => { setFullModel(!bet.bettableOnly); }, [bet.bettableOnly]);

  const entryFor = (m: NbaMarket, id: number, line: number): NbaOddsEntry | undefined => oddsMap[nbaOddsKey(m, id, line)];

  // Index projections by game for rapid matchup lookups
  const gameIndex = useMemo(() => {
    const m = new Map<string, NbaPlayerProjection[]>();
    projections.forEach(p => {
      const k = p.gameId ?? '';
      const list = m.get(k);
      if (list) list.push(p);
      else m.set(k, [p]);
    });
    return m;
  }, [projections]);

  // Compute rankings and memoize player line & tag lookups in O(1) Map
  const { ranked, playerEvalMap, qualifyingPlaysCount } = useMemo(() => {
    const rankedRows = rankDeskRows(projections, {
      sport: 'nba', market, cfg: bet, sortBy, deprioritizeWeakForm,
      linesOf: p => p.markets[market].lines, defaultLine: p => p.markets[market].defaultLine, picked: p => lines[`${market}:${p.playerId}`],
      entryAt: (p, l) => entryFor(market, p.playerId, l),
      evalAt: (p, l) => {
        const r = evalNbaRow(p, market, l, entryFor(market, p.playerId, l), settings);
        const d = r.decision;
        return { hasMarket: d.hasMarket, evOver: d.evOver, evUnder: d.evUnder, edgeOver: d.edgeOver, edgeUnder: d.edgeUnder, pOver: r.pOver, pUnder: r.pUnder };
      },
      mu: p => p.markets[market].mu, pm: p => p.markets[market].pm, inputs: p => p.inputsSource, availability: p => p.availability,
      formOf: (p, l, side) => {
        if (!p.recentLogs || p.recentLogs.length === 0) return null;
        return formSampleFromLogs(p.recentLogs.map(g => g.counts[market]).reverse(), l, side);
      }
    });

    const pMap = new Map<number, { line: number; tag: string }>();
    let plays = 0;

    for (const r of rankedRows) {
      const line = r.line;
      const entry = entryFor(market, r.p.playerId, line);
      const ev = evalNbaRow(r.p, market, line, entry, settings);
      const tag = ev.decision.tag;
      if (tag !== 'PASS') plays++;
      pMap.set(r.p.playerId, { line, tag });
    }

    return { ranked: rankedRows, playerEvalMap: pMap, qualifyingPlaysCount: plays };
  }, [projections, market, bet, lines, oddsMap, settings, sortBy, deprioritizeWeakForm]);

  const lineFor = (p: NbaPlayerProjection) => playerEvalMap.get(p.playerId)?.line ?? p.markets[market].defaultLine;
  const tagOf = (p: NbaPlayerProjection) => playerEvalMap.get(p.playerId)?.tag ?? 'PASS';

  // Memoized Market Variance Map
  const varianceMap = useMemo(() => {
    const map = new Map<number, MarketVarianceInfo>();
    projections.forEach(p => {
      const l = lineFor(p);
      const entry = entryFor(market, p.playerId, l);
      map.set(p.playerId, getNbaMarketVariance(p, market, l, entry));
    });
    return map;
  }, [projections, market, lines, oddsMap, playerEvalMap]);

  const highVarianceCount = useMemo(() => {
    return Array.from(varianceMap.values()).filter(v => v.isHighVariance).length;
  }, [varianceMap]);

  // Pick of the Day: Highest EV bettable play across all slate markets (stable per date)
  const pickOfTheDay = useMemo(() => {
    return getNbaPickOfTheDay(projections, oddsMap, settings, bet, date);
  }, [projections, oddsMap, settings, bet, date]);

  // Multi-Market Today's Plays across all priced NBA markets (pts, ast, reb, pra, tpm, stl, blk)
  const todaysPlays: DeskPlayItem[] = useMemo(() => {
    const list: DeskPlayItem[] = [];
    const seen = new Set<string>();

    for (const m of NBA_MARKETS) {
      for (const p of projections) {
        const mp = p.markets[m];
        if (!mp) continue;

        const pricedLines = mp.lines.filter(l => {
          const e = entryFor(m, p.playerId, l);
          return !!e && (e.over != null || e.under != null);
        });
        if (pricedLines.length === 0) continue;

        const evalFn = (l: number) => {
          const r = evalNbaRow(p, m, l, entryFor(m, p.playerId, l), settings);
          const d = r.decision;
          return { hasMarket: d.hasMarket, evOver: d.evOver, evUnder: d.evUnder, edgeOver: d.edgeOver, edgeUnder: d.edgeUnder, pOver: r.pOver, pUnder: r.pUnder };
        };
        const best = bestLine(pricedLines, evalFn);
        const pickedLine = lines[`${m}:${p.playerId}`];
        const line = pickedLine ?? best?.line ?? pricedLines[0];
        const entry = entryFor(m, p.playerId, line);
        const ev = evalNbaRow(p, m, line, entry, settings);
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

        const unit = NBA_MARKET_UNIT[m] || m;
        // Real logs only — never fabricate logs from minutes * rate
        const recentStatLogs = (p.recentLogs && p.recentLogs.length > 0)
          ? p.recentLogs.map(l => l.counts[m]).reverse()
          : [];
        const cardForm = computePlayerCardForm(
          recentStatLogs,
          line,
          side,
          {
            oppFactor: mp.oppFactor,
            edge: edgePp,
            seasonMinAvg: p.pm,
            recentMinutes: p.recentMinutes,
            marketLabel: unit
          }
        );
        const formWarning = isFormFightingLean(cardForm, side, line);

        list.push({
          id: playId,
          player: p.name,
          team: p.team,
          opp: p.opp,
          market: m,
          marketLabel: NBA_MARKET_LABEL[m] || unit,
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
          isPotd: isMatchingPotd({ player: p.name, market: m, side, line }, pickOfTheDay)
        });
      }
    }
    return list;
  }, [projections, lines, oddsMap, settings, pickOfTheDay]);

  // Filter rows based on game dropdown, search query, variance, etc.
  const visibleRows = useMemo(() => {
    return ranked.filter(r => {
      if (selectedGameId !== 'ALL' && r.p.gameId !== selectedGameId) return false;
      if (settings.showStabsOnly && tagOf(r.p) === 'PASS') return false;
      if (!fullModel && r.issue) return false;
      if (pricedOnly && !r.priced) return false;
      if (highVarianceOnly && !varianceMap.get(r.p.playerId)?.isHighVariance) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = r.p.name.toLowerCase().includes(q);
        const matchTeam = r.p.team.toLowerCase().includes(q);
        const matchOpp = r.p.opp.toLowerCase().includes(q);
        if (!matchName && !matchTeam && !matchOpp) return false;
      }
      return true;
    });
  }, [ranked, selectedGameId, settings.showStabsOnly, fullModel, pricedOnly, highVarianceOnly, varianceMap, searchQuery, playerEvalMap]);

  // Total hidden non-bettable rows
  const hidden = useMemo(() => {
    return ranked.filter(r => (selectedGameId === 'ALL' || r.p.gameId === selectedGameId) && r.issue).length;
  }, [ranked, selectedGameId]);

  const priced = useMemo(() => {
    return Object.values(oddsMap).filter(e => e.over != null || e.under != null).length;
  }, [oddsMap]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [selectedGameId, market, searchQuery, pricedOnly, fullModel, highVarianceOnly, settings.showStabsOnly]);

  // Paginated rows for smooth rendering without UI freeze
  const totalPages = Math.ceil(visibleRows.length / PAGE_SIZE) || 1;
  const paginatedRows = useMemo(() => {
    if (showAllRows || selectedGameId !== 'ALL') {
      return visibleRows;
    }
    const start = (page - 1) * PAGE_SIZE;
    return visibleRows.slice(start, start + PAGE_SIZE);
  }, [visibleRows, page, showAllRows, selectedGameId]);

  return (
    <div className="space-y-4">
      {/* Control Header with Clean Dropdown Game Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#121824] p-3.5 rounded-2xl border border-[#222d3e]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-[#8b97ac] font-mono">
            <Calendar className="w-4 h-4 text-cyan-400" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="bg-[#0b0f14] border border-[#222d3e] px-2.5 py-1 rounded-lg text-white font-mono text-xs outline-none focus:border-cyan-400"
            />
            {onRefreshSlate && (
              <button
                onClick={async () => {
                  if (isRefreshing) return;
                  setIsRefreshing(true);
                  try {
                    await onRefreshSlate();
                  } finally {
                    setIsRefreshing(false);
                  }
                }}
                disabled={isRefreshing}
                className="px-2.5 py-1 bg-[#0b0f14] hover:bg-[#182232] border border-[#222d3e] hover:border-cyan-500/50 text-[#8b97ac] hover:text-cyan-400 rounded-lg transition cursor-pointer flex items-center gap-1.5 text-xs font-mono disabled:opacity-50"
                title="Refresh schedule, injury reports, and grade completed games"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
                <span className="hidden sm:inline">Refresh Slate</span>
              </button>
            )}
          </div>

          {/* Market Chips */}
          <div className="flex items-center gap-1 bg-[#0f1520] p-1 rounded-xl border border-[#222d3e]">
            {NBA_MARKETS.map(m => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg transition cursor-pointer ${
                  market === m ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
                }`}
              >
                {NBA_MARKET_UNIT[m]}
              </button>
            ))}
          </div>

          {/* Game Selector Dropdown & Matchup Nav */}
          <div className="flex items-center gap-1.5">
            <div className="relative inline-flex items-center">
              <select
                value={selectedGameId}
                onChange={e => {
                  setSelectedGameId(e.target.value);
                  setPage(1);
                }}
                className="bg-[#0b0f14] border border-[#222d3e] hover:border-cyan-500/50 text-white text-xs font-mono font-semibold py-1.5 pl-3 pr-8 rounded-xl outline-none focus:border-cyan-400 cursor-pointer min-w-[210px] max-w-[280px] truncate"
              >
                <option value="ALL">🏀 All Games ({games.length} matchups · {projections.length} players)</option>
                {games.map(g => {
                  const pCount = gameIndex.get(g.gameId)?.length || 0;
                  return (
                    <option key={g.gameId} value={g.gameId}>
                      {g.away} @ {g.home} ({pCount} players)
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-cyan-400 absolute right-2.5 pointer-events-none" />
            </div>

            {/* Quick Prev / Next Game buttons */}
            {games.length > 1 && (
              <div className="flex items-center bg-[#0b0f14] border border-[#222d3e] rounded-xl overflow-hidden shrink-0">
                <button
                  onClick={() => {
                    const currIdx = games.findIndex(g => g.gameId === selectedGameId);
                    if (currIdx <= 0) setSelectedGameId(games[games.length - 1].gameId);
                    else setSelectedGameId(games[currIdx - 1].gameId);
                    setPage(1);
                  }}
                  className="px-2 py-1 text-xs text-[#8b97ac] hover:text-white hover:bg-[#182232] transition"
                  title="Previous game"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    const currIdx = games.findIndex(g => g.gameId === selectedGameId);
                    if (currIdx === -1 || currIdx >= games.length - 1) setSelectedGameId(games[0].gameId);
                    else setSelectedGameId(games[currIdx + 1].gameId);
                    setPage(1);
                  }}
                  className="px-2 py-1 text-xs text-[#8b97ac] hover:text-white hover:bg-[#182232] transition"
                  title="Next game"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filter Checkboxes and Actions */}
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
            Qualifying only ({qualifyingPlaysCount})
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
          <button
            onClick={onLogRows}
            disabled={!priced}
            className="px-3 py-1.5 bg-[#182232] hover:bg-[#202d42] disabled:opacity-40 text-slate-400 hover:text-white border border-[#222d3e] text-xs font-mono rounded-xl transition cursor-pointer"
            title="Optional force re-log: Official priced snapshot is automatically captured upon odds import"
          >
            Log priced rows (Optional)
          </button>
          {onSnapshotAllPredictions && (
            <button
              onClick={onSnapshotAllPredictions}
              className="px-3 py-1.5 bg-[#182232] hover:bg-[#202d42] text-slate-400 hover:text-white border border-[#222d3e] text-xs font-mono rounded-xl transition cursor-pointer flex items-center gap-1.5"
              title="Optional force snapshot: Daily card tracks model projections automatically"
            >
              📸 Snapshot All (Optional)
            </button>
          )}
          <button
            onClick={onOpenScreenshotUpload}
            className="px-3.5 py-1.5 bg-[#182232] hover:bg-[#222d3e] text-cyan-300 border border-cyan-500/40 text-xs font-mono font-semibold rounded-xl transition cursor-pointer"
          >
            📷 Upload Screenshot
          </button>
        </div>
      </div>

      {/* Pick of the Day (NBA Props) */}
      <PickOfTheDayCard pick={pickOfTheDay} sportLabel="NBA Props" />

      {/* Today's Plays (Multi-Market NBA Props) */}
      <TodaysPlaysSection
        sportLabel="NBA"
        sportKey="nba"
        plays={todaysPlays}
        pickOfTheDay={pickOfTheDay}
        date={date}
        cardRows={cardRows}
        onAddToTicket={onAddToTicket}
        onTriggerGrade={onTriggerGrade}
      />

      {/* Search, Sorting and Pagination Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#556277] absolute left-2.5" />
            <input
              type="text"
              placeholder="Search player, team or opponent…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-[#0f1520] border border-[#222d3e] text-white text-xs pl-8 pr-7 py-1.5 rounded-xl font-mono focus:border-cyan-400 outline-none w-56 sm:w-72"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 text-[#556277] hover:text-white cursor-pointer">
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

        {/* Smooth Pagination Controls */}
        <div className="flex items-center gap-3 text-xs font-mono text-[#8b97ac]">
          {selectedGameId === 'ALL' && visibleRows.length > PAGE_SIZE && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAllRows(!showAllRows)}
                className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
              >
                {showAllRows ? `Show Pages (${PAGE_SIZE}/page)` : `Show All (${visibleRows.length})`}
              </button>
              {!showAllRows && (
                <div className="flex items-center gap-1 bg-[#121824] border border-[#222d3e] rounded-xl px-1.5 py-0.5">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="p-1 text-[#8b97ac] hover:text-white disabled:opacity-30 cursor-pointer"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-white font-semibold text-[11px] px-1">
                    {page} / {totalPages}
                  </span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="p-1 text-[#8b97ac] hover:text-white disabled:opacity-30 cursor-pointer"
                    title="Next page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
          <span>
            Showing <strong className="text-white">{paginatedRows.length}</strong> of {visibleRows.length} players
          </span>
        </div>
      </div>

      {oddsPanel}

      {statusLines.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {statusLines.map(s => (
            <span key={s} className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-cyan-950/60 border border-cyan-700/60 text-cyan-300">{s}</span>
          ))}
        </div>
      )}

      {/* Render Player Rows */}
      <div className="space-y-2">
        {paginatedRows.length === 0 ? (
          <div className="p-8 text-center text-[#556277] bg-[#121824] rounded-2xl border border-[#222d3e] font-mono text-xs">
            {games.length === 0
              ? 'No NBA games loaded for this date (schedule feed unreachable or no games). Nothing is invented offline.'
              : searchQuery.trim()
                ? `No players match "${searchQuery.trim()}".`
                : fullModel
                  ? 'No players match the current filter.'
                  : `No bettable players match (${hidden} low-usage / unavailable / estimated rows are hidden: tick Full model to see them).`}
          </div>
        ) : (
          paginatedRows.map(({ p, best, issue }) => (
            <div key={`${p.playerId}_${p.gameId}`}>
              {(best || (fullModel && issue)) && (
                <div className="flex flex-wrap gap-1.5 px-2 pb-0.5 text-[10px] font-mono">
                  {best && (
                    <span className="px-1.5 py-0.5 rounded border border-emerald-700 text-emerald-300 bg-emerald-950/40">
                      BEST LINE {best.side.toUpperCase()} {best.line}
                      {best.ev !== null ? ` · EV ${(best.ev * 100).toFixed(1)}%` : best.edge !== null ? ` · edge ${best.edge.toFixed(1)}pp` : ''}
                    </span>
                  )}
                  {fullModel && issue && (
                    <span className="px-1.5 py-0.5 rounded border border-amber-700 text-amber-300 bg-amber-950/30">
                      not bettable: {issue}
                    </span>
                  )}
                </div>
              )}
              <NbaPlayerRow
                projection={p}
                gamePlayers={gameIndex.get(p.gameId ?? '') ?? [p]}
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
          ))
        )}
      </div>

      {/* Bottom Pagination if multiple pages */}
      {selectedGameId === 'ALL' && !showAllRows && totalPages > 1 && (
        <div className="flex items-center justify-between p-3 bg-[#121824] rounded-xl border border-[#222d3e] text-xs font-mono">
          <span className="text-[#8b97ac]">
            Page <strong className="text-white">{page}</strong> of <strong className="text-white">{totalPages}</strong> ({visibleRows.length} total players)
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => {
                setPage(p => Math.max(1, p - 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="px-3 py-1 bg-[#182232] hover:bg-[#222d3e] text-white rounded-lg disabled:opacity-30 cursor-pointer"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => {
                setPage(p => Math.min(totalPages, p + 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="px-3 py-1 bg-[#182232] hover:bg-[#222d3e] text-white rounded-lg disabled:opacity-30 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
