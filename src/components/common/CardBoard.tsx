import React, { useMemo, useState } from 'react';
import { CardRow, CardFilter, filterCardRows, summarizeCard, isHeadline } from '../../lib/card_core';
import { Calendar, ChevronLeft, ChevronRight, ClipboardCheck, Download, Search, Archive, AlertTriangle } from 'lucide-react';
import { getTodayIsoDate } from '../../lib/dates';
import { getCardRowMarketVariance } from '../../lib/market_variance';
import { MarketVarianceBadge } from './MarketVarianceBadge';

interface Props {
  rows: CardRow[];
  edge: Set<string>;
  /** read-only line saying what the automatic capture / grading just did */
  autoStatus: string;
  /** read-only line saying what the automatic grader just did */
  gradeStatus?: string;
  /** manual re-run of the same automatic grader (never required) */
  onGrade?: () => void;
  /** downloads the card rows as JSON */
  onExport?: () => void;
  /** downloads an archive of graded rows >30d and removes them from storage */
  onClearHistory?: () => void;
  /** true when quota was exceeded and rows are safely kept in memory */
  inMemoryOnly?: boolean;
  /** exports current day's in-memory card */
  onExportCurrentCard?: () => void;
  sport: string;
  markets: { id: string; label: string }[];
  /** 'min' | 'AB' | '' (NFL has no exposure column) */
  exposureUnit: string;
  startWord: string;
  sourceWord: string;
  /** what the "season avg" comparator means for this sport */
  avgNote: string;
}

const pct = (x: number | null, d = 0) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);
const n1 = (x: number | null) => (x === null ? '—' : x.toFixed(2));
const FILTERS: [CardFilter, string][] = [
  ['all', 'All'],
  ['won', 'Won (HIT)'],
  ['missed', 'Missed (MISS)'],
  ['pending', 'Pending'],
  ['edge', 'Edge plays']
];

export type TableSortOption = 'date' | 'result' | 'pct_desc' | 'pct_asc' | 'actual_desc' | 'actual_asc' | 'error_desc';

const shiftDate = (dateStr: string, days: number): string => {
  try {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  } catch {
    return dateStr;
  }
};

/** The automatic daily card: multi-day navigation, per-day grading, baselines, and self-grading metrics. */
export const CardBoard: React.FC<Props> = ({
  rows,
  edge,
  autoStatus,
  gradeStatus,
  onGrade,
  onExport,
  onClearHistory,
  inMemoryOnly,
  onExportCurrentCard,
  sport,
  markets,
  exposureUnit,
  startWord,
  sourceWord,
  avgNote
}) => {
  const label = (id: string) => markets.find(m => m.id === id)?.label ?? id;
  const today = getTodayIsoDate();

  const [selectedDate, setSelectedDate] = useState<string | 'ALL'>(today);
  const [filter, setFilter] = useState<CardFilter>('all');
  const [market, setMarket] = useState<string>('all');
  const [withEst, setWithEst] = useState(false);
  const [search, setSearch] = useState('');
  const [tableSort, setTableSort] = useState<TableSortOption>('date');

  // Filter rows for the currently selected date (or all dates for cumulative view)
  const activeRows = useMemo(() => {
    if (selectedDate === 'ALL') return rows;
    return rows.filter(r => r.date === selectedDate);
  }, [rows, selectedDate]);

  const s = useMemo(() => summarizeCard(activeRows, markets.map(m => m.id), false), [activeRows, markets]);
  const excluded = activeRows.filter(r => !isHeadline(r)).length;

  const winPct = (r: CardRow) => (r.lean === 'OVER' ? r.pOver : 1 - r.pOver);

  const shown = useMemo(() => {
    let list = filterCardRows(activeRows, filter, market, edge, withEst).slice();
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(q) || r.team.toLowerCase().includes(q) || r.opp.toLowerCase().includes(q));
    }

    return list.sort((a, b) => {
      if (tableSort === 'result') {
        const order: Record<string, number> = { HIT: 1, MISS: 2, PUSH: 3, VOID: 4, null: 5 };
        const oA = order[a.result ?? 'null'] ?? 9;
        const oB = order[b.result ?? 'null'] ?? 9;
        if (oA !== oB) return oA - oB;
        return winPct(b) - winPct(a);
      }
      if (tableSort === 'pct_desc') return winPct(b) - winPct(a);
      if (tableSort === 'pct_asc') return winPct(a) - winPct(b);
      if (tableSort === 'actual_desc') return (b.actual ?? -999) - (a.actual ?? -999);
      if (tableSort === 'actual_asc') return (a.actual ?? 999) - (b.actual ?? 999);
      if (tableSort === 'error_desc') return Math.abs(b.err ?? 0) - Math.abs(a.err ?? 0);
      return a.date === b.date ? b.capturedAt - a.capturedAt : a.date < b.date ? 1 : -1;
    });
  }, [activeRows, filter, market, edge, withEst, search, tableSort]);

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-full text-[11px] font-mono cursor-pointer transition ${
      on ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#0f1520] text-[#8b97ac] border border-[#222d3e] hover:text-white'
    }`;

  const noise = s.decided ? Math.sqrt(0.25 / s.decided) * 100 : null;

  return (
    <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] space-y-4">
      {/* Title & Date Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222d3e] pb-4">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wide text-white">{sport} daily card — automatic self-grading</h2>
          <p className="text-xs text-[#8b97ac]">
            Every priced player-market is logged before {startWord} with no clicking, then graded from {sourceWord} once the game is final.
            Players who did not play are VOID and excluded.
            Headline numbers use REAL inputs with a known availability only{excluded ? ` (${excluded} estimated / unknown-availability row${excluded === 1 ? '' : 's'} kept aside)` : ''}.
          </p>
        </div>

        {/* Date Navigation Bar */}
        <div className="flex items-center gap-2 flex-wrap bg-[#0f1520] p-1.5 rounded-xl border border-[#222d3e]">
          <button
            onClick={() => {
              const cur = selectedDate === 'ALL' ? today : selectedDate;
              setSelectedDate(shiftDate(cur, -1));
            }}
            className="p-1 rounded text-[#8b97ac] hover:text-white hover:bg-[#182232] cursor-pointer"
            title="Previous Day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1.5 px-2">
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            <input
              type="date"
              value={selectedDate === 'ALL' ? '' : selectedDate}
              onChange={e => e.target.value && setSelectedDate(e.target.value)}
              className="bg-[#0b0f14] border border-[#222d3e] px-2 py-1 rounded text-white font-mono text-xs outline-none focus:border-cyan-400 cursor-pointer"
            />
          </div>

          <button
            onClick={() => {
              const cur = selectedDate === 'ALL' ? today : selectedDate;
              setSelectedDate(shiftDate(cur, 1));
            }}
            className="p-1 rounded text-[#8b97ac] hover:text-white hover:bg-[#182232] cursor-pointer"
            title="Next Day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            onClick={() => setSelectedDate(today)}
            className={`px-2 py-1 text-xs font-mono rounded cursor-pointer ${
              selectedDate === today ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' : 'text-[#8b97ac] hover:text-white'
            }`}
          >
            Today
          </button>

          <button
            onClick={() => setSelectedDate('ALL')}
            className={`px-2.5 py-1 text-xs font-mono rounded cursor-pointer ${
              selectedDate === 'ALL' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
            }`}
            title="Show cumulative metrics across all stored dates"
          >
            All Dates (Cumulative)
          </button>

          {onGrade && (
            <button
              onClick={onGrade}
              className="ml-1 px-3 py-1 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold text-xs font-mono rounded-lg flex items-center gap-1.5 transition cursor-pointer"
              title="Pull official box scores and settle grades"
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              Grade now
            </button>
          )}

          {onExport && (
            <button
              onClick={onExport}
              className="px-2.5 py-1 rounded border border-[#222d3e] text-xs font-mono text-[#8b97ac] hover:text-white flex items-center gap-1 cursor-pointer"
              title="Download card as JSON"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          )}

          {onClearHistory && (
            <button
              onClick={onClearHistory}
              className="px-2.5 py-1 rounded border border-purple-800/60 bg-purple-950/40 text-xs font-mono text-purple-300 hover:text-white hover:bg-purple-900/60 flex items-center gap-1 cursor-pointer transition"
              title="Downloads an archive JSON of entries older than 30 days, then removes them from storage"
            >
              <Archive className="w-3.5 h-3.5" />
              Clear old history (&gt;30d)
            </button>
          )}
        </div>
      </div>

      {/* Storage Warning Banner (when inMemoryOnly or storage quota exceeded) */}
      {(inMemoryOnly || (autoStatus && autoStatus.includes('memory'))) && (
        <div className="p-3 rounded-xl border border-amber-600/60 bg-amber-950/50 text-amber-200 text-xs font-mono flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <b>Storage full notice:</b> Older cards were archived to Downloads. The current graded card is safely kept in memory so your results are not lost.
            </span>
          </div>
          {(onExportCurrentCard || onExport) && (
            <button
              onClick={onExportCurrentCard || onExport}
              className="px-3 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold font-mono text-xs rounded-lg shrink-0 flex items-center gap-1.5 cursor-pointer shadow"
            >
              <Download className="w-3.5 h-3.5 stroke-[2.5]" />
              Export Unsaved Card
            </button>
          )}
        </div>
      )}

      {/* Observability Status Message */}
      {(gradeStatus || autoStatus) && (
        <div className="p-2.5 rounded-xl border border-cyan-900/60 bg-cyan-950/40 text-cyan-300 text-xs font-mono flex flex-wrap items-center gap-2">
          {autoStatus && <span>{autoStatus}</span>}
          {autoStatus && gradeStatus && <span>·</span>}
          {gradeStatus && <span>{gradeStatus}</span>}
        </div>
      )}

      {/* Date Scope Banner */}
      <div className="flex items-center justify-between text-xs font-mono text-[#8b97ac]">
        <span>
          Scope: <b className="text-white">{selectedDate === 'ALL' ? 'All Stored Dates (Cumulative)' : `Slate Date: ${selectedDate}`}</b>
          {selectedDate === 'ALL' ? ` · ${rows.length} total card rows across dates` : ` · ${activeRows.length} card projections on this date`}
        </span>
        <span>
          {activeRows.filter(r => r.result !== null).length} graded · {activeRows.filter(r => r.result === null).length} pending
        </span>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
          <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Model prediction win rate</span>
          <p className="text-xl font-bold font-mono text-white mt-0.5">{pct(s.winRate, 1)}</p>
          <span className="text-[10px] text-[#556277] font-mono">
            {s.hits} / {s.decided} decided{noise !== null ? ` · ±${noise.toFixed(1)}pt noise` : ''} · baselines: always-UNDER {pct(s.alwaysUnder, 1)} · always-OVER {pct(s.alwaysOver, 1)}
          </span>
        </div>
        <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
          <span className="text-[10px] font-mono text-[#8b97ac] uppercase">OVER vs UNDER accuracy</span>
          <p className="text-xl font-bold font-mono text-white mt-0.5">
            {pct(s.over.n ? s.over.hits / s.over.n : null)} / {pct(s.under.n ? s.under.hits / s.under.n : null)}
          </p>
          <span className="text-[10px] text-[#556277] font-mono">{s.over.hits}/{s.over.n} over · {s.under.hits}/{s.under.n} under</span>
        </div>
        <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
          <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Brier · mean P(over) vs over rate</span>
          <p className="text-xl font-bold font-mono text-sky-400 mt-0.5">{s.brier === null ? '—' : s.brier.toFixed(3)}</p>
          <span className="text-[10px] text-[#556277] font-mono">{pct(s.meanPOver, 1)} predicted · {pct(s.overRate, 1)} happened (0.250 = coin flip)</span>
        </div>
        <div className="bg-[#0f1520] p-3 rounded-xl border border-[#222d3e]">
          <span className="text-[10px] font-mono text-[#8b97ac] uppercase">Logged · pending · push · void</span>
          <p className="text-xl font-bold font-mono text-white mt-0.5">{s.logged}</p>
          <span className="text-[10px] text-[#556277] font-mono">{s.pending} pending · {s.pushed} push · {s.voided} void</span>
        </div>
      </div>
      <p className="text-[10px] text-[#556277]">
        The win rate is measured at the model's own line (about its mean). The outcome is lopsided at that line (for most count stats UNDER wins more than half the time, for MLB 0.5 hits OVER does), so compare the win rate with the better of the two baselines, not with 50%. The real quality tests are MAE against a plain season average (below) and interval coverage; both need a few hundred graded rows per market to mean anything.
      </p>

      {/* MAE Breakdown Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-[#222d3e] text-[#8b97ac] uppercase text-[11px]">
              <th className="py-1.5 px-2">Market</th>
              <th className="py-1.5 px-2 text-right">n</th>
              <th className="py-1.5 px-2 text-right">MAE model</th>
              <th className="py-1.5 px-2 text-right">MAE season avg*</th>
              <th className="py-1.5 px-2 text-right">Bias (act−μ)</th>
              <th className="py-1.5 px-2 text-right">Coverage 50/80/90</th>
            </tr>
          </thead>
          <tbody>
            {s.byMarket.filter(m => m.n > 0).length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-[#556277]">
                  {activeRows.length === 0
                    ? `No predictions logged for ${selectedDate === 'ALL' ? 'any date' : selectedDate}.`
                    : `No rows graded yet for this selection. Official results settle automatically when games are final.`}
                </td>
              </tr>
            ) : (
              s.byMarket.filter(m => m.n > 0).map(m => (
                <tr key={m.market} className="border-b border-[#222d3e]/50 text-white">
                  <td className="py-1.5 px-2 font-bold">{label(m.market)}</td>
                  <td className="py-1.5 px-2 text-right">{m.n}</td>
                  <td className="py-1.5 px-2 text-right text-cyan-400">{n1(m.mae)}</td>
                  <td className="py-1.5 px-2 text-right">
                    {m.maeNaive === null ? '—' : `${n1(m.maeNaive)} (model ${n1(m.maeOnNaive)} on those ${m.nNaive})`}
                  </td>
                  <td className="py-1.5 px-2 text-right">{m.bias === null ? '—' : (m.bias >= 0 ? '+' : '') + m.bias.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right">
                    {m.coverage.map(c => pct(c)).join(' / ')}
                    {m.n < 100 ? <span className="text-amber-400"> (n={m.n}: too few)</span> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="text-[10px] text-[#556277] mt-1">* {avgNote}, on the rows that have one. Lower MAE is better.</div>
      </div>

      {/* Filter and Sort Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#222d3e]">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={chip(filter === k)}>
              {l}
            </button>
          ))}
          <span className="text-[#556277]">|</span>
          <button onClick={() => setMarket('all')} className={chip(market === 'all')}>
            All markets
          </button>
          {markets.length > 1 &&
            markets.map(m => (
              <button key={m.id} onClick={() => setMarket(m.id)} className={chip(market === m.id)}>
                {m.label}
              </button>
            ))}
        </div>

        {/* Search & Sort Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#556277]" />
            <input
              type="text"
              placeholder="Search player / team…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#0f1520] border border-[#222d3e] pl-8 pr-2.5 py-1 rounded-xl text-white font-mono text-xs outline-none focus:border-cyan-400 placeholder:text-[#556277] w-44"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-[#0f1520] px-2.5 py-1 rounded-xl border border-[#222d3e]">
            <span className="text-[10px] font-mono text-[#8b97ac] uppercase font-bold">Sort:</span>
            <select
              value={tableSort}
              onChange={e => setTableSort(e.target.value as TableSortOption)}
              className="bg-transparent text-white font-mono text-xs outline-none cursor-pointer"
            >
              <option value="date">Date / Time (Default)</option>
              <option value="result">Result (HIT / MISS / PUSH / VOID)</option>
              <option value="pct_desc">Model P desc (Highest %)</option>
              <option value="pct_asc">Model P asc (Lowest %)</option>
              <option value="actual_desc">Actual stat desc</option>
              <option value="actual_asc">Actual stat asc</option>
              <option value="error_desc">Error (Largest surprise)</option>
            </select>
          </div>

          <label className="flex items-center gap-1.5 text-[11px] font-mono text-[#8b97ac] cursor-pointer">
            <input type="checkbox" checked={withEst} onChange={e => setWithEst(e.target.checked)} className="accent-cyan-400" />
            show estimated / unknown rows ({excluded})
          </label>
        </div>
      </div>

      {/* Graded Table Rows */}
      <div className="overflow-x-auto w-full">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-[#222d3e] text-[#8b97ac] uppercase text-[11px]">
              <th className="py-1.5 px-2">Date</th>
              <th className="py-1.5 px-2">Player</th>
              <th className="py-1.5 px-2">Mkt</th>
              <th className="py-1.5 px-2 text-right">Lean · line (P%)</th>
              <th className="py-1.5 px-2 text-right">μ</th>
              <th className="py-1.5 px-2 text-right">Actual{exposureUnit ? ` (${exposureUnit})` : ''}</th>
              <th className="py-1.5 px-2 text-right">Error</th>
              <th className="py-1.5 px-2 text-center">Result</th>
              <th className="py-1.5 px-2">Factual Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#222d3e]/50">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-6 text-center text-[#556277]">
                  {rows.length === 0
                    ? `The daily card fills itself when the ${sport} slate loads before ${startWord}. Nothing to do.`
                    : 'No rows match this filter.'}
                </td>
              </tr>
            ) : (
              shown.slice(0, 300).map(r => (
                <tr key={r.id} className="hover:bg-[#182232]/50 align-top">
                  <td className="py-1.5 px-2 text-[#8b97ac]">{r.date}</td>
                  <td className="py-1.5 px-2 font-bold text-white">
                    {r.name}
                    <span className="text-[#556277] font-normal"> {r.team}v{r.opp}</span>
                    {!isHeadline(r) && (
                      <span className="ml-1 text-[9px] text-amber-300 border border-amber-700 rounded px-1">
                        {r.inputs !== 'REAL' ? 'EST' : 'AVAIL?'}
                      </span>
                    )}
                    {edge.has(r.id) && (
                      <span className="ml-1 text-[9px] text-emerald-300 border border-emerald-700 rounded px-1">
                        EDGE
                      </span>
                    )}
                    <span className="ml-1 inline-block align-middle">
                      <MarketVarianceBadge info={getCardRowMarketVariance(r)} compact />
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-[#8b97ac]">{label(r.market)}</td>
                  <td className="py-1.5 px-2 text-right text-white">
                    <span>{r.lean} {r.line}</span>
                    <span className="text-[10px] text-cyan-300 ml-1">({(winPct(r) * 100).toFixed(0)}%)</span>
                  </td>
                  <td className="py-1.5 px-2 text-right text-cyan-400">{r.mu.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right text-white font-bold">
                    {r.actual === null
                      ? '—'
                      : exposureUnit && r.minutes !== null
                      ? `${r.actual} (${Math.round(r.minutes)}${exposureUnit === 'min' ? 'm' : ' ' + exposureUnit})`
                      : `${r.actual}`}
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {r.err === null ? '—' : (r.err >= 0 ? '+' : '') + r.err.toFixed(1)}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        r.result === null
                          ? 'bg-slate-800 text-slate-400 border-slate-700'
                          : r.result === 'HIT'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                          : r.result === 'MISS'
                          ? 'bg-rose-950 text-rose-300 border-rose-700'
                          : r.result === 'PUSH'
                          ? 'bg-amber-950 text-amber-300 border-amber-700'
                          : 'bg-slate-800 text-slate-300 border-slate-600'
                      }`}
                    >
                      {r.result ?? 'PENDING'}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-[#8b97ac] min-w-[260px]">{r.reason ?? ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {shown.length > 300 && (
          <div className="text-[10px] text-[#556277] mt-1">Showing 300 of {shown.length} rows. Statistics above use every row.</div>
        )}
      </div>
    </div>
  );
};
