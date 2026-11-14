import React from 'react';
import { NbaLedgerRow, NbaMarket, NBA_MARKETS, NBA_MARKET_LABEL, NBA_MARKET_UNIT } from '../../types/nba';
import { Download, Upload, ClipboardCheck, RotateCcw, FileText } from 'lucide-react';
import { exportPdfNbaReport } from '../../lib/pdf_report';
import { summarizeCalibration, proportionMargin, discretePit, pitCoverage, hashUnit } from '../../model/calibration';
import { nbinomPmf, ledgerUnits } from '../../model/nhl_engine';
import { fmtAmerican } from '../../lib/odds';
import { NbaCardBoard } from './NbaCardBoard';
import { NbaPrediction } from '../../types/nba';
import { edgeKeys } from '../../lib/nba_card';
import { useDisplaySettings } from '../common/DisplaySettingsContext';
import { TrendAnalysisSection } from '../common/TrendAnalysisSection';
import { NbaPlayerSnapshot } from '../../types/nba';
import { normalizeName } from '../../lib/trend_analysis';
import { PickerHistoryPanel } from '../common/PickerHistoryPanel';

interface Props {
  rows: NbaLedgerRow[];
  gradeStatus: string;
  onGrade: () => void;
  onGradeDate?: (date?: string) => Promise<void> | void;
  onClearResults: () => void;
  onExportJson: () => void;
  onImportJson: (json: string) => void;
  onClearHistory?: () => void;
  inMemoryOnly?: boolean;
  onExportCurrentCard?: () => void;
  /** the automatic daily card (auto-logged, auto-graded) */
  predictions: NbaPrediction[];
  autoStatus: string;
  players?: NbaPlayerSnapshot[];
}

const pctS = (x: number | null, d = 1) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);

export const NbaScoreboard: React.FC<Props> = ({
  rows,
  gradeStatus,
  onGrade,
  onGradeDate,
  onClearResults,
  onExportJson,
  onImportJson,
  onClearHistory,
  inMemoryOnly,
  onExportCurrentCard,
  predictions,
  autoStatus,
  players
}) => {
  const { formatProfit, formatStake } = useDisplaySettings();
  const edge = React.useMemo(() => edgeKeys(rows), [rows]);

  // Construct direct game log map for NBA players across all markets
  const playerStatLogs = React.useMemo(() => {
    const map: Record<string | number, Record<string, number[]>> = {};
    if (players) {
      for (const p of players) {
        if (!p.recentLogs || p.recentLogs.length === 0) continue;
        const mktLogs: Record<string, number[]> = {};
        for (const m of NBA_MARKETS) {
          mktLogs[m] = p.recentLogs.map(l => l.counts[m]);
        }
        map[p.playerId] = mktLogs;
        map[normalizeName(p.name)] = mktLogs;
      }
    }
    return map;
  }, [players]);

  // Extract active daily card players and historical rows for trend analysis
  const currentCardPlayers = React.useMemo(() => {
    const pending = predictions.filter(r => r.result === null);
    const pool = pending.length > 0 ? pending : predictions;
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
  }, [predictions]);

  const historicalCardRows = React.useMemo(() => {
    return predictions.filter(r => r.result === 'HIT' || r.result === 'MISS' || r.result === 'PUSH').map(r => ({
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
  }, [predictions]);

  const real = rows;
  const pending = real.filter(r => r.result === null).length;
  const voided = real.filter(r => r.result === 'VOID').length;
  const pushed = real.filter(r => r.result === 'PUSH').length;
  const decided = real.filter(r => r.result === 'OVER' || r.result === 'UNDER');

  const calibFor = (m: NbaMarket | 'all') =>
    summarizeCalibration(
      decided.filter(r => m === 'all' || r.market === m).map(r => ({
        p: r.probOver,
        y: (r.result === 'OVER' ? 1 : 0) as 0 | 1,
        pMarket: r.pMarketOver
      }))
    );
  const calib = calibFor('all');

  // Interval coverage (does the stated 80% band contain ~80% of outcomes?)
  const cover = (m: NbaMarket) =>
    pitCoverage(
      real.filter(r => r.market === m && r.actual !== null && (r.result === 'OVER' || r.result === 'UNDER' || r.result === 'PUSH'))
        .map(r => discretePit(k => nbinomPmf(k, r.modelMu, r.r), r.actual as number, hashUnit(r.id)))
    );

  const plays = decided.filter(r => r.tag !== 'PASS');
  const units = plays.reduce((s, r) => s + (ledgerUnits(r) ?? 0), 0);
  const wins = plays.filter(r => (r.side === 'over' && r.result === 'OVER') || (r.side === 'under' && r.result === 'UNDER')).length;
  const roi = plays.length ? units / plays.length : null;

  const meanMu = (m: NbaMarket) => {
    const g = real.filter(r => r.market === m && r.actual !== null);
    return g.length ? { mu: g.reduce((s, r) => s + r.modelMu, 0) / g.length, act: g.reduce((s, r) => s + (r.actual as number), 0) / g.length, n: g.length } : null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onGrade} className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold uppercase tracking-wider text-xs rounded-xl flex items-center gap-1.5 transition">
          <ClipboardCheck className="w-4 h-4" /> Grade now (also runs automatically)
        </button>
        <span className="text-[11px] font-mono text-cyan-300">{gradeStatus}</span>
      </div>
      <PickerHistoryPanel sport="nba" sportLabel="NBA" />
      <NbaCardBoard
        rows={predictions}
        edge={edge}
        autoStatus={autoStatus}
        onGradeDate={onGradeDate}
        gradeStatus={gradeStatus}
        onClearHistory={onClearHistory}
        inMemoryOnly={inMemoryOnly}
        onExportCurrentCard={onExportCurrentCard}
      />
      <TrendAnalysisSection
        sportLabel="NBA"
        currentCard={currentCardPlayers}
        historicalCardRows={historicalCardRows}
        settledLedgerRows={rows}
        playerStatLogs={playerStatLogs}
        availableMarkets={['pts', 'reb', 'ast', 'tpm', 'pra', 'stl', 'blk']}
      />
      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222d3e] pb-4 mb-4">
          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-white">Priced plays (captured automatically on odds import or desk)</h2>
            <p className="text-xs text-[#8b97ac]">
              Rows are tracked before the game and graded from official box scores. Nothing is simulated. A player who did not play is VOID, never a zero.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onGrade} className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold uppercase tracking-wider text-xs rounded-xl flex items-center gap-1.5 transition">
              <ClipboardCheck className="w-4 h-4" /> Grade from box scores
            </button>
            <button onClick={onExportJson} className="px-3.5 py-2 bg-[#182232] hover:bg-[#222d3e] text-white border border-[#222d3e] text-xs font-mono rounded-xl flex items-center gap-1.5 transition cursor-pointer">
              <Download className="w-3.5 h-3.5" /> Export JSON
            </button>
            <button
              onClick={() => exportPdfNbaReport(rows)}
              className="px-3.5 py-2 bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-200 border border-cyan-500/50 text-xs font-mono rounded-xl flex items-center gap-1.5 transition cursor-pointer"
              title="Download formatted summary PDF of daily betting performance"
            >
              <FileText className="w-3.5 h-3.5 text-cyan-400" /> Download PDF Report
            </button>
          </div>
        </div>
        {gradeStatus && <div className="mb-3 text-[11px] font-mono text-cyan-300">{gradeStatus}</div>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Logged / graded</span>
            <p className="text-xl font-bold font-mono text-white mt-0.5">{real.length} / {decided.length}</p>
            <span className="text-[10px] text-[#556277] font-mono">{pending} pending · {pushed} push · {voided} void</span>
          </div>
          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Qualified plays</span>
            <p className={`text-xl font-bold font-mono mt-0.5 ${units > 0 ? 'text-emerald-400' : 'text-white'}`}>
              {plays.length ? `${wins}-${plays.length - wins}` : '—'} · {plays.length ? formatProfit(units) : ''}
            </p>
            <span className="text-[10px] text-[#556277] font-mono">ROI {roi === null ? '—' : `${(roi * 100).toFixed(1)}%`} per {formatStake(1.0)} (STAB/FADE only)</span>
          </div>
          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Brier model vs market</span>
            <p className="text-xl font-bold font-mono text-sky-400 mt-0.5">
              {calib.brier !== null ? calib.brier.toFixed(3) : '—'} / {calib.brierMarket !== null ? calib.brierMarket.toFixed(3) : '—'}
            </p>
            <span className="text-[10px] text-[#556277] font-mono">lower is better · market on n={calib.nMarket}</span>
          </div>
          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Mean P(over) vs hit</span>
            <p className="text-xl font-bold font-mono text-white mt-0.5">{pctS(calib.meanP)} / {pctS(calib.hitRate)}</p>
            <span className="text-[10px] text-[#556277] font-mono">±{calib.n ? (proportionMargin(0.5, calib.n) * 100).toFixed(0) : '—'}pt sampling noise</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-3 mb-4">
          {NBA_MARKETS.map(m => [NBA_MARKET_LABEL[m], calibFor(m), cover(m), meanMu(m)] as const).map(([label, c, cov, mu]) => (
            <div key={label} className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e] text-xs font-mono">
              <div className="text-white font-bold mb-1">{label} <span className="text-[#556277] font-normal">n={c.n}</span></div>
              <div className="text-[#8b97ac]">Mean μ vs actual: {mu ? `${mu.mu.toFixed(2)} / ${mu.act.toFixed(2)} (n=${mu.n})` : '—'}</div>
              <div className="text-[#8b97ac]">
                Interval coverage:{' '}
                {cov.map(x => `${Math.round(x.level * 100)}% → ${x.observed === null ? '—' : Math.round(x.observed * 100) + '%'}`).join(' · ')}
                {cov[0].n > 0 && cov[0].n < 100 ? <span className="text-amber-400"> (n={cov[0].n}: too few to judge)</span> : null}
              </div>
              {c.n > 0 && (
                <div className="mt-2 grid grid-cols-7 gap-1 text-center">
                  {c.bins.map(b => (
                    <div key={b.lo} className="bg-[#121824] rounded border border-[#222d3e] py-1">
                      <div className="text-[#556277] text-[9px]">{Math.round(b.lo * 100)}–{Math.min(100, Math.round(b.hi * 100))}</div>
                      <div className="text-white">{b.hitRate !== null ? `${(b.hitRate * 100).toFixed(0)}%` : '—'}</div>
                      <div className="text-[#556277] text-[9px]">n={b.n}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#222d3e] text-[#8b97ac] uppercase tracking-wider text-[11px]">
                <th className="py-2 px-3">Date</th><th className="py-2 px-3">Player</th><th className="py-2 px-3">Mkt</th>
                <th className="py-2 px-3 text-right">Line</th><th className="py-2 px-3 text-right">μ</th>
                <th className="py-2 px-3 text-right">P(O)</th><th className="py-2 px-3 text-right">O / U</th>
                <th className="py-2 px-3 text-center">Tag</th><th className="py-2 px-3 text-right">Actual</th><th className="py-2 px-3 text-center">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222d3e]/50">
              {rows.length === 0 ? (
                <tr><td colSpan={10} className="py-8 text-center text-[#556277]">Nothing logged yet. Import odds on the desk to automatically populate priced plays.</td></tr>
              ) : rows.slice(-80).reverse().map(r => (
                <tr key={r.id} className="hover:bg-[#182232]/50">
                  <td className="py-2 px-3 text-[#8b97ac]">{r.date}</td>
                  <td className="py-2 px-3 font-bold text-white">{r.playerName}<span className="text-[#556277] font-normal"> {r.team}v{r.opp}</span></td>
                  <td className="py-2 px-3 text-[#8b97ac]">{NBA_MARKET_UNIT[r.market]}</td>
                  <td className="py-2 px-3 text-right text-white font-bold">{r.line}</td>
                  <td className="py-2 px-3 text-right text-cyan-400">{r.modelMu.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right">{(r.probOver * 100).toFixed(1)}%</td>
                  <td className="py-2 px-3 text-right text-[#8b97ac]">{fmtAmerican(r.overOdds)} / {fmtAmerican(r.underOdds)}</td>
                  <td className="py-2 px-3 text-center">{r.tag}</td>
                  <td className="py-2 px-3 text-right font-bold text-white">{r.actual ?? '—'}</td>
                  <td className="py-2 px-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                      r.result === null ? 'bg-slate-800 text-slate-400 border-slate-700'
                      : r.result === 'OVER' ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                      : r.result === 'UNDER' ? 'bg-sky-950 text-sky-300 border-sky-700'
                      : 'bg-slate-800 text-slate-300 border-slate-600'}`} title={r.voidReason}>
                      {r.result ?? 'PENDING'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-4 mt-4 border-t border-[#222d3e]">
          <button onClick={() => { const str = prompt('Paste ledger JSON backup:'); if (str) onImportJson(str); }}
            className="text-xs font-mono text-[#8b97ac] hover:text-white flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" /> Import JSON Backup
          </button>
          <button onClick={onClearResults} className="text-xs font-mono text-rose-400 hover:text-rose-300 flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5" /> Clear History
          </button>
        </div>
      </div>
    </div>
  );
};
