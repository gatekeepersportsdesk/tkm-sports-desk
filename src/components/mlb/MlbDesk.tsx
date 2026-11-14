import React, { useState, useEffect } from 'react';
import { MlbGameMatchup, MlbBatterInput, MlbHitProjection, MlbGateResult } from '../../types/mlb';
import { scoreMlbHit, gateMlbRow, MLB_DEFAULT_TUNE } from '../../model/mlb_engine';
import { batterForEngine, roundOf } from '../../lib/mlb_stats';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { mlbNotStarted } from '../../lib/mlb_card';
import { MlbBatterCard } from './MlbBatterCard';
import { MlbPlayerSheet } from './MlbPlayerSheet';
import { getMlbPickOfTheDay } from '../../lib/pick_of_the_day';
import { PickOfTheDayCard } from '../common/PickOfTheDayCard';
import { TodaysPlaysSection, DeskPlayItem } from '../common/TodaysPlaysSection';
import { CardRow } from '../../lib/card_core';
import { calculateEdgePp, calculateEv, parseOdds } from '../../lib/odds';
import { computePlayerCardForm, isFormFightingLean } from '../../lib/player_card_form';

interface MlbDeskProps {
  games: MlbGameMatchup[];
  oddsMap: Record<number, { over: string; under: string; line?: number }>;
  parlayLegs: number[];
  tune: typeof MLB_DEFAULT_TUNE;
  onUpdateOdds: (id: number, side: 'over' | 'under', val: string) => void;
  onUpdateLine?: (id: number, line: number) => void;
  onToggleParlay: (batter: MlbBatterInput, gate: MlbGateResult, price: { over: string; under: string; line?: number }) => void;
  onLogAllPriced: (pricedRows: any[]) => void;
  /** automatic, silent logging of priced rows (games not started, two-way price) */
  onAutoLogPriced?: (pricedRows: any[]) => void;
  onOpenScreenshotUpload: () => void;
  onLogBet?: (draft: { sport: 'mlb'; player: string; team?: string; opp?: string; market: string; side: 'OVER' | 'UNDER'; line: number; odds: number }) => void;
  cardRows?: CardRow[];
  onAddToTicket?: (play: DeskPlayItem) => void;
  onTriggerGrade?: () => Promise<void> | void;
}

export const MlbDesk: React.FC<MlbDeskProps> = ({
  games,
  oddsMap,
  parlayLegs,
  tune,
  onUpdateOdds,
  onUpdateLine,
  onToggleParlay,
  onLogAllPriced,
  onAutoLogPriced,
  onOpenScreenshotUpload,
  onLogBet,
  cardRows,
  onAddToTicket,
  onTriggerGrade
}) => {
  const [filter, setFilter] = useState<'ALL' | 'PLAY' | 'PASS'>('ALL');
  const [sortOrder, setSortOrder] = useState<'default' | 'pct_desc' | 'pct_asc'>('default');
  const [selectedSheetRow, setSelectedSheetRow] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Compute all row projections with full line flexibility
  const allRows: {
    batter: MlbBatterInput;
    hit: MlbHitProjection;
    gate: MlbGateResult;
    game: MlbGameMatchup;
    price: { over: string; under: string; line?: number };
  }[] = [];

  games.forEach(game => {
    game.batters.forEach(b => {
      const oppSp = b.isHome ? game.awaySp : game.homeSp;
      const round = roundOf(game.gameType);
      const hit = scoreMlbHit(batterForEngine(b), oppSp, game.park, round, 4.4, tune);
      const price = oddsMap[b.id] || { over: "", under: "", line: 0.5 };
      const gate = gateMlbRow({
        confirmed: game.confirmed,
        slot: b.slot,
        live: game.live,
        inning: game.inning,
        line: price.line !== undefined ? price.line : 0.5,
        over: price.over,
        under: price.under,
        round,
        availability: b.availability,
        hit,
        tune
      });

      allRows.push({ batter: b, hit, gate, game, price });
    });
  });

  const playCount = allRows.filter(r => r.gate.call === 'PLAY').length;
  const passCount = allRows.filter(r => r.gate.call === 'PASS').length;

  // Pick of the Day: Highest EV bettable batter with PLAY status (stable per date)
  const pickOfTheDay = React.useMemo(() => {
    return getMlbPickOfTheDay(allRows, new Date().toISOString().split('T')[0]);
  }, [allRows]);

  // Today's Plays for the desk and parlay groups
  const todaysPlays: DeskPlayItem[] = React.useMemo(() => {
    const list: DeskPlayItem[] = [];
    for (const r of allRows) {
      if (!r.price.over && !r.price.under) continue;
      const side: 'OVER' | 'UNDER' = 'OVER';
      const rawOdds = r.price.over;
      if (!rawOdds || !rawOdds.trim()) continue;
      const parsedOdds = parseOdds(rawOdds);
      if (!parsedOdds) continue;
      const oddsVal = parsedOdds.us;
      const prob = r.hit.pAtLeast ? r.hit.pAtLeast[0] : r.hit.calP;
      const edgePp = calculateEdgePp(prob, oddsVal);
      const evVal = calculateEv(prob, oddsVal);
      if (edgePp === null) continue; // Disqualify impossible / invalid edge

      const line = r.price.line ?? 0.5;
      const modelMu = r.hit.raw ?? (r.hit.ba * (r.hit.ab || 4));
      const rawLogs = (r.batter.recentBa != null && r.batter.recentAb && r.batter.recentAb >= 10)
        ? [Math.round(r.batter.recentBa * 4), Math.round(r.batter.recentBa * 4), Math.round(r.batter.recentBa * 3), Math.round(r.batter.recentBa * 5), Math.round(r.batter.recentBa * 4)]
        : [];
      const cardForm = computePlayerCardForm(
        rawLogs,
        line,
        side,
        {
          edge: edgePp,
          marketLabel: 'hits'
        }
      );
      const formWarning = isFormFightingLean(cardForm, side, line);

      list.push({
        id: `${r.batter.id}:hits:${line}`,
        player: r.batter.name,
        team: r.batter.team,
        opp: r.game.away === r.batter.team ? r.game.home : r.game.away,
        market: 'hits',
        side,
        line,
        odds: oddsVal,
        prob,
        edge: edgePp,
        ev: evVal,
        hasOdds: true,
        modelMu,
        unit: 'hits',
        form: cardForm,
        formWarning
      });
    }
    return list;
  }, [allRows]);

  const pricedSig = allRows
    .filter(r => Boolean(r.price.over) && Boolean(r.price.under))
    .map(r => `${r.batter.id}:${r.price.line ?? 0.5}:${r.price.over}:${r.price.under}`)
    .join('|');
  useEffect(() => {
    if (!onAutoLogPriced || !pricedSig) return;
    const t = setTimeout(() => {
      const priced = allRows.filter(
        r => Boolean(r.price.over) && Boolean(r.price.under) && r.gate.reasons.indexOf('NO_PRICE') < 0 && mlbNotStarted(r.game)
      );
      if (priced.length) onAutoLogPriced(priced);
    }, 1500);
    return () => clearTimeout(t);
  }, [pricedSig]);

  const handleLogClick = () => {
    const priced = allRows.filter(r => Boolean(r.price.over) && r.gate.reasons.indexOf('NO_PRICE') < 0);
    if (priced.length === 0) {
      alert("No rows have odds entered yet.");
      return;
    }
    onLogAllPriced(priced);
  };

  return (
    <div className="space-y-4">
      {/* Control ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#121824] p-3.5 rounded-2xl border border-[#222d3e]">
        <div className="flex items-center gap-1.5 bg-[#0f1520] p-1 rounded-xl border border-[#222d3e]">
          <button
            onClick={() => setFilter('ALL')}
            className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded-lg transition cursor-pointer ${
              filter === 'ALL' ? 'bg-amber-400 text-amber-950 font-bold' : 'text-[#8b97ac] hover:text-white'
            }`}
          >
            All Hitters ({allRows.length})
          </button>
          <button
            onClick={() => setFilter('PLAY')}
            className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded-lg transition cursor-pointer ${
              filter === 'PLAY' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-emerald-400'
            }`}
          >
            PLAYs Only ({playCount})
          </button>
          <button
            onClick={() => setFilter('PASS')}
            className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded-lg transition cursor-pointer ${
              filter === 'PASS' ? 'bg-slate-700 text-white font-bold' : 'text-[#8b97ac] hover:text-white'
            }`}
          >
            PASS Only ({passCount})
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Model % Sort Controls */}
          <div className="flex items-center gap-1 bg-[#0f1520] p-1 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] px-1.5 uppercase font-bold">Sort:</span>
            <button
              onClick={() => setSortOrder('pct_desc')}
              className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg transition cursor-pointer flex items-center gap-1 ${
                sortOrder === 'pct_desc' ? 'bg-amber-400 text-amber-950 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
              title="Sort highest hit probability percentage first"
            >
              <span>Model %</span>
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setSortOrder('pct_asc')}
              className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg transition cursor-pointer flex items-center gap-1 ${
                sortOrder === 'pct_asc' ? 'bg-amber-400 text-amber-950 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
              title="Sort lowest hit probability percentage first"
            >
              <span>Model %</span>
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            {sortOrder !== 'default' && (
              <button
                onClick={() => setSortOrder('default')}
                className="px-1.5 py-1 text-[10px] font-mono text-[#556277] hover:text-[#8b97ac] transition cursor-pointer"
                title="Reset to default lineup slot sort"
              >
                Reset
              </button>
            )}
          </div>

          <span className={`text-[11px] font-mono px-2.5 py-1 rounded-lg flex items-center gap-1.5 border ${
            games.some(g => g.confirmed) ? 'text-emerald-400 bg-emerald-950/70 border-emerald-800' : 'text-amber-300 bg-amber-950/40 border-amber-800'
          }`}>
            <span className={`w-2 h-2 rounded-full ${games.some(g => g.confirmed) ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            {games.length === 0 ? 'No MLB games' : `${games.filter(g => g.confirmed).length}/${games.length} lineups posted`}
          </span>
          <button
            onClick={onOpenScreenshotUpload}
            className="px-3.5 py-1.5 bg-[#182232] hover:bg-[#222d3e] text-amber-300 border border-amber-500/40 text-xs font-mono font-semibold rounded-xl transition cursor-pointer"
          >
            📷 Upload Lines Screenshot
          </button>
          <button
            onClick={handleLogClick}
            className="px-3.5 py-1.5 bg-[#182232] hover:bg-[#222d3e] text-white border border-[#222d3e] text-xs font-mono font-semibold rounded-xl transition cursor-pointer"
          >
            📋 Log Priced Rows
          </button>
        </div>
      </div>

      {/* Pick of the Day (MLB 0.5-Hits) */}
      <PickOfTheDayCard pick={pickOfTheDay} sportLabel="MLB 0.5-Hits" />

      {/* Today's Plays */}
      <TodaysPlaysSection
        sportLabel="MLB"
        sportKey="mlb"
        plays={todaysPlays}
        date={new Date().toISOString().slice(0, 10)}
        cardRows={cardRows}
        onAddToTicket={onAddToTicket}
        onTriggerGrade={onTriggerGrade}
      />

      {/* Search and Reset Filter Bar */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#556277] absolute left-2.5" />
          <input
            type="text"
            placeholder="Search hitter, team, or pitcher…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-[#0f1520] border border-[#222d3e] text-white text-xs pl-8 pr-7 py-1.5 rounded-xl font-mono focus:border-amber-400 outline-none w-56 sm:w-72"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 text-[#556277] hover:text-white cursor-pointer" title="Clear search">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-[11px] font-mono text-amber-400 hover:underline cursor-pointer"
          >
            Reset search
          </button>
        )}
      </div>

      {/* Matchup game sections */}
      <div className="space-y-4">
        {(() => {
          const filterRow = (r: (typeof allRows)[0]) => {
            if (filter === 'PLAY' && r.gate.call !== 'PLAY') return false;
            if (filter === 'PASS' && r.gate.call !== 'PASS') return false;
            if (searchQuery.trim()) {
              const q = searchQuery.trim().toLowerCase();
              const oppTeam = (r.batter.isHome ? r.game.away : r.game.home).toLowerCase();
              const matchName = r.batter.name.toLowerCase().includes(q);
              const matchTeam = r.batter.team.toLowerCase().includes(q);
              const matchOpp = oppTeam.includes(q);
              const matchOppSp = (r.batter.oppSp || '').toLowerCase().includes(q);
              if (!matchName && !matchTeam && !matchOpp && !matchOppSp) return false;
            }
            return true;
          };

          const displayedGames = searchQuery.trim()
            ? games.filter(g => allRows.some(r => r.game.gamePk === g.gamePk && filterRow(r)))
            : games;

          if (searchQuery.trim() && displayedGames.length === 0) {
            return (
              <div className="p-8 text-center text-[#8b97ac] bg-[#121824] rounded-2xl border border-[#222d3e]">
                <p className="font-semibold text-white">No batters found matching "{searchQuery.trim()}".</p>
                <p className="text-xs text-[#556277] mt-1 font-mono">
                  Try searching by hitter name, team abbreviation, or opposing pitcher.
                </p>
              </div>
            );
          }

          return displayedGames.map(game => {
            const gameRows = allRows.filter(r => r.game.gamePk === game.gamePk);
            const visibleRows = gameRows
              .filter(filterRow)
              .sort((a, b) => {
                if (sortOrder === 'pct_desc') return b.gate.calP - a.gate.calP;
                if (sortOrder === 'pct_asc') return a.gate.calP - b.gate.calP;
                return a.batter.slot - b.batter.slot;
              });

            return (
              <section key={game.gamePk} className="bg-[#121824] rounded-2xl border border-[#222d3e] overflow-hidden">
              <div className="px-4 py-3 bg-[#182232] border-b border-[#222d3e] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold font-display uppercase tracking-wider text-white">
                    {game.away} @ {game.home}
                  </h3>
                  <p className="text-xs text-[#8b97ac] font-mono">
                    {game.status} &middot; Starters: {game.awaySp.name}{game.awaySp.kPct ? '' : ' (no stats)'} vs {game.homeSp.name}{game.homeSp.kPct ? '' : ' (no stats)'} &middot; Park factor: {game.park.toFixed(3)}{game.gameType && 'FDLW'.includes(game.gameType) ? ' · postseason' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-[#0f1520] text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-900 font-semibold">
                    {gameRows.filter(r => r.gate.call === 'PLAY').length} PLAYs
                  </span>
                  <span className="font-mono text-xs bg-[#0f1520] text-[#8b97ac] px-2.5 py-1 rounded-full border border-[#222d3e]">
                    {gameRows.length} Batters on Board
                  </span>
                </div>
              </div>

              {visibleRows.length === 0 ? (
                <div className="p-8 text-center text-[#8b97ac] font-mono text-xs">
                  {gameRows.length === 0
                    ? (game.note || 'No batters for this game.')
                    : `No batters match the current filter (${filter}) for this matchup.`}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                  {visibleRows.map(row => (
                    <MlbBatterCard
                      key={row.batter.id}
                      row={row}
                      inParlay={parlayLegs.includes(row.batter.id)}
                      onToggleParlay={() => onToggleParlay(row.batter, row.gate, row.price)}
                      onOpenSheet={() => setSelectedSheetRow(row)}
                      onOddsChange={(side, val) => onUpdateOdds(row.batter.id, side, val)}
                      onLineChange={lineVal => {
                        if (onUpdateLine) onUpdateLine(row.batter.id, lineVal);
                      }}
                      onLogBet={onLogBet}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        });
      })()}
      </div>

      {/* Deep Dive Modal */}
      {selectedSheetRow && (
        <MlbPlayerSheet
          row={selectedSheetRow}
          onClose={() => setSelectedSheetRow(null)}
        />
      )}
    </div>
  );
};
