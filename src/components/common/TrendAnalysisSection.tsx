import React, { useState, useMemo } from 'react';
import {
  PlayerTrend,
  TrendAnalysisSummary,
  analyzeDailyCardTrends,
  CurrentCardPlayer,
  HistoricalSettledRow
} from '../../lib/trend_analysis';
import { TrendingUp, Flame, Snowflake, Search, Filter, Sparkles, Check, X, Minus } from 'lucide-react';

interface Props {
  sportLabel: string;
  currentCard: CurrentCardPlayer[];
  historicalCardRows?: CurrentCardPlayer[];
  settledLedgerRows?: HistoricalSettledRow[];
  playerStatLogs?: Record<string | number, Record<string, number[]>>;
  availableMarkets?: string[];
}

export const TrendAnalysisSection: React.FC<Props> = ({
  sportLabel,
  currentCard,
  historicalCardRows = [],
  settledLedgerRows = [],
  playerStatLogs = {},
  availableMarkets
}) => {
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [consistentOnly, setConsistentOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const summary: TrendAnalysisSummary = useMemo(() => {
    return analyzeDailyCardTrends({
      currentCard,
      historicalCardRows,
      settledLedgerRows,
      playerStatLogs,
      minGames: 3,
      consistentThreshold: 0.70
    });
  }, [currentCard, historicalCardRows, settledLedgerRows, playerStatLogs]);

  // Unique markets detected in trends
  const markets = useMemo(() => {
    if (availableMarkets && availableMarkets.length > 0) return availableMarkets;
    const s = new Set<string>();
    for (const t of summary.trends) {
      s.add(t.market);
    }
    return Array.from(s);
  }, [summary.trends, availableMarkets]);

  // Filtered trends based on user selections
  const filteredTrends = useMemo(() => {
    return summary.trends.filter(t => {
      if (marketFilter !== 'all' && t.market.toLowerCase() !== marketFilter.toLowerCase()) {
        return false;
      }
      if (consistentOnly && !t.isConsistent) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = t.playerName.toLowerCase().includes(q);
        const matchesTeam = t.team.toLowerCase().includes(q) || t.opp.toLowerCase().includes(q);
        if (!matchesName && !matchesTeam) return false;
      }
      return true;
    });
  }, [summary.trends, marketFilter, consistentOnly, searchQuery]);

  return (
    <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222d3e] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base sm:text-lg font-bold uppercase tracking-wide text-white">
              {sportLabel} Last 10 Games Trend Analysis
            </h2>
            <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 text-[10px] font-mono font-semibold">
              L10 Hit Rate
            </span>
          </div>
          <p className="text-xs text-[#8b97ac] mt-1">
            Tracking recent 10-game hit rates and active streaks for players on today's daily card to isolate consistent, high-probability performers.
          </p>
        </div>

        {/* Quick summary badges */}
        <div className="flex items-center gap-2">
          <div className="bg-[#0f1520] px-3 py-1.5 rounded-xl border border-[#222d3e] text-xs font-mono">
            <span className="text-[#8b97ac] mr-1.5">Consistent (≥70%):</span>
            <span className="text-emerald-400 font-bold">{summary.consistentCount}</span>
            <span className="text-[#556277] mx-1">/</span>
            <span className="text-white">{summary.totalAnalyzed}</span>
          </div>
          {summary.eliteCount > 0 && (
            <div className="bg-amber-950/40 px-3 py-1.5 rounded-xl border border-amber-800/60 text-xs font-mono text-amber-300 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span>{summary.eliteCount} Elite (≥80%)</span>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
          <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Card Players Analyzed</span>
          <p className="text-xl sm:text-2xl font-bold font-mono text-white mt-0.5">
            {summary.totalAnalyzed}
          </p>
          <span className="text-[10px] text-[#556277] font-mono">from active daily board</span>
        </div>

        <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
          <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Consistent Performers</span>
          <p className="text-xl sm:text-2xl font-bold font-mono text-emerald-400 mt-0.5">
            {summary.consistentCount}
          </p>
          <span className="text-[10px] text-[#556277] font-mono">≥ 70% hit rate in L10</span>
        </div>

        <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
          <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Avg Card L10 Hit Rate</span>
          <p className="text-xl sm:text-2xl font-bold font-mono text-cyan-300 mt-0.5">
            {summary.totalAnalyzed > 0 ? `${summary.avgL10HitRate}%` : '—'}
          </p>
          <span className="text-[10px] text-[#556277] font-mono">across all analyzed props</span>
        </div>

        <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
          <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Active Streaks</span>
          <p className="text-xl sm:text-2xl font-bold font-mono text-amber-400 mt-0.5">
            {summary.trends.filter(t => t.streak >= 3).length}
          </p>
          <span className="text-[10px] text-[#556277] font-mono">players with 3+ straight hits</span>
        </div>
      </div>

      {/* Top Consistent Performers Spotlight Showcase */}
      {summary.consistentPerformers.length > 0 && (
        <div className="bg-[#0b0f14] p-4 rounded-xl border border-[#222d3e]">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-white">
              Featured Consistent Performers (Top L10 Hit Rates)
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {summary.consistentPerformers.slice(0, 6).map(p => (
              <div
                key={`${p.playerId}-${p.market}`}
                className="bg-[#121824] p-3 rounded-xl border border-[#222d3e] hover:border-emerald-600/50 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-bold text-white text-xs block leading-tight">{p.playerName}</span>
                    <span className="text-[11px] text-[#8b97ac] font-mono">
                      {p.team} vs {p.opp} · <span className="text-cyan-300 font-semibold">{p.marketLabel}</span>
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap ${
                      p.consistencyTier === 'elite'
                        ? 'bg-amber-950 text-amber-300 border border-amber-700'
                        : 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    }`}
                  >
                    {p.hitRatePct}% ({p.hits}/{p.sampleSize})
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] font-mono border-t border-[#182232] pt-2">
                  <div className="text-[#8b97ac]">
                    Line: <span className="text-white font-bold">{p.currentLean} {p.currentLine}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {p.streakType === 'W' && p.streakCount >= 2 ? (
                      <span className="text-emerald-400 flex items-center gap-0.5 text-[10px] font-bold">
                        <Flame className="w-3 h-3 text-amber-400" /> {p.streakCount}W Streak
                      </span>
                    ) : (
                      <span className="text-[#556277] text-[10px]">Avg {p.avgActual}</span>
                    )}
                  </div>
                </div>

                {/* Outcome dots */}
                <div className="mt-2 flex items-center gap-1">
                  <span className="text-[9px] text-[#556277] font-mono mr-1">L10:</span>
                  {p.recentOutcomes.map((out, idx) => (
                    <span
                      key={idx}
                      className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold ${
                        out === 'HIT'
                          ? 'bg-emerald-500 text-slate-950'
                          : out === 'PUSH'
                          ? 'bg-slate-600 text-slate-200'
                          : 'bg-rose-950 text-rose-400 border border-rose-800'
                      }`}
                      title={`Game ${idx + 1}: ${out}`}
                    >
                      {out === 'HIT' ? '✓' : out === 'PUSH' ? 'P' : '×'}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0b0f14] p-3 rounded-xl border border-[#222d3e]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono text-[#8b97ac] flex items-center gap-1">
            <Filter className="w-3 h-3" /> Market:
          </span>
          <button
            onClick={() => setMarketFilter('all')}
            className={`px-2.5 py-1 text-xs font-mono rounded-lg transition cursor-pointer ${
              marketFilter === 'all'
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-[#182232] text-[#8b97ac] hover:text-white'
            }`}
          >
            All Markets
          </button>
          {markets.map(m => (
            <button
              key={m}
              onClick={() => setMarketFilter(m)}
              className={`px-2.5 py-1 text-xs font-mono rounded-lg transition cursor-pointer ${
                marketFilter.toLowerCase() === m.toLowerCase()
                  ? 'bg-cyan-500 text-slate-950 font-bold'
                  : 'bg-[#182232] text-[#8b97ac] hover:text-white'
              }`}
            >
              {m.toUpperCase()}
            </button>
          ))}

          <div className="h-4 w-px bg-[#222d3e] mx-1" />

          {/* Consistent Only Toggle */}
          <button
            onClick={() => setConsistentOnly(!consistentOnly)}
            className={`px-2.5 py-1 text-xs font-mono rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              consistentOnly
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'bg-[#182232] text-[#8b97ac] hover:text-white'
            }`}
          >
            <Flame className="w-3 h-3" /> Consistent Only (≥70%)
          </button>
        </div>

        {/* Search input */}
        <div className="relative min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-[#556277] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search player or team..."
            className="w-full bg-[#182232] text-xs font-mono text-white placeholder-[#556277] pl-8 pr-2.5 py-1.5 rounded-lg border border-[#222d3e] focus:outline-none focus:border-cyan-500 transition"
          />
        </div>
      </div>

      {/* Main Trends Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-[#222d3e] text-[#8b97ac] uppercase tracking-wider text-[11px]">
              <th className="py-2.5 px-3">Player</th>
              <th className="py-2.5 px-3">Matchup</th>
              <th className="py-2.5 px-3">Market</th>
              <th className="py-2.5 px-3 text-right">Card Line</th>
              <th className="py-2.5 px-3 text-right">L10 Hit Rate</th>
              <th className="py-2.5 px-3 text-center">Last 10 Outcomes (Newest → Oldest)</th>
              <th className="py-2.5 px-3 text-center">Streak</th>
              <th className="py-2.5 px-3 text-right">L10 Stat Avg</th>
              <th className="py-2.5 px-3 text-center">Consistency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#222d3e]/50">
            {filteredTrends.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-[#556277]">
                  {summary.totalAnalyzed === 0
                    ? `No active players currently loaded in the ${sportLabel} daily card or awaiting settled box scores.`
                    : 'No players match the current filters. Adjust your market or consistency selection.'}
                </td>
              </tr>
            ) : (
              filteredTrends.map(t => {
                const isOver = t.currentLean === 'OVER';
                return (
                  <tr key={`${t.playerId}-${t.market}`} className="hover:bg-[#182232]/50 transition">
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className="font-bold text-white">{t.playerName}</span>
                    </td>
                    <td className="py-2 px-3 text-[#8b97ac] whitespace-nowrap">
                      {t.team} <span className="text-[#556277]">vs</span> {t.opp}
                    </td>
                    <td className="py-2 px-3 font-semibold text-cyan-300 whitespace-nowrap">
                      {t.marketLabel}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mr-1 ${
                        isOver ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/60' : 'bg-sky-950/70 text-sky-300 border border-sky-700/60'
                      }`}>
                        {t.currentLean}
                      </span>
                      <span className="font-bold text-white">{t.currentLine}</span>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <span className={`font-bold font-mono text-sm ${
                        t.hitRate >= 0.70 ? 'text-emerald-400' : t.hitRate >= 0.50 ? 'text-white' : 'text-rose-400'
                      }`}>
                        {t.hitRatePct}%
                      </span>
                      <span className="text-[#556277] text-[10px] ml-1">
                        ({t.hits}/{t.sampleSize})
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        {t.recentOutcomes.map((out, idx) => (
                          <span
                            key={idx}
                            className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold ${
                              out === 'HIT'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-600/60'
                                : out === 'PUSH'
                                ? 'bg-slate-700/40 text-slate-300 border border-slate-600'
                                : 'bg-rose-950/40 text-rose-400 border border-rose-800/60'
                            }`}
                            title={`Game ${idx + 1}: ${out}`}
                          >
                            {out === 'HIT' ? <Check className="w-2.5 h-2.5" /> : out === 'PUSH' ? <Minus className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      {t.streakType === 'W' ? (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700">
                          {t.streakCount >= 3 && <Flame className="w-3 h-3 text-amber-400 shrink-0" />}
                          {t.streakCount}W
                        </span>
                      ) : t.streakType === 'L' ? (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/80 text-rose-300 border border-rose-800">
                          {t.streakCount >= 3 && <Snowflake className="w-3 h-3 text-sky-400 shrink-0" />}
                          {t.streakCount}L
                        </span>
                      ) : (
                        <span className="text-[#556277]">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <span className="font-bold text-white">{t.avgActual}</span>
                      <span className={`text-[10px] ml-1 ${t.lineDiff >= 0 ? 'text-emerald-400' : 'text-[#8b97ac]'}`}>
                        ({t.lineDiff >= 0 ? `+${t.lineDiff}` : t.lineDiff})
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          t.consistencyTier === 'elite'
                            ? 'bg-amber-950 text-amber-300 border-amber-600'
                            : t.consistencyTier === 'hot'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                            : t.consistencyTier === 'consistent'
                            ? 'bg-sky-950 text-sky-300 border-sky-700'
                            : t.consistencyTier === 'cold'
                            ? 'bg-rose-950 text-rose-400 border-rose-800'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {t.consistencyBadge}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
