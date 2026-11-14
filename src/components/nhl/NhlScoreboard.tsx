import React, { useState, useMemo } from 'react';
import { NhlLedgerRow, NhlMarket } from '../../types/nhl';
import { Download, Upload, ClipboardCheck, RotateCcw, CheckCircle2, XCircle, Clock, FileText, Archive } from 'lucide-react';
import { exportPdfNhlReport } from '../../lib/pdf_report';
import { summarizeCalibration, proportionMargin, discretePit, pitCoverage, hashUnit } from '../../model/calibration';
import { nbinomPmf, ledgerUnits } from '../../model/nhl_engine';
import { fmtAmerican } from '../../lib/odds';
import { useDisplaySettings } from '../common/DisplaySettingsContext';
import { TrendAnalysisSection } from '../common/TrendAnalysisSection';
import { CardRow } from '../../lib/card_core';
import { NhlPlayerSnapshot, NhlSkaterProjection } from '../../types/nhl';
import { normalizeName } from '../../lib/trend_analysis';
import { NhlSlateShotsChart } from './NhlSlateShotsChart';
import { PickerHistoryPanel } from '../common/PickerHistoryPanel';

interface Props {
  rows: NhlLedgerRow[];
  gradeStatus: string;
  onGrade: () => void;
  onClearResults: () => void;
  onExportJson: () => void;
  onImportJson: (json: string) => void;
  onClearHistory?: () => void;
  cardRows?: CardRow[];
  skaters?: Record<string, NhlPlayerSnapshot[]>;
  projections?: NhlSkaterProjection[];
}

const pctS = (x: number | null, d = 1) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);

export const NhlScoreboard: React.FC<Props> = ({
  rows,
  gradeStatus,
  onGrade,
  onClearResults,
  onExportJson,
  onImportJson,
  onClearHistory,
  cardRows = [],
  skaters,
  projections
}) => {
  const { formatProfit } = useDisplaySettings();
  const [filter, setFilter] = useState<'all' | 'won' | 'lost' | 'pending' | 'bets'>('all');
  const [mktFilter, setMktFilter] = useState<NhlMarket | 'all'>('all');
  const [showCalibrationDetails, setShowCalibrationDetails] = useState(false);

  // Extract direct skater stat logs (10-game shots and points arrays)
  const playerStatLogs = useMemo(() => {
    const map: Record<string | number, Record<string, number[]>> = {};
    if (skaters) {
      for (const teamSkaters of Object.values(skaters)) {
        if (!Array.isArray(teamSkaters)) continue;
        for (const s of teamSkaters) {
          const stats: Record<string, number[]> = {};
          if (s.recentShots && s.recentShots.length > 0) stats['sog'] = s.recentShots;
          if (s.recentPoints && s.recentPoints.length > 0) stats['pts'] = s.recentPoints;
          map[s.playerId] = stats;
          map[normalizeName(s.name)] = stats;
        }
      }
    }
    return map;
  }, [skaters]);

  // Current active daily card players
  const currentCardPlayers = useMemo(() => {
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
    return rows.filter(r => !r.demo).map(r => ({
      id: r.id,
      playerId: r.playerId,
      name: r.playerName,
      team: r.team,
      opp: r.opp,
      market: r.market,
      line: r.line,
      lean: (r.side ? (r.side.toUpperCase() as 'OVER' | 'UNDER') : 'OVER'),
      result: r.result === 'OVER' || r.result === 'UNDER' ? (r.predictionHit ? 'HIT' : 'MISS') : (r.result as any),
      date: r.date
    }));
  }, [cardRows, rows]);

  const historicalCardRows = useMemo(() => {
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
  }, [cardRows]);

  const real = rows.filter(r => !r.demo);
  const demoCount = rows.length - real.length;
  const pending = real.filter(r => r.result === null).length;
  const voided = real.filter(r => r.result === 'VOID').length;
  const pushed = real.filter(r => r.result === 'PUSH').length;
  const decided = real.filter(r => r.result === 'OVER' || r.result === 'UNDER');

  // Self-grading prediction metrics
  const predictionStats = useMemo(() => {
    const decidedRows = real.filter(r => r.result === 'OVER' || r.result === 'UNDER');
    let won = 0;
    let lost = 0;
    let overWon = 0;
    let overTotal = 0;
    let underWon = 0;
    let underTotal = 0;
    let absErrorSum = 0;
    let gradedWithActual = 0;

    for (const r of decidedRows) {
      const lean = r.modelLean ?? (r.side ? (r.side.toUpperCase() as 'OVER' | 'UNDER') : (r.modelMu >= r.line ? 'OVER' : 'UNDER'));
      const isWon = r.predictionHit === true || (r.predictionHit === undefined && r.result === lean);

      if (isWon) {
        won++;
        if (lean === 'OVER') overWon++;
        else underWon++;
      } else {
        lost++;
      }

      if (lean === 'OVER') overTotal++;
      else underTotal++;

      if (r.actual !== null) {
        absErrorSum += Math.abs(r.actual - r.modelMu);
        gradedWithActual++;
      }
    }

    const totalDecided = won + lost;
    const hitRate = totalDecided > 0 ? (won / totalDecided) * 100 : null;
    const overRate = overTotal > 0 ? (overWon / overTotal) * 100 : null;
    const underRate = underTotal > 0 ? (underWon / underTotal) * 100 : null;
    const mae = gradedWithActual > 0 ? absErrorSum / gradedWithActual : null;

    return { won, lost, totalDecided, hitRate, overWon, overTotal, overRate, underWon, underTotal, underRate, mae };
  }, [real]);

  const calibFor = (m: NhlMarket | 'all') =>
    summarizeCalibration(
      decided.filter(r => m === 'all' || r.market === m).map(r => ({
        p: r.probOver,
        y: (r.result === 'OVER' ? 1 : 0) as 0 | 1,
        pMarket: r.pMarketOver
      }))
    );
  const calib = calibFor('all');
  const calibSog = calibFor('sog');
  const calibPts = calibFor('pts');

  // Interval coverage (does the stated 80% band contain ~80% of outcomes?)
  const cover = (m: NhlMarket) =>
    pitCoverage(
      real.filter(r => r.market === m && r.actual !== null && (r.result === 'OVER' || r.result === 'UNDER' || r.result === 'PUSH'))
        .map(r => discretePit(k => nbinomPmf(k, r.modelMu, r.r), r.actual as number, hashUnit(r.id)))
    );
  const covSog = cover('sog');
  const covPts = cover('pts');

  const plays = decided.filter(r => r.tag !== 'PASS');
  const units = plays.reduce((s, r) => s + (ledgerUnits(r) ?? 0), 0);
  const wins = plays.filter(r => (r.side === 'over' && r.result === 'OVER') || (r.side === 'under' && r.result === 'UNDER')).length;
  const roi = plays.length ? units / plays.length : null;

  const meanMu = (m: NhlMarket) => {
    const g = real.filter(r => r.market === m && r.actual !== null);
    return g.length ? { mu: g.reduce((s, r) => s + r.modelMu, 0) / g.length, act: g.reduce((s, r) => s + (r.actual as number), 0) / g.length, n: g.length } : null;
  };
  const muSog = meanMu('sog');
  const muPts = meanMu('pts');

  // Filtered rows for display
  const displayRows = useMemo(() => {
    return real.filter(r => {
      if (mktFilter !== 'all' && r.market !== mktFilter) return false;
      const lean = r.modelLean ?? (r.side ? (r.side.toUpperCase() as 'OVER' | 'UNDER') : (r.modelMu >= r.line ? 'OVER' : 'UNDER'));
      const isWon = r.predictionHit === true || (r.predictionHit === undefined && (r.result === 'OVER' || r.result === 'UNDER') && r.result === lean);
      const isLost = r.predictionHit === false || (r.predictionHit === undefined && (r.result === 'OVER' || r.result === 'UNDER') && r.result !== lean);

      if (filter === 'won') return isWon;
      if (filter === 'lost') return isLost;
      if (filter === 'pending') return r.result === null;
      if (filter === 'bets') return r.tag !== 'PASS';
      return true;
    });
  }, [real, filter, mktFilter]);

  return (
    <div className="space-y-4">
      <PickerHistoryPanel sport="nhl" sportLabel="NHL" />
      <TrendAnalysisSection
        sportLabel="NHL"
        currentCard={currentCardPlayers}
        historicalCardRows={historicalCardRows}
        settledLedgerRows={rows}
        playerStatLogs={playerStatLogs}
        availableMarkets={['sog', 'pts']}
      />
      <NhlSlateShotsChart projections={projections} skaters={skaters} />
      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e]">
        {/* Header & Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222d3e] pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold uppercase tracking-wide text-white">NHL Performance &amp; Self-Grading Engine</h2>
              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] font-mono font-semibold">
                Auto-Graded
              </span>
            </div>
            <p className="text-xs text-[#8b97ac] mt-0.5">
              Every model prediction is graded against official NHL box scores with reasoning, regardless of whether bets were placed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onGrade} className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold uppercase tracking-wider text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer">
              <ClipboardCheck className="w-4 h-4" /> Grade from box scores
            </button>
            <button onClick={onExportJson} className="px-3.5 py-2 bg-[#182232] hover:bg-[#222d3e] text-white border border-[#222d3e] text-xs font-mono rounded-xl flex items-center gap-1.5 cursor-pointer">
              <Download className="w-3.5 h-3.5" /> Export JSON
            </button>
            <button
              onClick={() => exportPdfNhlReport(rows)}
              className="px-3.5 py-2 bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-200 border border-cyan-500/50 text-xs font-mono rounded-xl flex items-center gap-1.5 transition cursor-pointer"
              title="Download formatted summary PDF of daily betting performance"
            >
              <FileText className="w-3.5 h-3.5 text-cyan-400" /> Download PDF Report
            </button>
            {onClearHistory && (
              <button
                onClick={onClearHistory}
                className="px-3.5 py-2 bg-purple-950/70 hover:bg-purple-900/80 text-purple-200 border border-purple-800/60 text-xs font-mono rounded-xl flex items-center gap-1.5 transition cursor-pointer"
                title="Downloads an archive of entries older than 30 days and removes them from storage"
              >
                <Archive className="w-3.5 h-3.5 text-purple-400" /> Clear old history (&gt;30d)
              </button>
            )}
          </div>
        </div>
        {gradeStatus && <div className="mb-3 text-[11px] font-mono text-cyan-300 bg-cyan-950/40 p-2 rounded-lg border border-cyan-800/50">{gradeStatus}</div>}
        {demoCount > 0 && (
          <div className="mb-3 text-[11px] font-mono text-amber-300 bg-amber-950/40 border border-amber-800 rounded-lg px-3 py-2">
            {demoCount} legacy/simulated row(s) are excluded from every number below.
          </div>
        )}

        {/* Self-Grading KPI Performance Dashboard */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Model Prediction Win Rate</span>
            <p className={`text-2xl font-bold font-mono mt-0.5 ${predictionStats.hitRate !== null && predictionStats.hitRate >= 52.4 ? 'text-emerald-400' : 'text-white'}`}>
              {predictionStats.hitRate !== null ? `${predictionStats.hitRate.toFixed(1)}%` : '—'}
            </p>
            <span className="text-[10px] text-[#556277] font-mono">
              {predictionStats.won} won · {predictionStats.lost} lost ({predictionStats.totalDecided} decided)
            </span>
          </div>

          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Over vs Under Accuracy</span>
            <p className="text-lg font-bold font-mono text-white mt-0.5">
              <span className="text-emerald-400">O: {predictionStats.overRate !== null ? `${predictionStats.overRate.toFixed(0)}%` : '—'}</span>
              <span className="text-[#556277] mx-1">/</span>
              <span className="text-sky-400">U: {predictionStats.underRate !== null ? `${predictionStats.underRate.toFixed(0)}%` : '—'}</span>
            </p>
            <span className="text-[10px] text-[#556277] font-mono">
              Over {predictionStats.overWon}/{predictionStats.overTotal} · Under {predictionStats.underWon}/{predictionStats.underTotal}
            </span>
          </div>

          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Mean Abs Error (MAE)</span>
            <p className="text-2xl font-bold font-mono text-cyan-300 mt-0.5">
              {predictionStats.mae !== null ? `±${predictionStats.mae.toFixed(2)}` : '—'}
            </p>
            <span className="text-[10px] text-[#556277] font-mono">Avg stat deviation vs model μ</span>
          </div>

          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Qualified Plays (STAB/FADE)</span>
            <p className={`text-2xl font-bold font-mono mt-0.5 ${units > 0 ? 'text-emerald-400' : 'text-white'}`}>
              {plays.length ? `${wins}-${plays.length - wins}` : '—'} · {plays.length ? formatProfit(units) : ''}
            </p>
            <span className="text-[10px] text-[#556277] font-mono">ROI {roi === null ? '—' : `${(roi * 100).toFixed(1)}%`} on placed edge bets</span>
          </div>

          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Ledger Status</span>
            <p className="text-xl font-bold font-mono text-white mt-0.5">{real.length} logged</p>
            <span className="text-[10px] text-[#556277] font-mono">{pending} pending · {pushed} push · {voided} void</span>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0b0f14] p-3 rounded-xl border border-[#222d3e] mb-4">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-mono text-[#8b97ac] mr-1">Result:</span>
            <button onClick={() => setFilter('all')}
              className={`px-2.5 py-1 text-xs font-mono rounded-lg transition cursor-pointer ${filter === 'all' ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#182232] text-[#8b97ac] hover:text-white'}`}>
              All ({real.length})
            </button>
            <button onClick={() => setFilter('won')}
              className={`px-2.5 py-1 text-xs font-mono rounded-lg transition cursor-pointer flex items-center gap-1 ${filter === 'won' ? 'bg-emerald-500 text-slate-950 font-bold' : 'bg-[#182232] text-emerald-400 hover:text-emerald-300'}`}>
              <CheckCircle2 className="w-3 h-3" /> Won ({predictionStats.won})
            </button>
            <button onClick={() => setFilter('lost')}
              className={`px-2.5 py-1 text-xs font-mono rounded-lg transition cursor-pointer flex items-center gap-1 ${filter === 'lost' ? 'bg-rose-500 text-slate-950 font-bold' : 'bg-[#182232] text-rose-400 hover:text-rose-300'}`}>
              <XCircle className="w-3 h-3" /> Missed ({predictionStats.lost})
            </button>
            <button onClick={() => setFilter('pending')}
              className={`px-2.5 py-1 text-xs font-mono rounded-lg transition cursor-pointer flex items-center gap-1 ${filter === 'pending' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#182232] text-amber-400 hover:text-amber-300'}`}>
              <Clock className="w-3 h-3" /> Pending ({pending})
            </button>
            <button onClick={() => setFilter('bets')}
              className={`px-2.5 py-1 text-xs font-mono rounded-lg transition cursor-pointer ${filter === 'bets' ? 'bg-sky-500 text-slate-950 font-bold' : 'bg-[#182232] text-sky-400 hover:text-sky-300'}`}>
              Edge Plays ({plays.length})
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-mono text-[#8b97ac] mr-1">Market:</span>
            <button onClick={() => setMktFilter('all')}
              className={`px-2 py-0.5 text-xs font-mono rounded-lg transition cursor-pointer ${mktFilter === 'all' ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#182232] text-[#8b97ac]'}`}>
              All
            </button>
            <button onClick={() => setMktFilter('sog')}
              className={`px-2 py-0.5 text-xs font-mono rounded-lg transition cursor-pointer ${mktFilter === 'sog' ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#182232] text-[#8b97ac] hover:text-white'}`}>
              Shots (SOG)
            </button>
            <button onClick={() => setMktFilter('pts')}
              className={`px-2 py-0.5 text-xs font-mono rounded-lg transition cursor-pointer ${mktFilter === 'pts' ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#182232] text-[#8b97ac] hover:text-white'}`}>
              Points (PTS)
            </button>
            <button onClick={() => setShowCalibrationDetails(!showCalibrationDetails)}
              className="ml-2 text-xs font-mono text-cyan-400 hover:underline cursor-pointer">
              {showCalibrationDetails ? 'Hide Brier Math' : 'Show Brier & Pit Calibration'}
            </button>
          </div>
        </div>

        {/* Detailed Calibration & PIT Collapsible Panel */}
        {showCalibrationDetails && (
          <div className="mb-4 bg-[#0b0f14] p-4 rounded-xl border border-[#222d3e]">
            <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider mb-2">Brier Calibration &amp; Interval Coverage</h3>
            <div className="grid grid-cols-2 gap-3 mb-3 text-xs font-mono">
              <div className="bg-[#121824] p-2.5 rounded-lg border border-[#222d3e]">
                <span className="text-[#8b97ac]">Brier Model vs Market:</span>{' '}
                <span className="text-white font-bold">{calib.brier !== null ? calib.brier.toFixed(3) : '—'}</span> /{' '}
                <span className="text-[#8b97ac]">{calib.brierMarket !== null ? calib.brierMarket.toFixed(3) : '—'}</span>
              </div>
              <div className="bg-[#121824] p-2.5 rounded-lg border border-[#222d3e]">
                <span className="text-[#8b97ac]">Mean P(over) vs Decided Hit:</span>{' '}
                <span className="text-white font-bold">{pctS(calib.meanP)} / {pctS(calib.hitRate)}</span>
              </div>
            </div>
            <div className="grid lg:grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="bg-[#121824] p-2.5 rounded-lg border border-[#222d3e]">
                <div className="text-white font-bold mb-0.5">Shots on Goal (SOG) <span className="text-[#556277] font-normal">n={calibSog.n}</span></div>
                <div className="text-[#8b97ac]">Mean μ vs actual: {muSog ? `${muSog.mu.toFixed(2)} / ${muSog.act.toFixed(2)} (n=${muSog.n})` : '—'}</div>
                <div className="text-[#8b97ac]">80% band coverage: {covSog.map(x => `${Math.round(x.level * 100)}% → ${x.observed === null ? '—' : Math.round(x.observed * 100) + '%'}`).join(' · ')}</div>
              </div>
              <div className="bg-[#121824] p-2.5 rounded-lg border border-[#222d3e]">
                <div className="text-white font-bold mb-0.5">Points (PTS) <span className="text-[#556277] font-normal">n={calibPts.n}</span></div>
                <div className="text-[#8b97ac]">Mean μ vs actual: {muPts ? `${muPts.mu.toFixed(2)} / ${muPts.act.toFixed(2)} (n=${muPts.n})` : '—'}</div>
                <div className="text-[#8b97ac]">80% band coverage: {covPts.map(x => `${Math.round(x.level * 100)}% → ${x.observed === null ? '—' : Math.round(x.observed * 100) + '%'}`).join(' · ')}</div>
              </div>
            </div>
          </div>
        )}

        {/* Self-Graded Ledger Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#222d3e] text-[#8b97ac] uppercase tracking-wider text-[11px]">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Player &amp; Matchup</th>
                <th className="py-2.5 px-3">Market</th>
                <th className="py-2.5 px-3 text-right">Line</th>
                <th className="py-2.5 px-3 text-right">Model μ</th>
                <th className="py-2.5 px-3 text-center">Prediction Lean</th>
                <th className="py-2.5 px-3 text-right">Actual</th>
                <th className="py-2.5 px-3 text-center">Outcome</th>
                <th className="py-2.5 px-3">Self-Grading Post-Game Analysis &amp; Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222d3e]/50">
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-[#556277]">
                    No predictions found in this filter view. Predictions are tracked automatically when the slate loads or odds are imported.
                  </td>
                </tr>
              ) : (
                displayRows.slice(-100).reverse().map(r => {
                  const lean = r.modelLean ?? (r.side ? (r.side.toUpperCase() as 'OVER' | 'UNDER') : (r.modelMu >= r.line ? 'OVER' : 'UNDER'));
                  const isWon = r.predictionHit === true || (r.predictionHit === undefined && (r.result === 'OVER' || r.result === 'UNDER') && r.result === lean);
                  const isLost = r.predictionHit === false || (r.predictionHit === undefined && (r.result === 'OVER' || r.result === 'UNDER') && r.result !== lean);

                  return (
                    <tr key={r.id} className="hover:bg-[#182232]/50 transition">
                      <td className="py-2 px-3 text-[#8b97ac] whitespace-nowrap">{r.date}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="font-bold text-white">{r.playerName}</span>
                        <span className="text-[#556277] ml-1.5">{r.team} v {r.opp}</span>
                      </td>
                      <td className="py-2 px-3 font-semibold text-cyan-300">{r.market.toUpperCase()}</td>
                      <td className="py-2 px-3 text-right text-white font-bold">{r.line}</td>
                      <td className="py-2 px-3 text-right text-cyan-400 font-bold">{r.modelMu.toFixed(2)}</td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          lean === 'OVER' ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60' : 'bg-sky-950/70 text-sky-300 border-sky-700/60'
                        }`}>
                          {lean}
                        </span>
                        {r.tag !== 'PASS' && (
                          <span className="ml-1 text-[9px] text-amber-400 font-bold" title="Qualified Edge Bet">
                            [{r.tag}]
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {r.actual !== null ? (
                          <span className="font-bold text-white">
                            {r.actual}
                            {r.timeOnIce ? <span className="text-[#556277] text-[10px] font-normal ml-1">({r.timeOnIce})</span> : null}
                          </span>
                        ) : (
                          <span className="text-[#556277]">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        {r.result === null ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                            PENDING
                          </span>
                        ) : r.result === 'PUSH' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700">
                            PUSH
                          </span>
                        ) : r.result === 'VOID' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-600" title={r.voidReason}>
                            VOID
                          </span>
                        ) : isWon ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-900 text-emerald-200 border border-emerald-500 flex items-center justify-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> WON
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-700 flex items-center justify-center gap-1">
                            <XCircle className="w-3 h-3 text-rose-400" /> MISSED
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 max-w-md">
                        {r.analysisReason ? (
                          <p className={`text-[11px] leading-relaxed ${
                            isWon ? 'text-emerald-300/90' : isLost ? 'text-rose-300/90' : 'text-[#8b97ac]'
                          }`}>
                            {r.analysisReason}
                          </p>
                        ) : r.result === null ? (
                          <span className="text-[#556277] text-[11px] italic">Awaiting box score to grade performance</span>
                        ) : (
                          <span className="text-[#556277] text-[11px]">{r.voidReason || 'Graded'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Backup & Clear */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-[#222d3e]">
          <button onClick={() => { const str = prompt('Paste ledger JSON backup:'); if (str) onImportJson(str); }}
            className="text-xs font-mono text-[#8b97ac] hover:text-white flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Import JSON Backup
          </button>
          <button onClick={onClearResults} className="text-xs font-mono text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer">
            <RotateCcw className="w-3.5 h-3.5" /> Clear History
          </button>
        </div>
      </div>
    </div>
  );
};
