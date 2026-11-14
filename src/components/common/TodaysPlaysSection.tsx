import React, { useState, useMemo, useEffect } from 'react';
import {
  Copy, Check, Flame, ShieldCheck, AlertCircle, ArrowUpDown, Plus, Trophy,
  SlidersHorizontal, RotateCcw, Eye, X, CheckCircle2, XCircle, Clock, HelpCircle, RefreshCw,
  Download, FileSpreadsheet
} from 'lucide-react';
import { getEdgeColorClass, PlayerCardForm, isFormFightingLean } from '../../lib/player_card_form';
import { fmtAmerican } from '../../lib/odds';
import { CardRow } from '../../lib/card_core';
import { getOddsImportMeta } from '../../lib/pick_of_the_day';
import {
  freezePickerSnapshot,
  gradePickerWithCardRows,
  getPickerPerformance,
  clearDailyPickerSnapshot,
  getPickerPlaysForInspection,
  getAllSportsPickerPerformance,
  InspectedPickerPlay,
  getLastSweepMeta,
  LastSweepMeta,
  sweepPendingPickerGrades,
  getDailyPickerSnapshot,
  downloadPickerExport,
  exportPickerFullDatasetCsv,
  exportPickerGameByGameCsv
} from '../../lib/picker_grading';

export interface PlayItem {
  id: string | number;
  player: string;
  team: string;
  opp: string;
  market: string;
  marketLabel?: string;
  side: 'OVER' | 'UNDER' | 'over' | 'under';
  line: number;
  odds: number | null;
  pLean?: number; // 0..1
  prob?: number; // 0..1
  edge: number; // percentage points, e.g. 6.2
  ev?: number | null;
  hasMarket?: boolean;
  hasOdds?: boolean;
  modelMu?: number | null;
  unit?: string;
  form?: PlayerCardForm;
  formWarning?: boolean;
}

export type DeskPlayItem = PlayItem;

interface Props {
  sportLabel: string;
  sportKey?: 'nhl' | 'nba' | 'nfl' | 'mlb' | string;
  plays: PlayItem[];
  date?: string;
  cardRows?: CardRow[];
  onSelectPlay?: (play: PlayItem) => void;
  onAddToTicket?: (play: PlayItem) => void;
  onTriggerGrade?: () => Promise<void> | void;
}

const SAFE_THRESHOLDS = [
  { val: 0.55, label: '55%' },
  { val: 0.58, label: '58% (Default)' },
  { val: 0.60, label: '60%' },
  { val: 0.62, label: '62%' },
  { val: 0.65, label: '65%' },
  { val: 0.70, label: '70%' }
];

export const TodaysPlaysSection: React.FC<Props> = ({
  sportLabel,
  sportKey,
  plays,
  date,
  cardRows = [],
  onSelectPlay,
  onAddToTicket,
  onTriggerGrade
}) => {
  const sport = (sportKey || sportLabel.toLowerCase().slice(0, 3)).toLowerCase();
  const todayStr = date || new Date().toISOString().slice(0, 10);

  const [copied, setCopied] = useState(false);
  const [ticketAdded, setTicketAdded] = useState<string | number | null>(null);
  const [activeGroup, setActiveGroup] = useState<'all' | 'edge' | 'safe' | 'avoid'>('all');
  const [scope, setScope] = useState<'today' | '7d' | 'all'>('7d');

  // Clear / Reset snapshot state
  const [resetNonce, setResetNonce] = useState(0);
  const [clearNotice, setClearNotice] = useState(false);
  const [lastSweep, setLastSweep] = useState<LastSweepMeta | null>(() => getLastSweepMeta());

  // Performance Inspection Modal state
  const [isInspectionOpen, setIsInspectionOpen] = useState(false);
  const [inspectSport, setInspectSport] = useState<'current' | 'all'>('current');
  const [inspectBucket, setInspectBucket] = useState<'all' | 'edge' | 'safe' | 'avoid'>('all');
  const [inspectResult, setInspectResult] = useState<'all' | 'HIT' | 'MISS' | 'PUSH' | 'VOID' | 'PENDING'>('all');
  const [gradingBusy, setGradingBusy] = useState(false);

  // Persisted Safe Threshold per sport (default 0.58)
  const [safeThreshold, setSafeThreshold] = useState<number>(() => {
    try {
      const v = localStorage.getItem(`gatekeep_safe_thresh_${sport}`);
      if (v) {
        const n = parseFloat(v);
        if (!isNaN(n) && n >= 0.50 && n <= 0.85) return n;
      }
    } catch { /* ignore */ }
    return 0.58;
  });

  const handleSafeThresholdChange = (newVal: number) => {
    setSafeThreshold(newVal);
    try {
      localStorage.setItem(`gatekeep_safe_thresh_${sport}`, newVal.toString());
    } catch { /* ignore */ }
  };

  const probOf = (p: PlayItem): number => p.pLean ?? p.prob ?? 0.5;

  const handleClearTodayPicker = () => {
    if (confirm(`Clear today's (${todayStr}) saved picker snapshot for ${sportLabel}? This resets the saved performance record so corrected odds can take effect.`)) {
      clearDailyPickerSnapshot(sport, todayStr);
      setResetNonce(n => n + 1);
      setClearNotice(true);
      setTimeout(() => setClearNotice(false), 3000);
    }
  };

  // Auto-freeze official snapshot on odds import or when plays are available
  useEffect(() => {
    if (plays.length > 0) {
      const importMeta = getOddsImportMeta(sport, todayStr);
      const existing = getDailyPickerSnapshot(sport, todayStr);
      // Auto-update if no existing snapshot or if a newer odds import arrived
      const isNewerImport = importMeta && (!existing || existing.timestamp < importMeta.at);
      freezePickerSnapshot(sport, todayStr, plays, safeThreshold, !!isNewerImport);
    }
  }, [sport, todayStr, plays, safeThreshold, resetNonce]);

  // Listen for odds imports or grading sweep events
  useEffect(() => {
    const onOddsImported = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.sport === sport && detail.date === todayStr) {
        if (plays.length > 0) {
          freezePickerSnapshot(sport, todayStr, plays, safeThreshold, true);
          setResetNonce(n => n + 1);
        }
      }
    };
    const onGraded = (e: Event) => {
      setResetNonce(n => n + 1);
      setLastSweep(getLastSweepMeta());
    };
    window.addEventListener('gatekeep_odds_imported', onOddsImported);
    window.addEventListener('gatekeep_picker_graded', onGraded);
    return () => {
      window.removeEventListener('gatekeep_odds_imported', onOddsImported);
      window.removeEventListener('gatekeep_picker_graded', onGraded);
    };
  }, [sport, todayStr, plays, safeThreshold]);

  // Auto-grade against cardRows
  useEffect(() => {
    if (cardRows && cardRows.length > 0) {
      gradePickerWithCardRows(sport, cardRows);
    }
  }, [sport, cardRows, resetNonce]);


  // Partition plays strictly per rules
  // 1. Edge plays: high edge (edge > 0) + model probability >= 55% + has odds
  // 2. Safe plays: high model probability (>= safeThreshold) + has odds
  // 3. Avoid: no odds or model probability < 50%
  const groups = useMemo(() => {
    const edgePlays: PlayItem[] = [];
    const safePlays: PlayItem[] = [];
    const avoidPlays: PlayItem[] = [];

    for (const p of plays) {
      const prob = probOf(p);
      const hasOdds = (p.hasMarket !== false) && (p.hasOdds !== false) && p.odds != null;
      const validEdge = p.edge != null && Number.isFinite(p.edge) && Math.abs(p.edge) <= 50;

      // Avoid: no odds OR model probability < 50% OR invalid/missing edge
      if (!hasOdds || !validEdge || prob < 0.50) {
        avoidPlays.push(p);
        continue;
      }

      // Edge plays: requires valid posted price, valid edge_pp, edge > 0, model win >= 55%
      if (p.edge > 0 && prob >= 0.55) {
        edgePlays.push(p);
      }

      // Safe plays: model win >= safeThreshold, valid posted price and valid edge
      if (prob >= safeThreshold) {
        safePlays.push(p);
      }
    }

    // Sort edge plays by edge descending
    edgePlays.sort((a, b) => b.edge - a.edge);

    // Sort safe plays by probability descending
    safePlays.sort((a, b) => probOf(b) - probOf(a));

    return { edgePlays, safePlays, avoidPlays };
  }, [plays, safeThreshold]);

  // Picker performance stats for the selected scope
  const perf = useMemo(() => {
    return getPickerPerformance(sport, scope, todayStr);
  }, [sport, scope, todayStr, cardRows, plays]);

  // Handle clipboard copy
  const handleCopyEdgePlays = async () => {
    if (groups.edgePlays.length === 0) return;

    const header = `GATEKEEP SPORTS DESK — TODAY'S ${sportLabel.toUpperCase()} EDGE PLAYS\n` +
      `Date: ${todayStr} | High Edge & P(Win) >= 55%\n` +
      `----------------------------------------------------------------------\n`;

    const rows = groups.edgePlays.map((p, i) => {
      const odds = p.odds != null ? fmtAmerican(p.odds) : '—';
      const side = p.side.toUpperCase();
      const mkt = p.marketLabel || p.market.toUpperCase();
      const evStr = p.ev != null ? ` · EV +${(p.ev * 100).toFixed(1)}%` : '';
      const prob = probOf(p);
      const edgeStr = p.edge != null && Number.isFinite(p.edge) && Math.abs(p.edge) <= 50 ? ` · Edge +${p.edge.toFixed(1)}pp` : '';
      return `${i + 1}. ${p.player} (${p.team} vs ${p.opp}) · ${mkt} ${side} ${p.line} (${odds}) · Model ${(prob * 100).toFixed(1)}%${edgeStr}${evStr}`;
    }).join('\n');

    const fullText = header + rows;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(fullText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = fullText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  const handleTicketAdd = (p: PlayItem) => {
    if (!onAddToTicket) return;
    onAddToTicket(p);
    setTicketAdded(p.id);
    setTimeout(() => setTicketAdded(null), 1800);
  };

  const displayedList = useMemo(() => {
    if (activeGroup === 'edge') return groups.edgePlays;
    if (activeGroup === 'safe') return groups.safePlays;
    if (activeGroup === 'avoid') return groups.avoidPlays;
    // 'all': concatenate edge, safe, and other ranked plays
    const seen = new Set<string | number>();
    const out: PlayItem[] = [];
    for (const p of [...groups.edgePlays, ...groups.safePlays, ...plays]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
    return out;
  }, [activeGroup, groups, plays]);

  const handleExportFull = (sportTarget: string = sportKey || sport || 'all') => {
    const csv = exportPickerFullDatasetCsv(sportTarget, scope, todayStr);
    const fname = `gatekeep_${sportTarget}_picker_full_dataset_${scope}_${todayStr}.csv`;
    downloadPickerExport(fname, csv);
  };

  const handleExportGameByGame = (sportTarget: string = sportKey || sport || 'all') => {
    const csv = exportPickerGameByGameCsv(sportTarget, scope, todayStr);
    const fname = `gatekeep_${sportTarget}_picker_game_by_game_${scope}_${todayStr}.csv`;
    downloadPickerExport(fname, csv);
  };

  return (
    <div className="bg-[#121824] rounded-2xl border border-[#222d3e] p-4 space-y-3 font-mono">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222d3e] pb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Today&apos;s Plays ({sportLabel})
          </h3>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Safe Threshold Selector */}
          <div className="flex items-center gap-1.5 bg-[#0b0f14] px-2.5 py-1 rounded-xl border border-[#222d3e] text-xs">
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] text-[#8b97ac]">Min Safe:</span>
            <select
              value={safeThreshold}
              onChange={e => handleSafeThresholdChange(parseFloat(e.target.value))}
              className="bg-[#182232] text-cyan-300 font-bold border border-[#222d3e] rounded px-1.5 py-0.5 text-xs outline-none cursor-pointer"
            >
              {SAFE_THRESHOLDS.map(t => (
                <option key={t.val} value={t.val}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Action Button: Clear Today's Picker */}
          <button
            onClick={handleClearTodayPicker}
            className="px-2.5 py-1.5 rounded-xl bg-[#182232] hover:bg-[#202d42] border border-amber-500/40 text-amber-300 hover:text-amber-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
            title="Clear today's saved picker snapshot to recalculate and re-freeze with corrected odds"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>Clear Today&apos;s Card</span>
          </button>

          {/* Action Button: One-click Copy Today's Edge Plays */}
          <button
            onClick={handleCopyEdgePlays}
            disabled={groups.edgePlays.length === 0}
            className="px-3 py-1.5 rounded-xl bg-[#182232] hover:bg-[#202d42] border border-cyan-500/40 text-cyan-300 hover:text-cyan-200 disabled:opacity-40 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:cursor-not-allowed shadow-sm"
            title="Copy formatted summary of all qualified edge plays to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
            <span>{copied ? 'Copied to Clipboard!' : `Copy Edge Plays (${groups.edgePlays.length})`}</span>
          </button>
        </div>
      </div>

      {clearNotice && (
        <div className="p-2.5 rounded-xl bg-amber-950/80 border border-amber-600/70 text-amber-200 text-xs flex items-center justify-between font-mono animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-amber-400" />
            <span>Today&apos;s picker snapshot cleared. Re-evaluated fresh plays from the current board.</span>
          </div>
          <button onClick={() => setClearNotice(false)} className="text-amber-400 hover:text-white cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}


      {/* 4 Bucket Selector Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1">
        <button
          onClick={() => setActiveGroup('edge')}
          className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
            activeGroup === 'edge'
              ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-md'
              : 'bg-[#0f1520] border-[#222d3e] text-[#8b97ac] hover:text-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
              <Flame className="w-3 h-3 text-emerald-400" /> Edge Plays
            </span>
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700">
              {groups.edgePlays.length}
            </span>
          </div>
          <p className="text-[10px] text-[#8b97ac] mt-1">High edge + model win &ge; 55%</p>
        </button>

        <button
          onClick={() => setActiveGroup('safe')}
          className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
            activeGroup === 'safe'
              ? 'bg-cyan-950/70 border-cyan-500 text-white shadow-md'
              : 'bg-[#0f1520] border-[#222d3e] text-[#8b97ac] hover:text-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-cyan-400 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-cyan-400" /> Safe Plays
            </span>
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700">
              {groups.safePlays.length}
            </span>
          </div>
          <p className="text-[10px] text-[#8b97ac] mt-1">High model win (&ge; {(safeThreshold * 100).toFixed(0)}%)</p>
        </button>

        <button
          onClick={() => setActiveGroup('avoid')}
          className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
            activeGroup === 'avoid'
              ? 'bg-rose-950/70 border-rose-500 text-white shadow-md'
              : 'bg-[#0f1520] border-[#222d3e] text-[#8b97ac] hover:text-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 text-rose-400" /> Avoid
            </span>
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-700">
              {groups.avoidPlays.length}
            </span>
          </div>
          <p className="text-[10px] text-[#8b97ac] mt-1">No odds or win &lt; 50%</p>
        </button>

        <button
          onClick={() => setActiveGroup('all')}
          className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
            activeGroup === 'all'
              ? 'bg-purple-950/70 border-purple-500 text-white shadow-md'
              : 'bg-[#0f1520] border-[#222d3e] text-[#8b97ac] hover:text-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-300 flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-purple-400" /> All Plays
            </span>
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-[#182232] text-white border border-[#222d3e]">
              {plays.length}
            </span>
          </div>
          <p className="text-[10px] text-[#8b97ac] mt-1">Full sorted edge list</p>
        </button>
      </div>

      {/* Plays List Preview */}
      {displayedList.length === 0 ? (
        <div className="p-4 text-center text-xs text-[#556277] bg-[#0f1520] rounded-xl border border-[#222d3e]">
          No plays qualify for the selected group.
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1 text-xs">
          {displayedList.map(p => {
            const edgeColor = getEdgeColorClass(p.edge, p.hasMarket);
            const sideStr = p.side.toUpperCase();
            const prob = probOf(p);
            const isAdded = ticketAdded === p.id;
            const unit = p.unit || '';
            const l5 = p.form?.l5;
            const l10 = p.form?.l10;
            const l5Str = l5 && l5.games > 0
              ? `L5 ${l5.hits}/${l5.games} · avg ${l5.avgStat}${unit}`
              : 'L5 —';
            const l10Str = l10 && l10.games > 0
              ? `L10 ${l10.hits}/${l10.games} · avg ${l10.avgStat}${unit}`
              : 'L10 —';
            const fightsForm = p.formWarning ?? isFormFightingLean(p.form, sideStr, p.line);

            return (
              <div
                key={p.id}
                onClick={() => onSelectPlay?.(p)}
                className={`p-2.5 rounded-xl flex flex-col gap-1.5 bg-[#0f1520] border border-[#222d3e] hover:border-slate-500 transition ${
                  onSelectPlay ? 'cursor-pointer' : ''
                }`}
              >
                {/* Primary Row */}
                <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-bold text-white truncate">{p.player}</span>
                    <span className="text-[10px] text-[#8b97ac] shrink-0">{p.team} vs {p.opp}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#182232] text-cyan-300 shrink-0">
                      {p.marketLabel || p.market}
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 flex-wrap sm:flex-nowrap justify-end">
                    <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                      sideStr === 'OVER' ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-700/50' : 'text-orange-400 bg-orange-950/60 border border-orange-700/50'
                    }`}>
                      {sideStr} {p.line}
                    </span>
                    <span className="text-white font-bold min-w-[42px] text-right font-mono">
                      {p.odds != null ? fmtAmerican(p.odds) : '—'}
                    </span>
                    {p.modelMu != null && (
                      <span className="text-sky-400 font-mono text-[11px] min-w-[48px] text-right" title="Model Expected Mean (μ)">
                        μ {p.modelMu >= 10 ? p.modelMu.toFixed(1) : p.modelMu.toFixed(2)}
                      </span>
                    )}
                    <span className="text-[#8b97ac] min-w-[45px] text-right font-mono">
                      {(prob * 100).toFixed(1)}%
                    </span>
                    <span className={`min-w-[58px] text-right font-mono ${edgeColor}`}>
                      {p.edge != null && Number.isFinite(p.edge) && Math.abs(p.edge) <= 50
                        ? `${p.edge >= 0 ? '+' : ''}${p.edge.toFixed(1)}pp`
                        : '—'}
                    </span>

                    {/* Add to Ticket Action Button */}
                    {onAddToTicket && p.odds != null && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleTicketAdd(p);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition cursor-pointer flex items-center gap-1 border ${
                          isAdded
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-500'
                            : 'bg-[#182232] hover:bg-[#202d42] text-cyan-300 border-[#222d3e]'
                        }`}
                        title="Send this leg into Ticket Builder"
                      >
                        {isAdded ? <Check className="w-3 h-3 text-emerald-400" /> : <Plus className="w-3 h-3 text-cyan-400" />}
                        <span>{isAdded ? 'Added' : 'Ticket'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Compact Form Line under primary row */}
                <div className={`pt-1 border-t border-[#1a2333]/80 flex items-center justify-between gap-2 text-[10.5px] font-mono select-none ${
                  fightsForm ? 'text-amber-400/90' : 'text-[#8b97ac]'
                }`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={fightsForm ? 'text-amber-300/90' : 'text-slate-300'}>
                      {l5Str}
                    </span>
                    <span className="text-[#3b4758]">·</span>
                    <span className={fightsForm ? 'text-amber-300/90' : 'text-slate-300'}>
                      {l10Str}
                    </span>

                    {fightsForm && (
                      <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-amber-950/70 text-amber-300 border border-amber-800/80 font-medium">
                        ⚠️ Form fights lean
                      </span>
                    )}

                    {p.form?.oppBadge && (
                      <span className={`text-[9.5px] px-1.5 py-0.2 rounded border font-semibold ${
                        p.form.oppBadge.includes('Soft')
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                          : 'bg-rose-950/60 text-rose-300 border-rose-800'
                      }`}>
                        {p.form.oppBadge}
                      </span>
                    )}

                    {p.form?.minutesTrend && (
                      <span className={`text-[9.5px] px-1.5 py-0.2 rounded border font-semibold ${
                        p.form.minutesTrend.direction === 'up'
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                          : 'bg-amber-950/60 text-amber-300 border-amber-800'
                      }`}>
                        {p.form.minutesTrend.text}
                      </span>
                    )}
                  </div>

                  {p.form?.whyThisLean && (
                    <span className="hidden md:inline text-[10px] text-[#6b798e] italic truncate max-w-xs" title={p.form.whyThisLean}>
                      {p.form.whyThisLean}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Picker Performance Section */}
      <div className="bg-[#0b0f14] p-3 rounded-xl border border-[#222d3e] space-y-2 mt-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#222d3e] pb-2">
          <div
            onClick={() => {
              setInspectBucket('all');
              setIsInspectionOpen(true);
            }}
            className="flex items-center gap-1.5 cursor-pointer group"
            title="Click to view all graded plays across this sport or all models"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition" />
            <span className="text-xs font-bold text-white uppercase tracking-wide group-hover:text-amber-300 transition flex items-center gap-1">
              Picker Performance (Self-Graded from Official Box Scores)
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {lastSweep && (
              <span className="text-[11px] font-mono text-[#8b97ac] bg-[#121824] px-2.5 py-1 rounded-lg border border-[#222d3e]">
                Last sweep: <span className="text-cyan-300 font-bold">{new Date(lastSweep.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> · {lastSweep.totalGraded > 0 ? `${lastSweep.totalGraded} updated` : 'all settled'}
              </span>
            )}

            {/* Scope Controls */}
            <div className="flex items-center gap-1 bg-[#121824] p-0.5 rounded-lg border border-[#222d3e]">
              <button
                onClick={() => setScope('today')}
                className={`px-2 py-0.5 text-[11px] font-mono rounded transition cursor-pointer ${
                  scope === 'today' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
                }`}
              >
                Today
              </button>
              <button
                onClick={() => setScope('7d')}
                className={`px-2 py-0.5 text-[11px] font-mono rounded transition cursor-pointer ${
                  scope === '7d' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
                }`}
              >
                Last 7 Days
              </button>
              <button
                onClick={() => setScope('all')}
                className={`px-2 py-0.5 text-[11px] font-mono rounded transition cursor-pointer ${
                  scope === 'all' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
                }`}
              >
                Cumulative
              </button>
            </div>

            {/* Inspect Button */}
            <button
              onClick={() => {
                setInspectBucket('all');
                setIsInspectionOpen(true);
              }}
              className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-[#182232] hover:bg-[#202d42] border border-cyan-500/40 text-cyan-300 flex items-center gap-1.5 transition cursor-pointer shadow-sm"
              title="Click to inspect all tracked plays and box score results"
            >
              <Eye className="w-3.5 h-3.5 text-cyan-400" />
              <span>Inspect Plays</span>
            </button>

            {/* Export Buttons */}
            <button
              onClick={() => handleExportGameByGame(sportKey)}
              className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-[#182232] hover:bg-[#202d42] border border-[#222d3e] hover:border-slate-500 text-[#8b97ac] hover:text-white flex items-center gap-1.5 transition cursor-pointer shadow-sm"
              title="Export game-by-game performance summary CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Game-by-Game</span>
            </button>
            <button
              onClick={() => handleExportFull(sportKey)}
              className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-[#182232] hover:bg-[#202d42] border border-[#222d3e] hover:border-slate-500 text-[#8b97ac] hover:text-white flex items-center gap-1.5 transition cursor-pointer shadow-sm"
              title="Export complete row-by-row dataset CSV for reference"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Full Dataset</span>
            </button>
          </div>
        </div>

        {/* 3 Interactive Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div
            onClick={() => {
              setInspectBucket('edge');
              setIsInspectionOpen(true);
            }}
            className="bg-[#121824] p-2.5 rounded-lg border border-[#222d3e] hover:border-emerald-500/70 hover:bg-[#141d2b] transition cursor-pointer group"
            title="Click to view all Edge Plays"
          >
            <div className="flex items-center justify-between text-[#8b97ac] text-[10px] uppercase font-bold">
              <span className="text-emerald-400 flex items-center gap-1 group-hover:text-emerald-300">
                <Flame className="w-3 h-3 text-emerald-400" /> Edge Bucket
              </span>
              <span className="text-[10px] text-cyan-400 opacity-80 group-hover:opacity-100">View plays &rarr;</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-lg font-bold font-mono ${perf.edge.hitRate !== null && perf.edge.hitRate >= 52.4 ? 'text-emerald-400' : 'text-white'}`}>
                {perf.edge.hitRate !== null ? `${perf.edge.hitRate.toFixed(1)}%` : '—'}
              </span>
              <span className="text-[11px] text-[#556277] font-mono">
                {perf.edge.hits}W - {perf.edge.misses}L ({perf.edge.decided} decided)
              </span>
            </div>
            {perf.edge.pending > 0 && (
              <span className="text-[10px] text-amber-400/90 block mt-0.5 font-mono">
                {perf.edge.pending} pending game(s)
              </span>
            )}
          </div>

          <div
            onClick={() => {
              setInspectBucket('safe');
              setIsInspectionOpen(true);
            }}
            className="bg-[#121824] p-2.5 rounded-lg border border-[#222d3e] hover:border-cyan-500/70 hover:bg-[#141d2b] transition cursor-pointer group"
            title="Click to view all Safe Plays"
          >
            <div className="flex items-center justify-between text-[#8b97ac] text-[10px] uppercase font-bold">
              <span className="text-cyan-400 flex items-center gap-1 group-hover:text-cyan-300">
                <ShieldCheck className="w-3 h-3 text-cyan-400" /> Safe Bucket
              </span>
              <span className="text-[10px] text-cyan-400 opacity-80 group-hover:opacity-100">View plays &rarr;</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-lg font-bold font-mono ${perf.safe.hitRate !== null && perf.safe.hitRate >= (safeThreshold * 100) ? 'text-cyan-400' : 'text-white'}`}>
                {perf.safe.hitRate !== null ? `${perf.safe.hitRate.toFixed(1)}%` : '—'}
              </span>
              <span className="text-[11px] text-[#556277] font-mono">
                {perf.safe.hits}W - {perf.safe.misses}L ({perf.safe.decided} decided)
              </span>
            </div>
            {perf.safe.pending > 0 && (
              <span className="text-[10px] text-amber-400/90 block mt-0.5 font-mono">
                {perf.safe.pending} pending game(s)
              </span>
            )}
          </div>

          <div
            onClick={() => {
              setInspectBucket('avoid');
              setIsInspectionOpen(true);
            }}
            className="bg-[#121824] p-2.5 rounded-lg border border-[#222d3e] hover:border-rose-500/70 hover:bg-[#141d2b] transition cursor-pointer group"
            title="Click to view all Avoid Plays"
          >
            <div className="flex items-center justify-between text-[#8b97ac] text-[10px] uppercase font-bold">
              <span className="text-rose-400 flex items-center gap-1 group-hover:text-rose-300">
                <AlertCircle className="w-3 h-3 text-rose-400" /> Avoid Bucket
              </span>
              <span className="text-[10px] text-cyan-400 opacity-80 group-hover:opacity-100">View plays &rarr;</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-lg font-bold font-mono text-[#8b97ac]">
                {perf.avoid.hitRate !== null ? `${perf.avoid.hitRate.toFixed(1)}%` : '—'}
              </span>
              <span className="text-[11px] text-[#556277] font-mono">
                {perf.avoid.hits}W - {perf.avoid.misses}L ({perf.avoid.decided} decided)
              </span>
            </div>
            {perf.avoid.pending > 0 ? (
              <span className="text-[10px] text-amber-400/90 block mt-0.5 font-mono">
                {perf.avoid.pending} pending game(s)
              </span>
            ) : (
              <span className="text-[10px] text-[#556277] block mt-0.5">
                Filtered due to negative edge or low probability
              </span>
            )}
          </div>
        </div>

        <div className="text-[10px] text-[#556277] flex items-center justify-between flex-wrap gap-1 pt-1">
          <span>Click any bucket card above to inspect individual plays &amp; box scores</span>
          <span>Deep audit (MAE, calibration) in History &amp; Calibration</span>
        </div>
      </div>

      {/* Picker Performance Audit & Plays Modal */}
      {isInspectionOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-[#0f1520] border border-[#222d3e] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col font-mono shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#222d3e] bg-[#121824]">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Picker Performance Audit &amp; Tracked Plays
                  </h3>
                  <p className="text-[11px] text-[#8b97ac]">
                    Individual plays frozen into daily picker cards and self-graded against official box scores
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsInspectionOpen(false)}
                className="p-1.5 rounded-lg text-[#8b97ac] hover:text-white hover:bg-[#1a2333] transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Controls & Filters */}
            <div className="p-3 bg-[#0b0f14] border-b border-[#222d3e] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Model / Sport Selector */}
                <div className="flex items-center gap-1 bg-[#121824] p-0.5 rounded-lg border border-[#222d3e]">
                  <button
                    onClick={() => setInspectSport('current')}
                    className={`px-2.5 py-1 text-xs font-mono rounded transition cursor-pointer ${
                      inspectSport === 'current' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
                    }`}
                  >
                    {sportLabel.toUpperCase()} Only
                  </button>
                  <button
                    onClick={() => setInspectSport('all')}
                    className={`px-2.5 py-1 text-xs font-mono rounded transition cursor-pointer ${
                      inspectSport === 'all' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
                    }`}
                  >
                    All Models (Cross-Sport)
                  </button>
                </div>

                {/* Bucket Filter */}
                <div className="flex items-center gap-1 bg-[#121824] p-0.5 rounded-lg border border-[#222d3e]">
                  <button
                    onClick={() => setInspectBucket('all')}
                    className={`px-2 py-1 text-[11px] rounded transition cursor-pointer ${
                      inspectBucket === 'all' ? 'bg-purple-600 text-white font-bold' : 'text-[#8b97ac] hover:text-white'
                    }`}
                  >
                    All Buckets
                  </button>
                  <button
                    onClick={() => setInspectBucket('edge')}
                    className={`px-2 py-1 text-[11px] rounded transition cursor-pointer ${
                      inspectBucket === 'edge' ? 'bg-emerald-600 text-white font-bold' : 'text-[#8b97ac] hover:text-white'
                    }`}
                  >
                    Edge
                  </button>
                  <button
                    onClick={() => setInspectBucket('safe')}
                    className={`px-2 py-1 text-[11px] rounded transition cursor-pointer ${
                      inspectBucket === 'safe' ? 'bg-cyan-600 text-white font-bold' : 'text-[#8b97ac] hover:text-white'
                    }`}
                  >
                    Safe
                  </button>
                  <button
                    onClick={() => setInspectBucket('avoid')}
                    className={`px-2 py-1 text-[11px] rounded transition cursor-pointer ${
                      inspectBucket === 'avoid' ? 'bg-rose-600 text-white font-bold' : 'text-[#8b97ac] hover:text-white'
                    }`}
                  >
                    Avoid
                  </button>
                </div>

                {/* Outcome Result Filter */}
                <select
                  value={inspectResult}
                  onChange={e => setInspectResult(e.target.value as any)}
                  className="bg-[#182232] text-white font-mono text-xs border border-[#222d3e] rounded-lg px-2.5 py-1 outline-none cursor-pointer"
                >
                  <option value="all">All Outcomes</option>
                  <option value="HIT">Won (Hits)</option>
                  <option value="MISS">Lost (Misses)</option>
                  <option value="PENDING">Pending (Live/Upcoming)</option>
                  <option value="PUSH">Pushes</option>
                  <option value="VOID">Voids (DNP)</option>
                </select>
              </div>

              {/* Modal Export and Grade Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleExportGameByGame(inspectSport)}
                  className="px-2.5 py-1 rounded-lg bg-[#182232] hover:bg-[#202d42] border border-[#222d3e] hover:border-slate-500 text-[#8b97ac] hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  title="Export game-by-game summary CSV for the filtered plays"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Game-by-Game CSV</span>
                </button>
                <button
                  onClick={() => handleExportFull(inspectSport)}
                  className="px-2.5 py-1 rounded-lg bg-[#182232] hover:bg-[#202d42] border border-[#222d3e] hover:border-slate-500 text-[#8b97ac] hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  title="Export complete row-by-row dataset CSV for the filtered plays"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Full Dataset CSV</span>
                </button>

                {/* Grade Trigger Button */}
                <button
                  onClick={async () => {
                    setGradingBusy(true);
                    try {
                      if (onTriggerGrade) {
                        await onTriggerGrade();
                      }
                      await sweepPendingPickerGrades({ force: true, manual: true });
                      setLastSweep(getLastSweepMeta());
                    } finally {
                      setGradingBusy(false);
                    }
                  }}
                  disabled={gradingBusy}
                  className="px-3 py-1 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-500 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                  title="Grade all pending plays against official box scores right now"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${gradingBusy ? 'animate-spin' : ''}`} />
                  <span>{gradingBusy ? 'Grading Live…' : 'Grade Pending Now'}</span>
                </button>
              </div>
            </div>

            {/* Modal Stats Bar */}
            {(() => {
              const currentActivePerf = inspectSport === 'all'
                ? getAllSportsPickerPerformance(scope, todayStr)
                : perf;
              const targetBucket = inspectBucket === 'edge' ? currentActivePerf.edge
                : inspectBucket === 'safe' ? currentActivePerf.safe
                : inspectBucket === 'avoid' ? currentActivePerf.avoid
                : {
                    hits: currentActivePerf.edge.hits + currentActivePerf.safe.hits,
                    misses: currentActivePerf.edge.misses + currentActivePerf.safe.misses,
                    voids: currentActivePerf.edge.voids + currentActivePerf.safe.voids,
                    pending: currentActivePerf.edge.pending + currentActivePerf.safe.pending,
                    decided: currentActivePerf.edge.decided + currentActivePerf.safe.decided,
                    hitRate: (currentActivePerf.edge.decided + currentActivePerf.safe.decided) > 0
                      ? parseFloat((((currentActivePerf.edge.hits + currentActivePerf.safe.hits) / (currentActivePerf.edge.decided + currentActivePerf.safe.decided)) * 100).toFixed(1))
                      : null
                  };

              return (
                <div className="px-4 py-2 bg-[#121824] border-b border-[#222d3e] flex items-center justify-between text-xs flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[#8b97ac]">
                      Scope: <strong className="text-white uppercase">{scope}</strong> ({inspectSport === 'all' ? 'All Models' : sportLabel})
                    </span>
                    <span className="text-[#8b97ac]">
                      Win Rate: <strong className="text-emerald-400">{targetBucket.hitRate !== null ? `${targetBucket.hitRate}%` : '—'}</strong>
                    </span>
                    <span className="text-[#8b97ac]">
                      Record: <strong className="text-white">{targetBucket.hits}W - {targetBucket.misses}L</strong> ({targetBucket.decided} decided)
                    </span>
                    {targetBucket.pending > 0 && (
                      <span className="text-amber-400 font-bold">
                        {targetBucket.pending} pending
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-[#556277]">
                    Official box score lines · Real minutes only
                  </span>
                </div>
              );
            })()}

            {/* Scrollable Plays Table */}
            <div className="overflow-y-auto flex-1 p-3 space-y-2 max-h-[55vh]">
              {(() => {
                const playsList = getPickerPlaysForInspection(
                  inspectSport === 'all' ? 'all' : sport,
                  scope,
                  todayStr,
                  inspectBucket,
                  inspectResult
                );

                if (playsList.length === 0) {
                  return (
                    <div className="p-8 text-center text-xs text-[#556277] bg-[#0b0f14] rounded-xl border border-[#222d3e]">
                      No tracked plays found matching the selected filters.
                    </div>
                  );
                }

                return playsList.map((p, idx) => {
                  const sideStr = p.side.toUpperCase();
                  const isWon = p.result === 'HIT';
                  const isLost = p.result === 'MISS';
                  const isPush = p.result === 'PUSH';
                  const isVoid = p.result === 'VOID';
                  const isPending = p.result === null;

                  return (
                    <div
                      key={`${p.date}_${p.sport}_${p.id}_${idx}`}
                      className="p-2.5 rounded-xl bg-[#0b0f14] border border-[#222d3e] flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap hover:border-slate-600 transition text-xs"
                    >
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-[#182232] text-cyan-300 border border-[#222d3e]">
                          {p.date} · {p.sport.toUpperCase()}
                        </span>
                        <span className="font-bold text-white truncate">{p.player}</span>
                        <span className="text-[10px] text-[#8b97ac]">{p.team} vs {p.opp}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#182232] text-sky-300">
                          {p.marketLabel || p.market}
                        </span>

                        {p.isEdge && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700">
                            EDGE
                          </span>
                        )}
                        {p.isSafe && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-700">
                            SAFE
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0 flex-wrap justify-end">
                        <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                          sideStr === 'OVER'
                            ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-700/50'
                            : 'text-orange-400 bg-orange-950/60 border border-orange-700/50'
                        }`}>
                          {sideStr} {p.line}
                        </span>

                        <span className="text-white font-bold min-w-[42px] text-right font-mono">
                          {p.odds != null ? fmtAmerican(p.odds) : '—'}
                        </span>

                        <span className="text-[#8b97ac] min-w-[45px] text-right font-mono">
                          {(p.prob * 100).toFixed(1)}%
                        </span>

                        <span className="min-w-[55px] text-right font-mono text-emerald-400">
                          {p.edge > 0 ? `+${p.edge.toFixed(1)}pp` : `${p.edge.toFixed(1)}pp`}
                        </span>

                        {/* Result Badge */}
                        <div className="min-w-[130px] text-right">
                          {isWon && (
                            <span className="px-2 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-500 font-bold text-[11px] flex items-center gap-1 justify-end">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>WON (Act: {p.actual})</span>
                            </span>
                          )}
                          {isLost && (
                            <span className="px-2 py-1 rounded bg-rose-950 text-rose-300 border border-rose-500 font-bold text-[11px] flex items-center gap-1 justify-end">
                              <XCircle className="w-3.5 h-3.5 text-rose-400" />
                              <span>LOST (Act: {p.actual})</span>
                            </span>
                          )}
                          {isPush && (
                            <span className="px-2 py-1 rounded bg-slate-900 text-slate-300 border border-slate-600 font-bold text-[11px]">
                              PUSH (Act: {p.actual})
                            </span>
                          )}
                          {isVoid && (
                            <span className="px-2 py-1 rounded bg-slate-900 text-[#8b97ac] border border-slate-700 text-[11px] flex items-center gap-1 justify-end">
                              <HelpCircle className="w-3.5 h-3.5 text-[#8b97ac]" />
                              <span>VOID (DNP)</span>
                            </span>
                          )}
                          {isPending && (
                            <span
                              className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 justify-end font-semibold ${
                                p.date < todayStr
                                  ? 'bg-amber-950/90 text-amber-300 border border-amber-500/80'
                                  : 'bg-amber-950/60 text-amber-300 border border-amber-600/60'
                              }`}
                              title={
                                p.date < todayStr
                                  ? 'Game concluded or overnight; awaiting official box score release from league provider'
                                  : 'Game is live or scheduled later today'
                              }
                            >
                              <Clock className="w-3.5 h-3.5 text-amber-400" />
                              <span>{p.date < todayStr ? 'Box not ready' : 'PENDING'}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-[#121824] border-t border-[#222d3e] flex items-center justify-between text-[11px] text-[#8b97ac] flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span>Snapshots freeze at board lock or odds import. Never reshuffled retrospectively.</span>
                {lastSweep && (
                  <span className="font-mono text-cyan-400">
                    · Last sweep: {new Date(lastSweep.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({lastSweep.totalGraded > 0 ? `${lastSweep.totalGraded} updated` : 'all settled'})
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsInspectionOpen(false)}
                className="px-3 py-1 rounded-lg bg-[#182232] hover:bg-[#202d42] text-white border border-[#222d3e] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
