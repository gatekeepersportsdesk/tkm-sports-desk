import React from 'react';
import { MlbLedgerRow } from '../../types/mlb';
import { Download, CheckCircle, FileText } from 'lucide-react';
import { exportPdfMlbReport } from '../../lib/pdf_report';
import { useDisplaySettings } from '../common/DisplaySettingsContext';
import { TrendAnalysisSection } from '../common/TrendAnalysisSection';
import { CardRow } from '../../lib/card_core';

interface MlbLedgerProps {
  ledger: MlbLedgerRow[];
  onGradeOpenPlays: () => void;
  onExportCsv: () => void;
  onDeleteRow: (idx: number) => void;
  cardRows?: CardRow[];
}

export const MlbLedger: React.FC<MlbLedgerProps> = ({
  ledger,
  onGradeOpenPlays,
  onExportCsv,
  onDeleteRow,
  cardRows = []
}) => {
  const { formatProfit } = useDisplaySettings();

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
    return ledger.map(r => ({
      id: String(r.id),
      playerId: r.id,
      name: r.name,
      team: r.team,
      opp: '—',
      market: 'hit',
      line: r.line ?? 0.5,
      lean: 'OVER' as const,
      result: r.hit === 1 ? ('HIT' as const) : r.hit === 0 ? ('MISS' as const) : null,
      date: r.date
    }));
  }, [cardRows, ledger]);

  const historicalCardRows = React.useMemo(() => {
    if (cardRows && cardRows.length > 0) {
      return cardRows.filter(r => r.result === 'HIT' || r.result === 'MISS' || r.result === 'PUSH');
    }
    return [];
  }, [cardRows]);

  // demo / seeded rows are displayed but never counted
  const counted = ledger.filter(x => !x.demo);
  const settled = counted.filter(x => x.hit !== null && !x.void);
  const playsSettled = settled.filter(x => x.call === 'PLAY');
  const wins = playsSettled.filter(x => x.hit === 1).length;

  let units = 0;
  playsSettled.forEach(p => {
    units += p.hit === 1 ? (p.dec - 1) : -1;
  });
  const roi = playsSettled.length > 0 ? (units / playsSettled.length) * 100 : 0;

  // Brier score & log-loss
  const brierModel = settled.length > 0
    ? settled.reduce((s, r) => s + Math.pow(r.modelP - (r.hit || 0), 2), 0) / settled.length
    : null;
  // book benchmark only where a real fair price exists (fairP 0 = unpriced)
  const withBook = settled.filter(r => r.fairP > 0);
  const brierBook = withBook.length > 0
    ? withBook.reduce((s, r) => s + Math.pow(r.fairP - (r.hit || 0), 2), 0) / withBook.length
    : null;
  const brierModelPaired = withBook.length > 0
    ? withBook.reduce((s, r) => s + Math.pow(r.modelP - (r.hit || 0), 2), 0) / withBook.length
    : null;

  // Calibration Quintiles
  const bins = [
    { from: 0.50, to: 0.56, n: 0, pSum: 0, hSum: 0 },
    { from: 0.56, to: 0.62, n: 0, pSum: 0, hSum: 0 },
    { from: 0.62, to: 0.68, n: 0, pSum: 0, hSum: 0 },
    { from: 0.68, to: 0.74, n: 0, pSum: 0, hSum: 0 },
    { from: 0.74, to: 0.80, n: 0, pSum: 0, hSum: 0 }
  ];

  settled.forEach(r => {
    const p = r.modelP;
    for (const b of bins) {
      if (p >= b.from && p < b.to) {
        b.n++;
        b.pSum += p;
        b.hSum += r.hit || 0;
        break;
      }
    }
  });

  return (
    <div className="space-y-4">
      <TrendAnalysisSection
        sportLabel="MLB"
        currentCard={currentCardPlayers}
        historicalCardRows={historicalCardRows}
        settledLedgerRows={ledger.map(r => ({
          playerId: r.id,
          playerName: r.name,
          market: 'hit',
          line: r.line ?? 0.5,
          lean: 'OVER',
          actual: r.hit,
          hit: r.hit,
          result: r.hit === 1 ? 'HIT' : r.hit === 0 ? 'MISS' : null,
          date: r.date
        }))}
        availableMarkets={['hit']}
      />
      {/* Controls & KPIs */}
      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222d3e] pb-4 mb-4">
          <div>
            <h2 className="text-lg font-bold font-display uppercase tracking-wide text-white">
              Permanent MLB Hit Results Ledger
            </h2>
            <p className="text-xs text-[#8b97ac]">
              Logs every priced batter. Grade against official boxscores to verify Brier score and CLV.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onGradeOpenPlays}
              className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-amber-950 font-bold font-display uppercase tracking-wider text-xs rounded-xl flex items-center gap-1.5 transition"
            >
              <CheckCircle className="w-4 h-4" /> Grade Open Plays
            </button>
            <button
              onClick={onExportCsv}
              className="px-4 py-2 bg-[#182232] hover:bg-[#222d3e] text-white border border-[#222d3e] font-mono text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button
              onClick={() => exportPdfMlbReport(ledger)}
              className="px-4 py-2 bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-200 border border-cyan-500/50 font-mono text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer"
              title="Download formatted summary PDF of daily betting performance"
            >
              <FileText className="w-3.5 h-3.5 text-cyan-400" /> Download PDF Report
            </button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Settled Plays</span>
            <p className="text-xl font-bold font-mono text-white mt-0.5">{wins} - {playsSettled.length - wins}</p>
            <span className="text-[10px] text-[#556277] font-mono">
              {playsSettled.length ? `${((wins / playsSettled.length) * 100).toFixed(1)}% hit rate` : '0.0%'}
            </span>
          </div>
          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">1u Flat ROI</span>
            <p className={`text-xl font-bold font-mono mt-0.5 ${roi >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
            </p>
            <span className="text-[10px] text-[#556277] font-mono">
              {formatProfit(units)}
            </span>
          </div>
          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Brier (Model / Book)</span>
            <p className="text-xl font-bold font-mono text-sky-400 mt-0.5">
              {brierModelPaired !== null ? brierModelPaired.toFixed(3) : '—'} / {brierBook !== null ? brierBook.toFixed(3) : '—'}
            </p>
            <span className="text-[10px] text-[#556277] font-mono">paired on n={withBook.length} priced rows · lower is better</span>
          </div>
          <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Total Rows</span>
            <p className="text-xl font-bold font-mono text-white mt-0.5">{ledger.length}</p>
            <span className="text-[10px] text-[#556277] font-mono">{settled.length} settled{ledger.length - counted.length > 0 ? ` · ${ledger.length - counted.length} demo excluded` : ''}</span>
          </div>
        </div>

        {/* Calibration Quintiles */}
        <div className="bg-[#0f1520] p-3.5 rounded-xl border border-[#222d3e] mb-4">
          <h3 className="text-xs font-mono font-bold text-[#8b97ac] uppercase mb-2">
            Calibration Quintiles (50% - 80% Range)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-xs">
            {bins.map(b => (
              <div key={b.from} className="bg-[#182232] p-2 rounded-lg border border-[#222d3e]">
                <div className="text-[10px] text-[#8b97ac]">{(b.from * 100).toFixed(0)}-{(b.to * 100).toFixed(0)}% bin</div>
                <div className="text-white">pred: {b.n ? `${((b.pSum / b.n) * 100).toFixed(0)}%` : '—'}</div>
                <div className={b.n && (b.hSum / b.n) >= (b.pSum / b.n) ? 'text-emerald-400' : 'text-amber-400'}>
                  act: {b.n ? `${((b.hSum / b.n) * 100).toFixed(0)}% (n=${b.n})` : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Ledger Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#222d3e] text-[#8b97ac] uppercase tracking-wider text-[11px]">
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Player</th>
                <th className="py-2 px-3">Team</th>
                <th className="py-2 px-3">Slot</th>
                <th className="py-2 px-3">Odds</th>
                <th className="py-2 px-3">Model %</th>
                <th className="py-2 px-3">Fair %</th>
                <th className="py-2 px-3">Edge</th>
                <th className="py-2 px-3">Call</th>
                <th className="py-2 px-3">Result</th>
                <th className="py-2 px-3">Analysis &amp; Reason</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222d3e]/50">
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-[#556277]">
                    Ledger empty. Import or price rows on the Hit Board to populate.
                  </td>
                </tr>
              ) : (
                ledger.map((row, idx) => (
                  <tr key={idx} className="hover:bg-[#182232]/50">
                    <td className="py-2 px-3 text-[#8b97ac]">{row.date}</td>
                    <td className="py-2 px-3 font-bold text-white">{row.name}{row.demo ? <span className="ml-1 text-[9px] text-amber-300 border border-amber-700 rounded px-1">DEMO</span> : null}</td>
                    <td className="py-2 px-3 text-[#8b97ac]">{row.team}</td>
                    <td className="py-2 px-3">{row.slot}</td>
                    <td className="py-2 px-3">{row.over}{(row.line ?? 0.5) !== 0.5 ? <span className="text-[#8b97ac]"> ({row.line}+)</span> : null}</td>
                    <td className="py-2 px-3">{(row.modelP * 100).toFixed(1)}%</td>
                    <td className="py-2 px-3 text-[#8b97ac]">{row.fairP ? `${(row.fairP * 100).toFixed(1)}%` : '—'}</td>
                    <td className={`py-2 px-3 ${row.edge >= 1.5 ? 'text-emerald-400 font-bold' : ''}`}>
                      {row.edge >= 0 ? '+' : ''}{row.edge.toFixed(1)}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.call === 'PLAY' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' : 'text-slate-400'}`}>
                        {row.call}
                      </span>
                    </td>
                    <td className={`py-2 px-3 font-bold ${row.hit === 1 ? 'text-emerald-400' : row.hit === 0 ? 'text-rose-400' : 'text-[#8b97ac]'}`}>
                      {row.void ? 'VOID' : row.result || 'OPEN'}
                    </td>
                    <td className="py-2 px-3 text-[11px] text-[#8b97ac] max-w-xs">
                      {row.analysisReason || (row.hit === null && !row.void ? 'Awaiting box score' : '—')}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button onClick={() => onDeleteRow(idx)} className="text-[#556277] hover:text-rose-400">
                        &times;
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
