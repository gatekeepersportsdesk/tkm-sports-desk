import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  ReferenceLine
} from 'recharts';
import { Crosshair, ArrowUpDown, Flame, TrendingDown, Target } from 'lucide-react';
import { NhlSkaterProjection, NhlPlayerSnapshot } from '../../types/nhl';
import { projectNhlSkater } from '../../model/nhl_engine';

interface Props {
  projections?: NhlSkaterProjection[];
  skaters?: Record<string, NhlPlayerSnapshot[]>;
}

interface TeamSogData {
  team: string;
  fullName: string;
  opp: string;
  totalShots: number;
  avgShotsPerSkater: number;
  skaterCount: number;
  forwardShots: number;
  defenseShots: number;
  topSkaters: Array<{ name: string; shots: number; pos: string }>;
}

const NHL_TEAM_NAMES: Record<string, string> = {
  ANA: 'Anaheim Ducks',
  BOS: 'Boston Bruins',
  BUF: 'Buffalo Sabres',
  CAR: 'Carolina Hurricanes',
  CBJ: 'Columbus Blue Jackets',
  CGY: 'Calgary Flames',
  CHI: 'Chicago Blackhawks',
  COL: 'Colorado Avalanche',
  DAL: 'Dallas Stars',
  DET: 'Detroit Red Wings',
  EDM: 'Edmonton Oilers',
  FLA: 'Florida Panthers',
  LAK: 'Los Angeles Kings',
  MIN: 'Minnesota Wild',
  MTL: 'Montreal Canadiens',
  NJD: 'New Jersey Devils',
  NSH: 'Nashville Predators',
  NYI: 'New York Islanders',
  NYR: 'New York Rangers',
  OTT: 'Ottawa Senators',
  PHI: 'Philadelphia Flyers',
  PIT: 'Pittsburgh Penguins',
  SEA: 'Seattle Kraken',
  SJS: 'San Jose Sharks',
  STL: 'St. Louis Blues',
  TBL: 'Tampa Bay Lightning',
  TOR: 'Toronto Maple Leafs',
  UTA: 'Utah Hockey Club',
  VAN: 'Vancouver Canucks',
  VGK: 'Vegas Golden Knights',
  WPG: 'Winnipeg Jets',
  WSH: 'Washington Capitals'
};

export const NhlSlateShotsChart: React.FC<Props> = ({ projections = [], skaters = {} }) => {
  const [sortBy, setSortBy] = useState<'high' | 'low' | 'alpha'>('high');
  const [metric, setMetric] = useState<'total' | 'avg'>('total');

  // Aggregate projections per team
  const teamData: TeamSogData[] = useMemo(() => {
    // 1. Gather all projected skaters either from direct projections or derived from skaters prop
    let skaterList: Array<{
      team: string;
      name: string;
      opp: string;
      sogMu: number;
      pos: string;
    }> = [];

    if (projections && projections.length > 0) {
      skaterList = projections.map(p => ({
        team: p.team,
        name: p.name,
        opp: p.opp || '',
        sogMu: p.sog.mu,
        pos: p.pos
      }));
    } else if (skaters && Object.keys(skaters).length > 0) {
      for (const [teamCode, teamSkaters] of Object.entries(skaters)) {
        if (!Array.isArray(teamSkaters)) continue;
        for (const s of teamSkaters) {
          const proj = projectNhlSkater(s, 'AVG');
          skaterList.push({
            team: teamCode,
            name: s.name,
            opp: 'OPP',
            sogMu: proj.sog.mu,
            pos: s.pos
          });
        }
      }
    }

    if (skaterList.length === 0) return [];

    // Group by team
    const byTeam = new Map<string, Array<{ name: string; opp: string; sogMu: number; pos: string }>>();
    for (const item of skaterList) {
      const code = item.team.toUpperCase().trim();
      if (!byTeam.has(code)) byTeam.set(code, []);
      byTeam.get(code)!.push(item);
    }

    const result: TeamSogData[] = [];
    byTeam.forEach((members, teamCode) => {
      const sorted = [...members].sort((a, b) => b.sogMu - a.sogMu);
      const total = sorted.reduce((acc, m) => acc + m.sogMu, 0);
      const forwardShots = sorted.filter(m => m.pos === 'F').reduce((acc, m) => acc + m.sogMu, 0);
      const defenseShots = sorted.filter(m => m.pos === 'D').reduce((acc, m) => acc + m.sogMu, 0);
      const opp = sorted[0]?.opp || '';

      result.push({
        team: teamCode,
        fullName: NHL_TEAM_NAMES[teamCode] || teamCode,
        opp,
        totalShots: parseFloat(total.toFixed(1)),
        avgShotsPerSkater: parseFloat((total / Math.max(1, sorted.length)).toFixed(2)),
        skaterCount: sorted.length,
        forwardShots: parseFloat(forwardShots.toFixed(1)),
        defenseShots: parseFloat(defenseShots.toFixed(1)),
        topSkaters: sorted.slice(0, 3).map(s => ({
          name: s.name,
          shots: parseFloat(s.sogMu.toFixed(1)),
          pos: s.pos
        }))
      });
    });

    return result;
  }, [projections, skaters]);

  // Sorted list for chart display
  const sortedData = useMemo(() => {
    const list = [...teamData];
    if (sortBy === 'high') {
      list.sort((a, b) => (metric === 'total' ? b.totalShots - a.totalShots : b.avgShotsPerSkater - a.avgShotsPerSkater));
    } else if (sortBy === 'low') {
      list.sort((a, b) => (metric === 'total' ? a.totalShots - b.totalShots : a.avgShotsPerSkater - b.avgShotsPerSkater));
    } else {
      list.sort((a, b) => a.team.localeCompare(b.team));
    }
    return list;
  }, [teamData, sortBy, metric]);

  // Slate overview stats
  const stats = useMemo(() => {
    if (teamData.length === 0) return null;
    const totals = teamData.map(t => t.totalShots);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const sortedByTotal = [...teamData].sort((a, b) => b.totalShots - a.totalShots);
    const leader = sortedByTotal[0];
    const trailer = sortedByTotal[sortedByTotal.length - 1];

    return {
      teamsCount: teamData.length,
      slateAvgShots: parseFloat(avg.toFixed(1)),
      leader,
      trailer
    };
  }, [teamData]);

  if (teamData.length === 0) {
    return (
      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] text-center text-slate-400 font-mono text-xs">
        No active NHL games or skater projections loaded for the current slate.
      </div>
    );
  }

  // Color thresholding helper
  const getBarColor = (val: number, avg: number, isHigh: boolean) => {
    if (isHigh) {
      if (val >= avg * 1.08) return '#06b6d4'; // High volume cyan
      if (val >= avg * 0.98) return '#38bdf8'; // Average sky blue
      return '#64748b'; // Low volume slate
    } else {
      if (val >= 2.5) return '#06b6d4';
      if (val >= 2.0) return '#38bdf8';
      return '#64748b';
    }
  };

  const slateAvg = stats?.slateAvgShots ?? 30;

  return (
    <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] mb-4">
      {/* Header and Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222d3e] pb-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-cyan-400" />
            <h3 className="text-base font-bold uppercase tracking-wide text-white">
              Slate Shot Volume Distribution (Projected Team SOG)
            </h3>
            <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] font-mono font-semibold">
              Recharts · {teamData.length} Teams
            </span>
          </div>
          <p className="text-xs text-[#8b97ac] mt-0.5">
            Model-projected aggregate shots on goal across all active teams on today's slate, adjusted for opponent suppression and context priors.
          </p>
        </div>

        {/* View toggles & Sort Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Metric Toggle */}
          <div className="flex items-center bg-[#0b0f14] p-0.5 rounded-lg border border-[#222d3e]">
            <button
              onClick={() => setMetric('total')}
              className={`px-2.5 py-1 text-xs font-mono rounded-md transition cursor-pointer ${
                metric === 'total' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              Total Team SOG
            </button>
            <button
              onClick={() => setMetric('avg')}
              className={`px-2.5 py-1 text-xs font-mono rounded-md transition cursor-pointer ${
                metric === 'avg' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              Avg / Skater
            </button>
          </div>

          {/* Sort Control */}
          <div className="flex items-center bg-[#0b0f14] p-0.5 rounded-lg border border-[#222d3e]">
            <span className="text-[10px] text-[#8b97ac] font-mono px-2 flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-cyan-400" /> Sort:
            </span>
            <button
              onClick={() => setSortBy('high')}
              className={`px-2 py-1 text-xs font-mono rounded-md transition cursor-pointer ${
                sortBy === 'high' ? 'bg-[#182232] text-cyan-300 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
              title="Highest shots first"
            >
              High
            </button>
            <button
              onClick={() => setSortBy('low')}
              className={`px-2 py-1 text-xs font-mono rounded-md transition cursor-pointer ${
                sortBy === 'low' ? 'bg-[#182232] text-cyan-300 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
              title="Lowest shots first"
            >
              Low
            </button>
            <button
              onClick={() => setSortBy('alpha')}
              className={`px-2 py-1 text-xs font-mono rounded-md transition cursor-pointer ${
                sortBy === 'alpha' ? 'bg-[#182232] text-cyan-300 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
              title="Alphabetical by team code"
            >
              A-Z
            </button>
          </div>
        </div>
      </div>

      {/* Overview Stat Strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4 font-mono text-xs">
          <div className="bg-[#0b0f14] p-2.5 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] text-[#8b97ac] uppercase block">Slate Shot Leader</span>
            <span className="text-white font-bold text-sm flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-cyan-400" />
              {stats.leader.team}
              <span className="text-cyan-400 text-xs font-semibold">({stats.leader.totalShots} SOG)</span>
            </span>
            <span className="text-[10px] text-[#556277] truncate block">
              Top: {stats.leader.topSkaters[0]?.name || '—'}
            </span>
          </div>

          <div className="bg-[#0b0f14] p-2.5 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] text-[#8b97ac] uppercase block">Slate Shot Low</span>
            <span className="text-white font-bold text-sm flex items-center gap-1">
              <TrendingDown className="w-3.5 h-3.5 text-slate-400" />
              {stats.trailer.team}
              <span className="text-slate-400 text-xs font-semibold">({stats.trailer.totalShots} SOG)</span>
            </span>
            <span className="text-[10px] text-[#556277] truncate block">
              vs {stats.trailer.opp || 'Opponent'}
            </span>
          </div>

          <div className="bg-[#0b0f14] p-2.5 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] text-[#8b97ac] uppercase block">Slate Team Average</span>
            <span className="text-amber-400 font-bold text-sm flex items-center gap-1">
              <Target className="w-3.5 h-3.5 text-amber-400" />
              {stats.slateAvgShots} SOG
            </span>
            <span className="text-[10px] text-[#556277] block">
              Across {stats.teamsCount} teams
            </span>
          </div>

          <div className="bg-[#0b0f14] p-2.5 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] text-[#8b97ac] uppercase block">Legend / Tier</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300">
                <span className="w-2 h-2 rounded-sm bg-cyan-400 inline-block" /> High
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-sky-300">
                <span className="w-2 h-2 rounded-sm bg-sky-400 inline-block" /> Avg
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                <span className="w-2 h-2 rounded-sm bg-slate-500 inline-block" /> Low
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Recharts Bar Chart */}
      <div className="h-64 sm:h-72 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={sortedData}
            margin={{ top: 16, right: 12, left: -10, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="team"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#222d3e' }}
              interval={0}
              angle={sortedData.length > 12 ? -45 : 0}
              textAnchor={sortedData.length > 12 ? 'end' : 'middle'}
              height={sortedData.length > 12 ? 35 : 20}
            />
            <YAxis
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#222d3e' }}
              unit={metric === 'total' ? ' ' : ''}
              domain={metric === 'total' ? [0, 'dataMax + 4'] : [0, 'dataMax + 0.5']}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const data = payload[0].payload as TeamSogData;
                return (
                  <div className="bg-[#0b0f14] border border-[#222d3e] p-3 rounded-xl shadow-2xl font-mono text-xs min-w-[210px] z-50">
                    <div className="flex items-center justify-between border-b border-[#222d3e] pb-1.5 mb-2">
                      <div>
                        <span className="font-bold text-white text-sm">{data.team}</span>
                        <span className="text-[10px] text-[#8b97ac] block">{data.fullName}</span>
                      </div>
                      {data.opp && (
                        <span className="px-1.5 py-0.5 rounded bg-[#182232] text-[#8b97ac] text-[10px]">
                          vs {data.opp}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1 mb-2">
                      <div className="flex items-center justify-between text-white font-semibold">
                        <span className="text-[#8b97ac]">Projected Team SOG:</span>
                        <span className="text-cyan-400 text-sm font-bold">{data.totalShots}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-[#8b97ac]">
                        <span>Avg / Skater ({data.skaterCount}):</span>
                        <span className="text-white">{data.avgShotsPerSkater} SOG</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-[#64748b] pt-0.5 border-t border-[#1e293b]">
                        <span>Fwd: {data.forwardShots} SOG</span>
                        <span>Def: {data.defenseShots} SOG</span>
                      </div>
                    </div>

                    {data.topSkaters.length > 0 && (
                      <div className="pt-1.5 border-t border-[#222d3e]">
                        <span className="text-[10px] uppercase text-[#8b97ac] font-bold block mb-1">
                          Top Shot Projections:
                        </span>
                        <div className="space-y-0.5">
                          {data.topSkaters.map((s, idx) => (
                            <div key={idx} className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-300 truncate max-w-[130px]">
                                {idx + 1}. {s.name}
                              </span>
                              <span className="text-cyan-300 font-semibold">{s.shots} SOG</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {metric === 'total' && (
              <ReferenceLine
                y={slateAvg}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{
                  value: `Slate Avg: ${slateAvg}`,
                  fill: '#f59e0b',
                  fontSize: 10,
                  position: 'top',
                  offset: 4
                }}
              />
            )}
            <Bar
              dataKey={metric === 'total' ? 'totalShots' : 'avgShotsPerSkater'}
              radius={[4, 4, 0, 0]}
              animationDuration={800}
            >
              {sortedData.map(entry => (
                <Cell
                  key={entry.team}
                  fill={getBarColor(
                    metric === 'total' ? entry.totalShots : entry.avgShotsPerSkater,
                    metric === 'total' ? slateAvg : 2.2,
                    metric === 'total'
                  )}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
