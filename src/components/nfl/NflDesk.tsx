import React, { useState } from 'react';
import { NflPropSnapshot, NflGameContext } from '../../types/nfl';
import { NflPropRow } from './NflPropRow';
import { NFL_GAMES, getPlayersForTeam } from '../../data/nfl_seed';
import { baselineSnapshot, snapshotFor, resolveReceiver, NflImportContext } from '../../lib/nfl_import';
import { getTodayDayOfWeek } from '../../lib/dates';
import { ArrowDown, ArrowUp, Zap, Search, X } from 'lucide-react';
import { getNflMarketVariance } from '../../lib/market_variance';
import { getNflPickOfTheDay } from '../../lib/pick_of_the_day';
import { PickOfTheDayCard } from '../common/PickOfTheDayCard';
import { TodaysPlaysSection, DeskPlayItem } from '../common/TodaysPlaysSection';
import { CardRow } from '../../lib/card_core';
import { parseOdds, calculateEdgePp, calculateEv } from '../../lib/odds';
import { computePlayerCardForm, isFormFightingLean } from '../../lib/player_card_form';
import { computeProcessScore, formSampleFromLogs, isWeakL10Form, DESK_SORT_LABELS, DeskSortOption } from '../../lib/desk_rank';
import { isMatchingPotd } from '../../lib/picker_grading';

interface NflDeskProps {
  snapshots: NflPropSnapshot[];
  bets: Record<string, { stake: number; side: 'over' | 'under'; odds_taken: number }>;
  games?: Record<string, NflGameContext>;
  liveRosters?: Record<string, import('../../types/nfl').NflPlayerStats[]>;
  rosterStatus?: string;
  /** injuries / availability feed (UNKNOWN when no report is loaded) */
  injuries?: NflImportContext['injuries'];
  injuriesAvailable?: boolean;
  /** insert/replace a priced row in the app's persistent snapshot list */
  onUpsertSnapshot?: (snap: NflPropSnapshot) => void;
  onRecordBet: (snap: NflPropSnapshot) => void;
  onOpenImport: () => void;
  onOpenScreenshotUpload?: () => void;
  onLogBet?: (draft: { sport: 'nfl'; player: string; team?: string; opp?: string; market: string; side: 'OVER' | 'UNDER'; line: number; odds: number }) => void;
  cardRows?: CardRow[];
  onAddToTicket?: (play: DeskPlayItem) => void;
  onTriggerGrade?: () => Promise<void> | void;
}

export const NflDesk: React.FC<NflDeskProps> = ({
  snapshots: externalSnapshots,
  bets,
  games = NFL_GAMES,
  liveRosters = {},
  rosterStatus,
  injuries = {},
  injuriesAvailable = false,
  onUpsertSnapshot,
  onRecordBet,
  onOpenImport,
  onOpenScreenshotUpload,
  onLogBet,
  cardRows,
  onAddToTicket,
  onTriggerGrade
}) => {
  const allGames = Object.values(games && Object.keys(games).length > 0 ? games : NFL_GAMES);
  
  // Available days
  const availableDays: string[] = Array.from(new Set(allGames.map(g => g.day as string)));
  const daysOrder: string[] = ['Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday'];
  const orderedDays = daysOrder.filter(d => availableDays.includes(d));
  availableDays.forEach(d => {
    if (!orderedDays.includes(d as any)) orderedDays.push(d as any);
  });

  // Default to today's day if games exist for today (e.g. Monday), otherwise first day
  const todayDay: string = getTodayDayOfWeek();
  const initialDay = orderedDays.includes(todayDay as any) ? todayDay : (orderedDays[0] || 'Monday');

  const [selectedDay, setSelectedDay] = useState<string>('ALL');
  const [filterMode, setFilterMode] = useState<'ALL' | 'PLAY' | 'PASS'>('ALL');
  const [sortOrder, setSortOrder] = useState<'edge' | 'pct_desc' | 'pct_asc' | 'combined' | 'form' | 'process'>('edge');
  const [deprioritizeWeakForm, setDeprioritizeWeakForm] = useState<boolean>(false);
  const [highVarianceOnly, setHighVarianceOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const currentSnapshots = externalSnapshots;
  const gateCtx = { injuries, injuriesAvailable };

  // Pick of the Day: Highest EV bettable play across NFL prop snapshots (stable per date)
  const pickOfTheDay = React.useMemo(() => {
    return getNflPickOfTheDay(currentSnapshots, undefined, new Date().toISOString().split('T')[0]);
  }, [currentSnapshots]);

  // Today's Plays for the desk and parlay groups
  const todaysPlays: DeskPlayItem[] = React.useMemo(() => {
    const list: DeskPlayItem[] = [];
    for (const s of currentSnapshots) {
      if (s.hasMarket === false || (!s.overOdds && !s.underOdds)) continue;
      const side = s.lean;
      const oddsRaw = side === 'OVER' ? s.overOdds : s.underOdds;
      if (!oddsRaw || !oddsRaw.trim()) continue;
      const parsedOdds = parseOdds(oddsRaw);
      if (!parsedOdds) continue;
      const oddsVal = parsedOdds.us;
      const prob = side === 'OVER' ? s.p_over : s.p_under;
      const edgePp = calculateEdgePp(prob, oddsVal);
      const evVal = calculateEv(prob, oddsVal);
      if (edgePp === null) continue; // Disqualify impossible / invalid edge

      const rawLogs: number[] = Array.isArray((s as any).recentReceptions) ? (s as any).recentReceptions : [];
      const cardForm = computePlayerCardForm(
        rawLogs,
        s.line,
        side,
        {
          edge: edgePp,
          marketLabel: 'rec'
        }
      );
      const formWarning = isFormFightingLean(cardForm, side, s.line);

      list.push({
        id: s.id || `${s.player}:receptions:${s.line}`,
        player: s.player,
        team: s.team,
        opp: s.gameKey || '',
        market: 'receptions',
        marketLabel: 'Receptions',
        side,
        line: s.line,
        odds: oddsVal,
        prob,
        edge: edgePp,
        ev: evVal,
        hasOdds: true,
        modelMu: s.mu,
        unit: 'rec',
        form: cardForm,
        formWarning,
        isPotd: isMatchingPotd({ player: s.player, market: 'receptions', side, line: s.line }, pickOfTheDay)
      });
    }
    return list;
  }, [currentSnapshots, pickOfTheDay]);

  const handleUpdateLine = (game: NflGameContext, playerName: string, line: number, overOdds: string, underOdds: string) => {
    // Resolve the receiver from the roster the row came from (never guess a team).
    const pool = [...(liveRosters[game.home] || []), ...(liveRosters[game.away] || []), ...getPlayersForTeam(game.home), ...getPlayersForTeam(game.away)];
    const p = resolveReceiver(playerName, pool.filter(x => x.team === game.home || x.team === game.away));
    if (!p) return;
    onUpsertSnapshot?.(snapshotFor(p, game, line, overOdds, underOdds, gateCtx));
  };

  // Filter games based on selectedDay
  const activeGames = selectedDay === 'ALL'
    ? allGames
    : allGames.filter(g => g.day === selectedDay);

  // Helper to ensure all players on a team are present
  const getTeamRosterSnapshots = (game: NflGameContext, team: string): NflPropSnapshot[] => {
    const live = liveRosters[team] || liveRosters[(team || '').toUpperCase()] || [];
    const seeded = getPlayersForTeam(team).filter(p => !/WR\d|TE\d|Top Center|Top Winger/i.test(p.name));
    const byName = new Map(seeded.map(p => [p.name.toLowerCase(), p]));
    // Prefer LIVE real names. Never show role placeholders.
    const teamPlayers = (live.length ? live.map(p => byName.get(p.name.toLowerCase()) || p) : seeded)
      .filter(p => p.name && !/WR\d|TE\d|Top Center|Top Winger|1st Pair|Offensive D/i.test(p.name));
    
    // For each player on this team, find or create their snapshot for this game
    return teamPlayers.map(p => {
      const existing = currentSnapshots.find(s => s.player === p.name && s.gameKey === game.id);
      if (existing) return existing;

      // Model-only baseline: no odds are invented, so it can never be a BET.
      return baselineSnapshot(p, game, gateCtx);
    });
  };

  // Count total plays and high-variance lines across whole board
  let totalBoardPlayers = 0;
  let totalBoardPlays = 0;
  let totalBoardVarianceCount = 0;
  allGames.forEach(g => {
    const awaySnaps = getTeamRosterSnapshots(g, g.away);
    const homeSnaps = getTeamRosterSnapshots(g, g.home);
    const all = [...awaySnaps, ...homeSnaps];
    totalBoardPlayers += all.length;
    totalBoardPlays += all.filter(s => s.cardStatus === 'BET').length;
    totalBoardVarianceCount += all.filter(s => getNflMarketVariance(s).isHighVariance).length;
  });

  return (
    <div className="space-y-4">
      {rosterStatus && (
        <div className="text-[11px] font-mono text-[#8b97ac] px-1">NFL roster: {rosterStatus}</div>
      )}
      {/* Slate Days & Quick Filter Navigation Rail */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-[#121824] p-3 rounded-2xl border border-[#222d3e]">
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setSelectedDay('ALL')}
            className={`px-3 py-1.5 rounded-xl text-left transition flex flex-col min-w-[100px] border ${
              selectedDay === 'ALL'
                ? 'bg-sky-950/80 border-sky-400 text-sky-300'
                : 'bg-[#0f1520] border-[#222d3e] text-[#8b97ac] hover:text-white'
            }`}
          >
            <span className="text-[10px] font-mono uppercase font-bold tracking-wider">
              Whole Board
            </span>
            <span className="text-xs font-mono font-semibold text-white">
              All Matchups ({totalBoardPlayers} players)
            </span>
          </button>

          {orderedDays.map(day => {
            const isToday = day.toLowerCase() === todayDay.toLowerCase();
            const dayGames = allGames.filter(g => g.day === day);
            let dayPlayers = 0;
            let dayPlays = 0;
            dayGames.forEach(g => {
              const all = [...getTeamRosterSnapshots(g, g.away), ...getTeamRosterSnapshots(g, g.home)];
              dayPlayers += all.length;
              dayPlays += all.filter(s => s.cardStatus === 'BET').length;
            });

            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`px-3.5 py-1.5 rounded-xl text-left transition flex flex-col min-w-[95px] border ${
                  selectedDay === day
                    ? 'bg-sky-950/80 border-sky-400 text-sky-300'
                    : 'bg-[#0f1520] border-[#222d3e] text-[#8b97ac] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono uppercase font-bold tracking-wider">
                    {day}
                  </span>
                  {isToday && (
                    <span className="text-[9px] bg-emerald-500 text-slate-950 px-1 rounded font-bold uppercase">
                      Today
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono font-semibold text-white">
                  {dayPlayers} players {dayPlays > 0 && <span className="text-emerald-400 font-bold">({dayPlays} PLAY)</span>}
                </span>
              </button>
            );
          })}
        </div>

        {/* PLAY / PASS Filter and Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-[#0f1520] p-1 rounded-xl border border-[#222d3e]">
            <button
              onClick={() => setFilterMode('ALL')}
              className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg transition ${
                filterMode === 'ALL'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              All Players
            </button>
            <button
              onClick={() => setFilterMode('PLAY')}
              className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg transition ${
                filterMode === 'PLAY'
                  ? 'bg-emerald-500 text-slate-950 font-bold'
                  : 'text-[#8b97ac] hover:text-emerald-400'
              }`}
            >
              PLAYs Only ({totalBoardPlays})
            </button>
            <button
              onClick={() => setFilterMode('PASS')}
              className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg transition ${
                filterMode === 'PASS'
                  ? 'bg-slate-700 text-white font-bold'
                  : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              PASS Only
            </button>
            <button
              onClick={() => setHighVarianceOnly(!highVarianceOnly)}
              className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                highVarianceOnly
                  ? 'bg-amber-950 text-amber-300 border border-amber-500 font-bold shadow-sm shadow-amber-950/50'
                  : 'text-[#8b97ac] hover:text-white'
              }`}
              title="Filter lines with high market variance or significant daily-card shifts"
            >
              <Zap className={`w-3.5 h-3.5 ${highVarianceOnly ? 'text-amber-400 animate-pulse' : 'text-slate-400'}`} />
              <span>High Variance ({totalBoardVarianceCount})</span>
            </button>
          </div>

          {/* Desk Sort Controls */}
          <div className="flex items-center gap-1 bg-[#0f1520] p-1 rounded-xl border border-[#222d3e] flex-wrap">
            <span className="text-[10px] font-mono text-[#8b97ac] px-1.5 uppercase font-bold">Sort:</span>
            <button
              onClick={() => setSortOrder('edge')}
              className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg transition cursor-pointer ${
                sortOrder === 'edge' ? 'bg-sky-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              Edge
            </button>
            <button
              onClick={() => setSortOrder('pct_desc')}
              className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg transition cursor-pointer flex items-center gap-1 ${
                sortOrder === 'pct_desc' ? 'bg-sky-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              <span>Model Prob</span>
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setSortOrder('combined')}
              className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg transition cursor-pointer ${
                sortOrder === 'combined' ? 'bg-sky-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              Combined
            </button>
            <button
              onClick={() => setSortOrder('form')}
              className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg transition cursor-pointer ${
                sortOrder === 'form' ? 'bg-sky-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              Form (L10/L5)
            </button>
            <button
              onClick={() => setSortOrder('process')}
              className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg transition cursor-pointer ${
                sortOrder === 'process' ? 'bg-sky-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              Process
            </button>
            <button
              onClick={() => setDeprioritizeWeakForm(v => !v)}
              className={`px-2 py-1 text-[11px] font-mono rounded-lg border transition cursor-pointer ${
                deprioritizeWeakForm
                  ? 'bg-amber-950/80 text-amber-300 border-amber-500/70 font-bold'
                  : 'bg-[#121824] text-[#8b97ac] border-[#222d3e] hover:text-white'
              }`}
              title="Push rows with L10 hit rate below 40% below stronger-form rows when form logs exist"
            >
              L10 &lt;40% ↓
            </button>
            <span className="text-[10px] font-mono text-sky-300 px-1.5">
              Active: <strong>{
                sortOrder === 'pct_desc' ? DESK_SORT_LABELS.prob
                  : sortOrder === 'pct_asc' ? 'Model Prob (Asc)'
                  : DESK_SORT_LABELS[sortOrder as DeskSortOption]
              }</strong>
            </span>
          </div>

          <button
            onClick={onOpenScreenshotUpload || onOpenImport}
            className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 cursor-pointer"
          >
            📷 Upload Lines Screenshot
          </button>
          <button
            onClick={onOpenImport}
            className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-[#182232] hover:bg-[#222d3e] text-sky-400 border border-sky-500/40 cursor-pointer"
          >
            📋 Paste Lines
          </button>
        </div>
      </div>

      {/* Pick of the Day (NFL Receptions) */}
      <PickOfTheDayCard pick={pickOfTheDay} sportLabel="NFL Receptions" />

      {/* Today's Plays */}
      <TodaysPlaysSection
        sportLabel="NFL"
        sportKey="nfl"
        plays={todaysPlays}
        pickOfTheDay={pickOfTheDay}
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
            placeholder="Search player, team or opponent…"
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
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-[11px] font-mono text-cyan-400 hover:underline cursor-pointer"
          >
            Reset search
          </button>
        )}
      </div>

      {/* Matchups list */}
      <div className="space-y-4">
        {activeGames.length === 0 ? (
          <div className="p-8 text-center text-[#8b97ac] bg-[#121824] rounded-2xl border border-[#222d3e]">
            <p className="font-semibold text-white">No NFL games found for this selection.</p>
          </div>
        ) : (() => {
          const winPctOf = (s: NflPropSnapshot) => (s.lean === 'OVER' ? s.p_over : s.p_under);

          const filterAndSortSnaps = (snaps: NflPropSnapshot[], game: NflGameContext) => {
            let list = snaps;
            if (filterMode === 'PLAY') list = list.filter(s => s.cardStatus === 'BET');
            if (filterMode === 'PASS') list = list.filter(s => s.cardStatus !== 'BET');
            if (highVarianceOnly) list = list.filter(s => getNflMarketVariance(s).isHighVariance);
            if (searchQuery.trim()) {
              const q = searchQuery.trim().toLowerCase();
              list = list.filter(s => {
                const oppTeam = (s.team === game.home ? game.away : game.home).toLowerCase();
                const matchPlayer = (s.player || '').toLowerCase().includes(q);
                const matchTeam = (s.team || '').toLowerCase().includes(q);
                const matchOpp = oppTeam.includes(q);
                return matchPlayer || matchTeam || matchOpp;
              });
            }
            const formFor = (s: NflPropSnapshot) => {
              const logs: number[] = Array.isArray((s as any).recentReceptions) ? (s as any).recentReceptions : [];
              return formSampleFromLogs(logs, s.line, s.lean);
            };
            const sortKeyFor = (s: NflPropSnapshot) => {
              const form = formFor(s);
              const priced = s.hasMarket !== false;
              const edgePp = priced ? s.edge * 100 : -999;
              const prob = winPctOf(s);
              let key = 0;
              if (sortOrder === 'edge') key = priced ? edgePp : -999;
              else if (sortOrder === 'pct_desc') key = prob;
              else if (sortOrder === 'pct_asc') key = -prob;
              else if (sortOrder === 'combined') key = (priced ? edgePp : 0) * prob;
              else if (sortOrder === 'form') {
                const l10 = form?.l10HitRate ?? null;
                const l5 = form?.l5HitRate ?? null;
                key = l10 === null && l5 === null ? -1 : (l10 ?? l5 ?? 0) * 1000 + (l5 ?? 0) * 10 + (priced ? 1 : 0);
              } else if (sortOrder === 'process') {
                key = computeProcessScore(prob, edgePp, priced, form);
              }
              if (deprioritizeWeakForm && isWeakL10Form(form)) key -= 10000;
              return key;
            };
            return [...list].sort((a, b) => sortKeyFor(b) - sortKeyFor(a) || winPctOf(b) - winPctOf(a));
          };

          const displayedGames = searchQuery.trim()
            ? activeGames.filter(g => {
                const away = filterAndSortSnaps(getTeamRosterSnapshots(g, g.away), g);
                const home = filterAndSortSnaps(getTeamRosterSnapshots(g, g.home), g);
                return away.length + home.length > 0;
              })
            : activeGames;

          if (searchQuery.trim() && displayedGames.length === 0) {
            return (
              <div className="p-8 text-center text-[#8b97ac] bg-[#121824] rounded-2xl border border-[#222d3e]">
                <p className="font-semibold text-white">No players found matching "{searchQuery.trim()}".</p>
                <p className="text-xs text-[#556277] mt-1 font-mono">
                  Try searching by player name or team abbreviation{selectedDay !== 'ALL' ? ' (or switch to Whole Board)' : ''}.
                </p>
              </div>
            );
          }

          return displayedGames.map((game: NflGameContext) => {
            const awaySnaps = getTeamRosterSnapshots(game, game.away);
            const homeSnaps = getTeamRosterSnapshots(game, game.home);
            const visibleAway = filterAndSortSnaps(awaySnaps, game);
            const visibleHome = filterAndSortSnaps(homeSnaps, game);
            const totalVisible = visibleAway.length + visibleHome.length;
            const qualifiedCount = [...awaySnaps, ...homeSnaps].filter(s => s.cardStatus === 'BET').length;

            return (
              <div key={game.id} className="bg-[#121824] rounded-2xl border border-[#222d3e] overflow-hidden">
                {/* Matchup Header */}
                <div className="p-4 bg-[#182232] border-b border-[#222d3e] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold font-display uppercase tracking-wide text-white">
                        {game.away} @ {game.home}
                      </h2>
                      <span className="text-[10px] font-mono uppercase bg-[#0f1520] text-sky-300 px-2 py-0.5 rounded border border-[#222d3e]">
                        {game.day}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[#8b97ac] font-mono mt-0.5">
                      <span>{game.kickoff}</span>
                      <span>Spread: {game.home} {game.spread_home > 0 ? `+${game.spread_home}` : game.spread_home}</span>
                      <span>{game.hasLine === false ? 'No line yet' : `O/U: ${(game.implied_total_home + game.implied_total_away).toFixed(1)}`}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-[#0f1520] text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-900 font-semibold">
                      {qualifiedCount} PLAYs
                    </span>
                    <span className="font-mono text-xs bg-[#0f1520] text-[#8b97ac] px-2.5 py-1 rounded-full border border-[#222d3e]">
                      {awaySnaps.length + homeSnaps.length} Players on Board
                    </span>
                  </div>
                </div>

                {/* Team Columns of Props */}
                {totalVisible === 0 ? (
                  <div className="p-8 text-center text-[#8b97ac] font-mono text-xs">
                    No players match the current filter ({filterMode}) for this matchup.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                    {/* Away Team Column */}
                    <div>
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#222d3e]">
                        <h3 className="font-display uppercase tracking-wider text-sm font-bold text-white">
                          {game.away} <span className="font-mono text-xs text-[#8b97ac] font-normal">{game.spread_away > 0 ? `+${game.spread_away}` : game.spread_away}</span>
                        </h3>
                        <span className="text-[11px] font-mono text-[#8b97ac]">
                          {visibleAway.length} Receivers
                        </span>
                      </div>

                      {visibleAway.map(snap => (
                        <NflPropRow
                          key={snap.id}
                          snapshot={snap}
                          isBetPlaced={Boolean(bets[snap.id])}
                          isPotd={pickOfTheDay != null && pickOfTheDay.player === snap.player && Math.abs(pickOfTheDay.line - snap.line) < 1e-6}
                          onRecordBet={onRecordBet}
                          onUpdateLine={(pName, l, ov, un) => handleUpdateLine(game, pName, l, ov, un)}
                          teammates={awaySnaps}
                          variance={getNflMarketVariance(snap)}
                          onLogBet={onLogBet}
                        />
                      ))}
                    </div>

                    {/* Home Team Column */}
                    <div>
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#222d3e]">
                        <h3 className="font-display uppercase tracking-wider text-sm font-bold text-white">
                          {game.home} <span className="font-mono text-xs text-[#8b97ac] font-normal">{game.spread_home > 0 ? `+${game.spread_home}` : game.spread_home}</span>
                        </h3>
                        <span className="text-[11px] font-mono text-[#8b97ac]">
                          {visibleHome.length} Receivers
                        </span>
                      </div>

                      {visibleHome.map(snap => (
                        <NflPropRow
                          key={snap.id}
                          snapshot={snap}
                          isBetPlaced={Boolean(bets[snap.id])}
                          isPotd={pickOfTheDay != null && pickOfTheDay.player === snap.player && Math.abs(pickOfTheDay.line - snap.line) < 1e-6}
                          onRecordBet={onRecordBet}
                          onUpdateLine={(pName, l, ov, un) => handleUpdateLine(game, pName, l, ov, un)}
                          teammates={homeSnaps}
                          variance={getNflMarketVariance(snap)}
                          onLogBet={onLogBet}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
};
