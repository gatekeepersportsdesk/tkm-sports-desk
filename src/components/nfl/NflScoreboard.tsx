import React, { useState } from 'react';
import { NflPropSnapshot, NflActualRecord, NflBetRecord } from '../../types/nfl';
import { parseOdds } from '../../model/nfl_engine';
import { summarizeCalibration, proportionMargin } from '../../model/calibration';
import { normalizePlayerName } from '../../lib/nflverse';
import { AlertTriangle, Download, Upload, RotateCcw, FileText, Archive } from 'lucide-react';
import { exportPdfNflReport } from '../../lib/pdf_report';
import { useDisplaySettings } from '../common/DisplaySettingsContext';
import { TrendAnalysisSection } from '../common/TrendAnalysisSection';
import { CardRow } from '../../lib/card_core';

interface NflScoreboardProps {
  snapshots: NflPropSnapshot[];
  actuals: Record<string, NflActualRecord>;
  bets: Record<string, NflBetRecord>;
  onExportJson: () => void;
  onImportJson: (json: string) => void;
  onReset: () => void;
  cardRows?: CardRow[];
  onClearHistory?: () => void;
}

export const NflScoreboard: React.FC<NflScoreboardProps> = ({
  snapshots,
  actuals,
  bets,
  onExportJson,
  onImportJson,
  onReset,
  cardRows = [],
  onClearHistory
}) => {
  const { displayCfg, formatProfit, formatStake } = useDisplaySettings();
  const [filter, setFilter] = useState<'all' | 'bets' | 'card' | 'skips'>('all');

  // Process rows with actuals and outcomes
  // Rows with no market price are model-only baselines: they are never logged,
  // graded or counted (they would flatter or pollute every metric).
  const pricedSnapshots = snapshots.filter(s => s.hasMarket !== false);
  const gradedRows = pricedSnapshots.map(s => {
    const gradeKey = `${s.season}-${s.week}-${normalizePlayerName(s.player)}`;
    const actualInfo = actuals[gradeKey];
    const bet = bets[s.id];

    let outcome: 'PENDING' | 'VOID' | 'PUSH' | 'OVER' | 'UNDER' = 'PENDING';
    let isCorrect: boolean | null = null;
    let brierModel: number | null = null;
    let brierMarket: number | null = null;
    let analysisReason = '';

    if (actualInfo) {
      if (!actualInfo.played) {
        outcome = 'VOID';
        analysisReason = `VOID: ${s.player} did not play or game was postponed.`;
      } else if (actualInfo.actual === s.line) {
        outcome = 'PUSH';
        analysisReason = `PUSH: Actual matched line of ${s.line} receptions exactly (Model μ ${s.mu.toFixed(1)}).`;
      } else {
        outcome = actualInfo.actual > s.line ? 'OVER' : 'UNDER';
        isCorrect = outcome === s.lean;
        const diff = actualInfo.actual - s.line;
        if (isCorrect) {
          if (s.lean === 'OVER') {
            analysisReason = `WON (OVER): Model predicted ${s.mu.toFixed(1)} rec vs line ${s.line}. Actual was ${actualInfo.actual} rec (+${diff.toFixed(1)}). Target volume and route participation met model projections.`;
          } else {
            analysisReason = `WON (UNDER): Model predicted ${s.mu.toFixed(1)} rec vs line ${s.line}. Actual was ${actualInfo.actual} rec (${Math.abs(diff).toFixed(1)} under line). Coverage bracket or low pass volume kept receptions in check.`;
          }
        } else {
          if (s.lean === 'OVER') {
            analysisReason = `LOST (OVER): Model predicted ${s.mu.toFixed(1)} rec vs line ${s.line}. Actual was ${actualInfo.actual} rec (${Math.abs(diff).toFixed(1)} short). Game script shifted to rushing or target distribution varied.`;
          } else {
            analysisReason = `LOST (UNDER): Model predicted ${s.mu.toFixed(1)} rec vs line ${s.line}. Actual was ${actualInfo.actual} rec (+${diff.toFixed(1)} over). Trailing pass volume exceeded baseline projection.`;
          }
        }
        const y = outcome === 'OVER' ? 1.0 : 0.0;
        brierModel = Math.pow(s.p_over - y, 2);
        // only a real two-way price gives a fair market benchmark
        brierMarket = s.twoWay === false || !Number.isFinite(s.fair_over) ? null : Math.pow(s.fair_over - y, 2);
      }
    }

    return {
      ...s,
      bet,
      outcome,
      isCorrect,
      brierModel,
      brierMarket,
      actual: actualInfo ? actualInfo.actual : null,
      played: actualInfo ? actualInfo.played : null,
      analysisReason
    };
  });

  // Filter scope
  const displayRows = gradedRows.filter(r => {
    if (filter === 'bets') return Boolean(r.bet);
    if (filter === 'card') return r.cardStatus === 'BET';
    if (filter === 'skips') return !r.bet;
    return true;
  });

  const gradedAll = gradedRows.filter(r => r.outcome === 'OVER' || r.outcome === 'UNDER');
  const gradedScope = displayRows.filter(r => r.outcome === 'OVER' || r.outcome === 'UNDER');

  const totalGraded = gradedAll.length;
  const hitsAll = gradedAll.filter(r => r.isCorrect).length;
  const hitRate = totalGraded > 0 ? (hitsAll / totalGraded) * 100 : null;

  const avgBrierModel = totalGraded > 0 ? gradedAll.reduce((a, b) => a + (b.brierModel || 0), 0) / totalGraded : null;
  const mktRows = gradedAll.filter(r => r.brierMarket !== null);
  const avgBrierMarket = mktRows.length > 0 ? mktRows.reduce((a, b) => a + (b.brierMarket || 0), 0) / mktRows.length : null;
  const calib = summarizeCalibration(
    gradedAll.map(r => ({
      p: r.p_over,
      y: (r.outcome === 'OVER' ? 1 : 0) as 0 | 1,
      pMarket: r.twoWay === false ? null : r.fair_over
    }))
  );

  // Real Bet Bankroll
  let realPnl = 0.0;
  let realStake = 0.0;
  gradedRows.forEach(r => {
    if (r.bet && (r.outcome === 'OVER' || r.outcome === 'UNDER')) {
      realStake += r.bet.stake;
      const dec = parseOdds(r.bet.odds_taken).dec;
      const won = r.outcome === r.bet.side.toUpperCase();
      realPnl += won ? r.bet.stake * (dec - 1.0) : -r.bet.stake;
    }
  });

  // Hypothetical PnL data points
  let cum = 0.0;
  const hypoPoints: number[] = [0.0];
  gradedScope.forEach(r => {
    const offeredOdds = r.lean === 'OVER' ? r.overOdds : r.underOdds;
    const dec = parseOdds(offeredOdds).dec;
    cum += r.isCorrect ? (dec - 1.0) : -1.0;
    hypoPoints.push(cum);
  });

  // Render SVG path for hypothetical chart
  const W = 360, H = 100, pad = 10;
  const minVal = Math.min(0, ...hypoPoints);
  const maxVal = Math.max(1, ...hypoPoints);
  const range = (maxVal - minVal) || 1;
  const pathCoords = hypoPoints.map((val, i) => {
    const x = pad + (i / (Math.max(1, hypoPoints.length - 1))) * (W - 2 * pad);
    const y = H - pad - ((val - minVal) / range) * (H - 2 * pad);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const zeroY = H - pad - ((0 - minVal) / range) * (H - 2 * pad);

  // Edge Buckets
  const bands = [
    { label: "0.0% to 2.9% (Pass)", min: 0.0, max: 0.03 },
    { label: "3.0% to 5.9% (Card)", min: 0.03, max: 0.06 },
    { label: "6.0%+ (Strong)", min: 0.06, max: 1.0 }
  ];

  // Current active daily card players & historical rows for trend analysis
  const currentCardPlayers = React.useMemo(() => {
    if (cardRows && cardRows.length > 0) {
      const pending = cardRows.filter(r => r.result === null);
      const pool = pending.length > 0 ? pending : cardRows;
      return pool.map(r => ({
        id: r.id,
        playerId: r.playerId,
        name: r.name,
        team: r.team,
        opp: r.opp,
        market: r.market,
        line: r.line,
        lean: r.lean,
        result: r.result,
        date: r.date
      }));
    }
    return pricedSnapshots.map(s => ({
      id: s.id,
      playerId: s.id,
      name: s.player,
      team: s.team,
      opp: s.gameKey || '—',
      market: 'receptions',
      line: s.line,
      lean: s.lean,
      result: null,
      date: `Week ${s.week}`
    }));
  }, [cardRows, pricedSnapshots]);

  const historicalCardRows = React.useMemo(() => {
    if (cardRows && cardRows.length > 0) {
      return cardRows
        .filter(r => r.result === 'HIT' || r.result === 'MISS' || r.result === 'PUSH')
        .map(r => ({
          id: r.id,
          playerId: r.playerId,
          name: r.name,
          team: r.team,
          opp: r.opp,
          market: r.market,
          line: r.line,
          lean: r.lean,
          result: r.result,
          actual: r.actual,
          date: r.date
        }));
    }
    return gradedRows
      .filter(r => r.outcome === 'OVER' || r.outcome === 'UNDER' || r.outcome === 'PUSH')
      .map(r => ({
        id: r.id,
        playerId: r.id,
        name: r.player,
        team: r.team,
        opp: r.gameKey || '—',
        market: 'receptions',
        line: r.line,
        lean: r.lean,
        result: (r.isCorrect ? 'HIT' : 'MISS') as 'HIT' | 'MISS',
        actual: r.actual,
        date: `Week ${r.week}`
      }));
  }, [cardRows, gradedRows]);

  return (
    <div className="space-y-4">
      <TrendAnalysisSection
        sportLabel="NFL"
        currentCard={currentCardPlayers}
        historicalCardRows={historicalCardRows}
        settledLedgerRows={gradedRows.map(r => ({
          playerId: r.id,
          playerName: r.player,
          market: 'receptions',
          line: r.line,
          lean: r.lean,
          actual: r.actual,
          result: r.outcome,
          date: `Week ${r.week}`
        }))}
        availableMarkets={['receptions']}
      />
      {/* Calibration (RotoBot-style: does a stated 60% really hit ~60%?) */}
      <div className="bg-[#121824] p-3.5 rounded-xl border border-[#222d3e]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] font-mono uppercase text-[#8b97ac]">Calibration · over probability vs outcome</span>
          <span className="text-[11px] font-mono text-[#556277]">
            {calib.n === 0 ? 'no graded priced lines yet' :
              `n=${calib.n} · ±${(proportionMargin(0.5, calib.n) * 100).toFixed(0)}pt sampling noise · mean p ${calib.meanP !== null ? (calib.meanP * 100).toFixed(1) : '—'}% vs hit ${calib.hitRate !== null ? (calib.hitRate * 100).toFixed(1) : '—'}%`}
          </span>
        </div>
        {calib.n > 0 && (
          <div className="mt-2 grid grid-cols-3 sm:grid-cols-7 gap-1.5 text-center font-mono text-[11px]">
            {calib.bins.map(b => (
              <div key={b.lo} className="bg-[#0f1520] rounded-lg border border-[#222d3e] py-1.5">
                <div className="text-[#556277]">{Math.round(b.lo * 100)}–{Math.min(100, Math.round(b.hi * 100))}%</div>
                <div className="text-white font-semibold">{b.hitRate !== null ? `${(b.hitRate * 100).toFixed(0)}%` : '—'}</div>
                <div className="text-[#556277]">n={b.n}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#121824] p-3.5 rounded-xl border border-[#222d3e]">
          <span className="text-[11px] font-mono uppercase text-[#8b97ac]">Lines Logged</span>
          <p className="text-2xl font-bold font-mono text-white mt-0.5">{pricedSnapshots.length}</p>
          <span className="text-xs text-[#556277] font-mono">{totalGraded} graded, {pricedSnapshots.length - totalGraded} pending/void/push</span>
        </div>
        <div className="bg-[#121824] p-3.5 rounded-xl border border-[#222d3e]">
          <span className="text-[11px] font-mono uppercase text-[#8b97ac]">Lean Hit Rate</span>
          <p className={`text-2xl font-bold font-mono mt-0.5 ${hitRate !== null && hitRate >= 50 ? 'text-emerald-400' : 'text-white'}`}>
            {hitRate !== null ? `${hitRate.toFixed(1)}%` : '—'}
          </p>
          <span className="text-xs text-[#556277] font-mono">{hitsAll} of {totalGraded} calls correct</span>
        </div>
        <div className="bg-[#121824] p-3.5 rounded-xl border border-[#222d3e]">
          <span className="text-[11px] font-mono uppercase text-[#8b97ac]">Brier Model vs Mkt</span>
          <p className="text-2xl font-bold font-mono text-sky-400 mt-0.5">
            {avgBrierModel !== null ? avgBrierModel.toFixed(3) : '—'}
          </p>
          <span className="text-xs text-[#556277] font-mono">Market baseline: {avgBrierMarket !== null ? avgBrierMarket.toFixed(3) : '—'}</span>
        </div>
        <div className="bg-[#121824] p-3.5 rounded-xl border border-[#222d3e]">
          <span className="text-[11px] font-mono uppercase text-[#8b97ac]">Realized Bet P&amp;L</span>
          <p className={`text-2xl font-bold font-mono mt-0.5 ${realPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {formatProfit(realPnl)}
          </p>
          <span className="text-xs text-[#556277] font-mono">On {formatStake(realStake)} actual staked</span>
        </div>
      </div>

      {/* Warning banner until >= 100 graded lines */}
      {totalGraded < 100 && (
        <div className="p-3 bg-amber-950/40 border border-amber-600/70 rounded-xl text-amber-200 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <b>Warning: Sample Size Too Small ({totalGraded} / 100 graded lines).</b> Hit rates and Brier differentials under 100 lines are dominated by variance and do not represent verified closing edge.
          </div>
        </div>
      )}

      {/* Filter Scope Pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-mono text-[#8b97ac] uppercase">Scope:</span>
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded-full text-xs font-mono font-medium transition ${
            filter === 'all' ? 'bg-sky-500 text-slate-950 font-semibold' : 'bg-[#121824] border border-[#222d3e] text-[#8b97ac] hover:text-white'
          }`}
        >
          All Calls ({snapshots.length})
        </button>
        <button
          onClick={() => setFilter('bets')}
          className={`px-3 py-1 rounded-full text-xs font-mono font-medium transition ${
            filter === 'bets' ? 'bg-sky-500 text-slate-950 font-semibold' : 'bg-[#121824] border border-[#222d3e] text-[#8b97ac] hover:text-white'
          }`}
        >
          Bets I Placed ({Object.keys(bets).length})
        </button>
        <button
          onClick={() => setFilter('card')}
          className={`px-3 py-1 rounded-full text-xs font-mono font-medium transition ${
            filter === 'card' ? 'bg-sky-500 text-slate-950 font-semibold' : 'bg-[#121824] border border-[#222d3e] text-[#8b97ac] hover:text-white'
          }`}
        >
          Qualified Card Plays
        </button>
        <button
          onClick={() => setFilter('skips')}
          className={`px-3 py-1 rounded-full text-xs font-mono font-medium transition ${
            filter === 'skips' ? 'bg-sky-500 text-slate-950 font-semibold' : 'bg-[#121824] border border-[#222d3e] text-[#8b97ac] hover:text-white'
          }`}
        >
          Passes / Skipped
        </button>
      </div>

      {/* Performance Grid: 1u Cumulative Chart + Edge Bucket Calibration */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Hypothetical 1u Cumulative PnL Chart */}
        <div className="bg-[#121824] p-4 rounded-xl border border-[#222d3e]">
          <h4 className="font-display uppercase tracking-wider text-sm font-bold text-white mb-2">
            Hypothetical 1u Cumulative P&amp;L (Every Call)
          </h4>
          <div className="h-28 flex items-center justify-center">
            {gradedScope.length === 0 ? (
              <span className="text-xs text-[#556277] font-mono">No graded lines in current scope.</span>
            ) : (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
                <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="#222d3e" strokeDasharray="3,3" />
                <path d={pathCoords} fill="none" stroke="#38bdf8" strokeWidth="2.2" />
              </svg>
            )}
          </div>
          <div className="text-[11px] text-[#8b97ac] font-mono mt-1">
            Flat {formatStake(1.0)} placed on model recommended side at offered de-vigged line. Current: <span className="text-white font-bold">{formatProfit(cum)}</span>
          </div>
        </div>

        {/* Edge Bucket Calibration Breakdown */}
        <div className="bg-[#121824] p-4 rounded-xl border border-[#222d3e]">
          <h4 className="font-display uppercase tracking-wider text-sm font-bold text-white mb-2">
            Edge Bucket Calibration
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[#222d3e] text-[#8b97ac] text-[11px]">
                  <th className="py-1.5 px-2">Edge Band</th>
                  <th className="py-1.5 px-2 text-right">Calls</th>
                  <th className="py-1.5 px-2 text-right">Hit Rate</th>
                  <th className="py-1.5 px-2 text-right">{displayCfg.mode === 'currency' ? '$ P&L' : '1u P&L'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222d3e]/50">
                {bands.map(b => {
                  const inBand = gradedScope.filter(r => r.edge >= b.min && r.edge < b.max);
                  const hits = inBand.filter(r => r.isCorrect).length;
                  const rate = inBand.length > 0 ? `${((hits / inBand.length) * 100).toFixed(1)}%` : '—';
                  let pnl1u = 0;
                  inBand.forEach(r => {
                    const dec = parseOdds(r.lean === 'OVER' ? r.overOdds : r.underOdds).dec;
                    pnl1u += r.isCorrect ? (dec - 1.0) : -1.0;
                  });

                  return (
                    <tr key={b.label}>
                      <td className="py-2 px-2 text-white">{b.label}</td>
                      <td className="py-2 px-2 text-right">{inBand.length}</td>
                      <td className="py-2 px-2 text-right">{rate}</td>
                      <td className={`py-2 px-2 text-right font-bold ${pnl1u >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {formatProfit(pnl1u)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Logged Line Ledger Table */}
      <div className="bg-[#121824] rounded-xl border border-[#222d3e] overflow-hidden">
        <div className="p-3 bg-[#182232] border-b border-[#222d3e] flex items-center justify-between">
          <h3 className="font-display uppercase tracking-wider text-sm font-bold text-white">
            Logged Line Ledger ({displayRows.length})
          </h3>
          <span className="text-xs font-mono text-[#8b97ac]">
            Append-only conceptual audit trail
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#222d3e] bg-[#0f1520] text-[#8b97ac] text-[11px] uppercase tracking-wider">
                <th className="py-2.5 px-3">Wk</th>
                <th className="py-2.5 px-3">Player</th>
                <th className="py-2.5 px-3">Team</th>
                <th className="py-2.5 px-3 text-right">Line</th>
                <th className="py-2.5 px-3 text-right">Odds</th>
                <th className="py-2.5 px-3 text-right">Model &mu;</th>
                <th className="py-2.5 px-3 text-right">Model %</th>
                <th className="py-2.5 px-3 text-right">Fair Mkt</th>
                <th className="py-2.5 px-3 text-center">Side</th>
                <th className="py-2.5 px-3 text-right">Edge</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Actual</th>
                <th className="py-2.5 px-3 text-center">Grade</th>
                <th className="py-2.5 px-3">Analysis &amp; Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222d3e]/60">
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-8 text-center text-[#556277]">
                    No prop lines recorded in this filter view.
                  </td>
                </tr>
              ) : (
                displayRows.map(r => {
                  let badge = <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px]">PENDING</span>;
                  if (r.outcome === 'VOID') badge = <span className="bg-amber-950 text-amber-400 px-2 py-0.5 rounded text-[10px] border border-amber-800">VOID</span>;
                  else if (r.outcome === 'PUSH') badge = <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px]">PUSH</span>;
                  else if (r.isCorrect === true) badge = <span className="bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded text-[10px] border border-emerald-600 font-bold">HIT</span>;
                  else if (r.isCorrect === false) badge = <span className="bg-rose-950 text-rose-400 px-2 py-0.5 rounded text-[10px] border border-rose-800 font-bold">MISS</span>;

                  return (
                    <tr key={r.id} className="hover:bg-[#182232]/50">
                      <td className="py-2 px-3 text-[#8b97ac]">W{r.week}</td>
                      <td className="py-2 px-3 font-bold text-white">{r.player} <span className="text-[10px] font-normal text-[#8b97ac]">{r.pos}</span></td>
                      <td className="py-2 px-3 text-[#8b97ac]">{r.team}</td>
                      <td className="py-2 px-3 text-right">{r.line}</td>
                      <td className="py-2 px-3 text-right text-[#8b97ac]">{r.overOdds}/{r.underOdds}</td>
                      <td className="py-2 px-3 text-right text-sky-400 font-bold">{r.mu.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right">{((r.lean === 'OVER' ? r.p_over : r.p_under) * 100).toFixed(1)}%</td>
                      <td className="py-2 px-3 text-right text-[#8b97ac]">{((r.lean === 'OVER' ? r.fair_over : r.fair_under) * 100).toFixed(1)}%</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.lean === 'OVER' ? 'text-emerald-400' : 'text-orange-400'}`}>
                          {r.lean}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-emerald-400 font-semibold">+{(r.edge * 100).toFixed(1)}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.cardStatus === 'BET' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600 font-bold' : 'text-slate-400'}`}>
                          {r.cardStatus}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-white font-bold">{r.actual !== null ? r.actual : '—'}</td>
                      <td className="py-2 px-3 text-center">{badge}</td>
                      <td className="py-2 px-3 max-w-xs text-[11px] text-[#8b97ac]">
                        {r.analysisReason || (r.outcome === 'PENDING' ? 'Awaiting game completion' : '—')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sync and JSON Backup Actions */}
      <div className="p-4 bg-[#121824] rounded-xl border border-[#222d3e] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div>
          <span className="text-white font-bold">Backup &amp; Python CLI Sync:</span>
          <span className="text-[#8b97ac] ml-2">Export or paste JSON to sync with automated terminal scripts.</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onExportJson}
            className="px-3 py-1.5 bg-[#182232] hover:bg-[#222d3e] text-sky-400 border border-sky-500/40 rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Export JSON
          </button>
          {onClearHistory && (
            <button
              onClick={onClearHistory}
              className="px-3 py-1.5 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-600/40 rounded-lg flex items-center gap-1.5 cursor-pointer"
              title="Archive and clear graded results older than 30 days to free browser storage"
            >
              <Archive className="w-3.5 h-3.5 text-amber-400" /> Clear old history (&gt;30d)
            </button>
          )}
          <button
            onClick={() => exportPdfNflReport(snapshots, actuals)}
            className="px-3 py-1.5 bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-200 border border-cyan-500/50 rounded-lg flex items-center gap-1.5 cursor-pointer"
            title="Download formatted summary PDF of daily betting performance"
          >
            <FileText className="w-3.5 h-3.5 text-cyan-400" /> Download PDF Report
          </button>
          <button
            onClick={() => {
              const str = prompt("Paste full database JSON (or prop_logger export):");
              if (str) onImportJson(str);
            }}
            className="px-3 py-1.5 bg-[#182232] hover:bg-[#222d3e] text-white border border-[#222d3e] rounded-lg flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" /> Import JSON
          </button>
          <button
            onClick={onReset}
            className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-lg flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Demo
          </button>
        </div>
      </div>
    </div>
  );
};
