import React, { useState, useMemo, useEffect } from 'react';
import { Crown, Flame, ShieldCheck, AlertCircle, CheckCircle2, XCircle, Clock, HelpCircle, Download, FileSpreadsheet } from 'lucide-react';
import {
  getPickerPerformance,
  getPickerPlaysForInspection,
  getSeededGameByGameRollups,
  downloadPickerExport,
  exportPickerFullDatasetCsv,
  exportPickerGameByGameCsv,
  normalizeMarketKey,
  InspectedPickerPlay
} from '../../lib/picker_grading';
import { fmtAmerican } from '../../lib/odds';

interface Props {
  sport: 'nhl' | 'nba';
  sportLabel: string;
}

export const PickerHistoryPanel: React.FC<Props> = ({ sport, sportLabel }) => {
  const [scope, setScope] = useState<'all' | '7d' | 'today'>('all');
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [bucketFilter, setBucketFilter] = useState<'all' | 'edge' | 'safe' | 'avoid'>('all');
  const [resultFilter, setResultFilter] = useState<'all' | 'HIT' | 'MISS' | 'PUSH' | 'VOID' | 'PENDING'>('all');
  const [potdOnly, setPotdOnly] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'plays' | 'gbg'>('plays');
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    const onGraded = () => setRefreshNonce(n => n + 1);
    window.addEventListener('gatekeep_picker_graded', onGraded);
    window.addEventListener('gatekeep_odds_imported', onGraded);
    return () => {
      window.removeEventListener('gatekeep_picker_graded', onGraded);
      window.removeEventListener('gatekeep_odds_imported', onGraded);
    };
  }, []);

  const allPlaysForMarkets = useMemo(() => {
    return getPickerPlaysForInspection(sport, scope, todayIso, 'all', 'all', 'all', false);
  }, [sport, scope, todayIso, refreshNonce]);

  const availableMarkets = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const p of allPlaysForMarkets) {
      const k = normalizeMarketKey(p.market);
      const label = p.marketLabel || (k === 'shots' ? 'Shots' : k === 'points' ? 'Points' : k.toUpperCase());
      const cur = map.get(k);
      if (cur) cur.count++;
      else map.set(k, { key: k, label, count: 1 });
    }
    return Array.from(map.values());
  }, [allPlaysForMarkets]);

  const perf = useMemo(() => {
    return getPickerPerformance(sport, scope, todayIso, marketFilter);
  }, [sport, scope, todayIso, marketFilter, refreshNonce]);

  const plays = useMemo(() => {
    return getPickerPlaysForInspection(sport, scope, todayIso, bucketFilter, resultFilter, marketFilter, potdOnly);
  }, [sport, scope, todayIso, bucketFilter, resultFilter, marketFilter, potdOnly, refreshNonce]);

  const rollups = useMemo(() => {
    return getSeededGameByGameRollups(sport);
  }, [sport, refreshNonce]);

  return (
    <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] space-y-4 font-mono">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222d3e] pb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Crown className="w-4 h-4 text-amber-400" />
            <h2 className="text-base font-bold uppercase tracking-wide text-white">
              {sportLabel} Picker Ledger &amp; Seeded History
            </h2>
            <span className="px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-600/60 text-[10px] font-bold">
              Exclusive Edge &gt; Safe &gt; Avoid · POTD Tracked
            </span>
          </div>
          <p className="text-xs text-[#8b97ac] mt-0.5 font-sans">
            Historical decided picker plays and daily slate snapshots (multi-market, self-graded, idempotent).
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-[#0b0f14] p-0.5 rounded-lg border border-[#222d3e] text-[11px]">
            <button
              onClick={() => setScope('all')}
              className={`px-2.5 py-1 rounded transition cursor-pointer ${scope === 'all' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'}`}
            >
              All History
            </button>
            <button
              onClick={() => setScope('7d')}
              className={`px-2.5 py-1 rounded transition cursor-pointer ${scope === '7d' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'}`}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => setScope('today')}
              className={`px-2.5 py-1 rounded transition cursor-pointer ${scope === 'today' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'}`}
            >
              Today
            </button>
          </div>

          <button
            onClick={() => {
              const csv = exportPickerGameByGameCsv(sport, scope, todayIso);
              downloadPickerExport(`gatekeep_${sport}_picker_gbg_${scope}_${todayIso}.csv`, csv);
            }}
            className="px-2.5 py-1 rounded-lg bg-[#182232] hover:bg-[#202d42] border border-[#222d3e] text-[#8b97ac] hover:text-white text-[11px] flex items-center gap-1 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Game-by-Game CSV</span>
          </button>
          <button
            onClick={() => {
              const csv = exportPickerFullDatasetCsv(sport, scope, todayIso);
              downloadPickerExport(`gatekeep_${sport}_picker_full_${scope}_${todayIso}.csv`, csv);
            }}
            className="px-2.5 py-1 rounded-lg bg-[#182232] hover:bg-[#202d42] border border-[#222d3e] text-[#8b97ac] hover:text-white text-[11px] flex items-center gap-1 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Full CSV</span>
          </button>
        </div>
      </div>

      {/* Exclusive Bucket + POTD KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        <div
          onClick={() => setBucketFilter(b => (b === 'edge' ? 'all' : 'edge'))}
          className={`p-3 rounded-xl border cursor-pointer transition ${
            bucketFilter === 'edge' ? 'bg-emerald-950/60 border-emerald-500' : 'bg-[#0f1520] border-[#222d3e] hover:border-emerald-500/60'
          }`}
        >
          <div className="text-[10px] uppercase text-emerald-400 font-bold flex items-center gap-1">
            <Flame className="w-3 h-3" /> Edge Bucket
          </div>
          <div className="text-xl font-bold text-white mt-0.5">
            {perf.edge.hitRate !== null ? `${perf.edge.hitRate.toFixed(1)}%` : '—'}
          </div>
          <div className="text-[10px] text-[#8b97ac]">
            {perf.edge.hits}W - {perf.edge.misses}L ({perf.edge.decided} decided)
          </div>
        </div>

        <div
          onClick={() => setBucketFilter(b => (b === 'safe' ? 'all' : 'safe'))}
          className={`p-3 rounded-xl border cursor-pointer transition ${
            bucketFilter === 'safe' ? 'bg-cyan-950/60 border-cyan-500' : 'bg-[#0f1520] border-[#222d3e] hover:border-cyan-500/60'
          }`}
        >
          <div className="text-[10px] uppercase text-cyan-400 font-bold flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Safe Bucket
          </div>
          <div className="text-xl font-bold text-white mt-0.5">
            {perf.safe.hitRate !== null ? `${perf.safe.hitRate.toFixed(1)}%` : '—'}
          </div>
          <div className="text-[10px] text-[#8b97ac]">
            {perf.safe.hits}W - {perf.safe.misses}L ({perf.safe.decided} decided)
          </div>
        </div>

        <div
          onClick={() => setBucketFilter(b => (b === 'avoid' ? 'all' : 'avoid'))}
          className={`p-3 rounded-xl border cursor-pointer transition ${
            bucketFilter === 'avoid' ? 'bg-rose-950/60 border-rose-500' : 'bg-[#0f1520] border-[#222d3e] hover:border-rose-500/60'
          }`}
        >
          <div className="text-[10px] uppercase text-rose-400 font-bold flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Avoid Bucket
          </div>
          <div className="text-xl font-bold text-[#8b97ac] mt-0.5">
            {perf.avoid.hitRate !== null ? `${perf.avoid.hitRate.toFixed(1)}%` : '—'}
          </div>
          <div className="text-[10px] text-[#8b97ac]">
            {perf.avoid.hits}W - {perf.avoid.misses}L ({perf.avoid.decided} decided)
          </div>
        </div>

        <div
          onClick={() => setPotdOnly(v => !v)}
          className={`p-3 rounded-xl border cursor-pointer transition ${
            potdOnly ? 'bg-amber-950/60 border-amber-400' : 'bg-[#0f1520] border-[#222d3e] hover:border-amber-400/60'
          }`}
        >
          <div className="text-[10px] uppercase text-amber-300 font-bold flex items-center gap-1">
            <Crown className="w-3 h-3 text-amber-400" /> POTD Record
          </div>
          <div className="text-xl font-bold text-amber-300 mt-0.5">
            {perf.potd && perf.potd.hitRate !== null ? `${perf.potd.hitRate.toFixed(1)}%` : '—'}
          </div>
          <div className="text-[10px] text-[#8b97ac]">
            {perf.potd ? `${perf.potd.hits}W - ${perf.potd.misses}L (${perf.potd.decided} decided)` : '0 decided'}
          </div>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0b0f14] p-2.5 rounded-xl border border-[#222d3e] text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setViewMode('plays')}
            className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${viewMode === 'plays' ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#182232] text-[#8b97ac] hover:text-white'}`}
          >
            Play-by-Play ({plays.length})
          </button>
          <button
            onClick={() => setViewMode('gbg')}
            className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${viewMode === 'gbg' ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#182232] text-[#8b97ac] hover:text-white'}`}
          >
            Game Rollups ({rollups.length})
          </button>

          {availableMarkets.length > 0 && viewMode === 'plays' && (
            <div className="flex items-center gap-1 ml-2 flex-wrap">
              <span className="text-[10px] text-[#556277] uppercase font-bold">Mkt:</span>
              <button
                onClick={() => setMarketFilter('all')}
                className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${marketFilter === 'all' ? 'bg-sky-500 text-slate-950 font-bold' : 'bg-[#182232] text-[#8b97ac] hover:text-white'}`}
              >
                All ({allPlaysForMarkets.length})
              </button>
              {availableMarkets.map(m => (
                <button
                  key={m.key}
                  onClick={() => setMarketFilter(m.key)}
                  className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${marketFilter === m.key ? 'bg-sky-500 text-slate-950 font-bold' : 'bg-[#182232] text-[#8b97ac] hover:text-white'}`}
                >
                  {m.label} ({m.count})
                </button>
              ))}
            </div>
          )}
        </div>

        {viewMode === 'plays' && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={bucketFilter}
              onChange={e => setBucketFilter(e.target.value as any)}
              className="bg-[#182232] text-white text-[11px] border border-[#222d3e] rounded-lg px-2 py-1 outline-none cursor-pointer"
            >
              <option value="all">All Buckets</option>
              <option value="edge">Edge Only</option>
              <option value="safe">Safe Only</option>
              <option value="avoid">Avoid Only</option>
            </select>
            <select
              value={resultFilter}
              onChange={e => setResultFilter(e.target.value as any)}
              className="bg-[#182232] text-white text-[11px] border border-[#222d3e] rounded-lg px-2 py-1 outline-none cursor-pointer"
            >
              <option value="all">All Results</option>
              <option value="HIT">WON</option>
              <option value="MISS">LOST</option>
              <option value="VOID">VOID</option>
              <option value="PENDING">PENDING</option>
            </select>
            <button
              onClick={() => setPotdOnly(v => !v)}
              className={`px-2.5 py-1 text-[11px] rounded-lg border flex items-center gap-1 transition cursor-pointer ${
                potdOnly ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold' : 'bg-[#182232] text-amber-300 border-[#222d3e]'
              }`}
            >
              <Crown className="w-3 h-3" /> POTD Only
            </button>
          </div>
        )}
      </div>

      {/* Table / Rows */}
      {viewMode === 'gbg' ? (
        <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1 text-xs">
          {rollups.length === 0 ? (
            <div className="p-6 text-center text-[#556277] bg-[#0b0f14] rounded-xl border border-[#222d3e]">
              No game-by-game rollups seeded yet.
            </div>
          ) : rollups.map((g, idx) => (
            <div key={`${g.date}_${g.matchup}_${idx}`} className="p-2.5 rounded-xl bg-[#0b0f14] border border-[#222d3e] flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#182232] text-cyan-300 border border-[#222d3e]">{g.date}</span>
                <span className="font-bold text-white">{g.matchup}</span>
                <span className="text-[10px] text-[#8b97ac]">{g.totalPlays} plays · Edge {g.edgePlays} · Safe {g.safePlays}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-white">{g.hits}W - {g.misses}L</span>
                <span className={`font-bold ${(g.winRatePct ?? 0) >= 55 ? 'text-emerald-400' : 'text-amber-300'}`}>
                  {g.winRatePct !== null ? `${g.winRatePct.toFixed(1)}%` : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1 text-xs">
          {plays.length === 0 ? (
            <div className="p-6 text-center text-[#556277] bg-[#0b0f14] rounded-xl border border-[#222d3e]">
              No picker plays match the active filters.
            </div>
          ) : plays.slice(0, 150).map((p: InspectedPickerPlay, idx) => {
            const sideStr = p.side.toUpperCase();
            return (
              <div
                key={`${p.date}_${p.id}_${idx}`}
                className={`p-2.5 rounded-xl flex items-center justify-between gap-2 flex-wrap ${
                  p.isPotd ? 'bg-amber-950/20 border border-amber-500/70' : 'bg-[#0b0f14] border border-[#222d3e]'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#182232] text-cyan-300 border border-[#222d3e]">{p.date}</span>
                  {p.isPotd && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-slate-950 inline-flex items-center gap-1">
                      <Crown className="w-3 h-3 fill-current" /> POTD
                    </span>
                  )}
                  <span className="font-bold text-white truncate">{p.player}</span>
                  <span className="text-[10px] text-[#8b97ac]">{p.matchup || `${p.team} vs ${p.opp}`}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#182232] text-sky-300">{p.marketLabel || p.market}</span>
                  {p.isEdge && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">EDGE</span>}
                  {!p.isEdge && p.isSafe && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700">SAFE</span>}
                  {p.isAvoid && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-700">AVOID</span>}
                </div>

                <div className="flex items-center gap-2.5 shrink-0 flex-wrap justify-end">
                  <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${sideStr === 'OVER' ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-700/50' : 'text-orange-400 bg-orange-950/60 border border-orange-700/50'}`}>
                    {sideStr} {p.line}
                  </span>
                  <span className="text-white font-bold min-w-[40px] text-right">{p.odds != null ? fmtAmerican(p.odds) : '—'}</span>
                  <span className="text-[#8b97ac] min-w-[42px] text-right">{(p.prob * 100).toFixed(1)}%</span>
                  <span className={`min-w-[50px] text-right ${p.edge >= 0 ? 'text-emerald-400' : 'text-[#8b97ac]'}`}>
                    {p.edge >= 0 ? `+${p.edge.toFixed(1)}pp` : `${p.edge.toFixed(1)}pp`}
                  </span>
                  <div className="min-w-[110px] text-right">
                    {p.result === 'HIT' && (
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500 font-bold text-[10px] inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> WON ({p.actual ?? '—'})
                      </span>
                    )}
                    {p.result === 'MISS' && (
                      <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500 font-bold text-[10px] inline-flex items-center gap-1">
                        <XCircle className="w-3 h-3" /> LOST ({p.actual ?? '—'})
                      </span>
                    )}
                    {p.result === 'VOID' && (
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-[#8b97ac] border border-slate-700 text-[10px] inline-flex items-center gap-1">
                        <HelpCircle className="w-3 h-3" /> VOID
                      </span>
                    )}
                    {p.result === 'PUSH' && (
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-600 text-[10px] font-bold">
                        PUSH ({p.actual ?? '—'})
                      </span>
                    )}
                    {p.result === null && (
                      <span className="px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-600/60 text-[10px] inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" /> PENDING
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {plays.length > 150 && (
            <div className="text-center text-[11px] text-[#8b97ac] py-2">
              Showing first 150 of {plays.length} plays (use Market/Bucket/Result filters or export Full CSV).
            </div>
          )}
        </div>
      )}
    </div>
  );
};
