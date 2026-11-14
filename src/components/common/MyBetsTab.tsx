import React, { useState, useMemo } from 'react';
import {
  Plus,
  Upload,
  Download,
  RefreshCw,
  Search,
  Filter,
  Trash2,
  Edit2,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  HelpCircle,
  TrendingUp,
  Percent,
  Layers,
  FileSpreadsheet
} from 'lucide-react';
import {
  PersonalBet,
  BetSport,
  BetResult,
  summarizePersonalBets,
  reconcileBetsWithCardRows,
  exportBetsToCsv,
  exportBetsToJson,
  calcBetPnl
} from '../../lib/personal_bets';
import { CardRow } from '../../lib/card_core';
import { useDisplaySettings } from './DisplaySettingsContext';
import { LogBetModal } from './LogBetModal';
import { ImportBetsModal } from './ImportBetsModal';

interface MyBetsTabProps {
  bets: PersonalBet[];
  onSaveBet: (bet: PersonalBet) => void;
  onDeleteBet: (id: string) => void;
  onImportBets: (bets: PersonalBet[]) => void;
  onBulkUpdateBets: (bets: PersonalBet[]) => void;
  cardRows?: CardRow[];
  currentSport?: BetSport;
}

export const MyBetsTab: React.FC<MyBetsTabProps> = ({
  bets,
  onSaveBet,
  onDeleteBet,
  onImportBets,
  onBulkUpdateBets,
  cardRows = [],
  currentSport
}) => {
  const { displayCfg, formatStake, formatProfit } = useDisplaySettings();

  // Filters state - default to 'ALL' so portfolio shows all logged bets
  const [selectedSport, setSelectedSport] = useState<BetSport | 'ALL'>('ALL');
  const [selectedResult, setSelectedResult] = useState<string>('ALL');
  const [selectedMarket, setSelectedMarket] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Modals state
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [editingBet, setEditingBet] = useState<PersonalBet | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Available markets in current bets
  const availableMarkets = useMemo(() => {
    const set = new Set<string>();
    bets.forEach(b => { if (b.market) set.add(b.market.toLowerCase()); });
    return Array.from(set).sort();
  }, [bets]);

  // Filtered bets
  const filteredBets = useMemo(() => {
    return bets.filter(b => {
      if (selectedSport !== 'ALL' && b.sport !== selectedSport) return false;
      if (selectedResult !== 'ALL') {
        if (selectedResult === 'SETTLED' && b.result === 'PENDING') return false;
        if (selectedResult !== 'SETTLED' && b.result !== selectedResult) return false;
      }
      if (selectedMarket !== 'ALL' && b.market.toLowerCase() !== selectedMarket) return false;
      if (startDate && b.date < startDate) return false;
      if (endDate && b.date > endDate) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchPlayer = b.player.toLowerCase().includes(q);
        const matchTeam = (b.team || '').toLowerCase().includes(q);
        const matchOpp = (b.opp || '').toLowerCase().includes(q);
        const matchNotes = (b.notes || '').toLowerCase().includes(q);
        if (!matchPlayer && !matchTeam && !matchOpp && !matchNotes) return false;
      }
      return true;
    }).sort((a, b) => (b.date.localeCompare(a.date)) || (b.createdAt - a.createdAt));
  }, [bets, selectedSport, selectedResult, selectedMarket, startDate, endDate, searchQuery]);

  // Running totals across filtered subset (or all bets)
  const summary = useMemo(() => {
    return summarizePersonalBets(filteredBets);
  }, [filteredBets]);

  // Overall totals across all logged bets
  const overallSummary = useMemo(() => {
    return summarizePersonalBets(bets);
  }, [bets]);

  // Auto-grade against slate card rows
  const handleAutoGrade = () => {
    if (!cardRows.length) {
      setFeedbackMessage('No box score card rows loaded on current slate to match against.');
      setTimeout(() => setFeedbackMessage(null), 3500);
      return;
    }

    const { updatedBets, gradedCount } = reconcileBetsWithCardRows(bets, cardRows);
    if (gradedCount > 0) {
      onBulkUpdateBets(updatedBets);
      setFeedbackMessage(`Successfully auto-graded ${gradedCount} bet${gradedCount === 1 ? '' : 's'} against official box scores!`);
    } else {
      setFeedbackMessage('Checked official box scores: No matching pending bets found on this slate.');
    }
    setTimeout(() => setFeedbackMessage(null), 4000);
  };

  // Quick manual grade adjustment
  const handleQuickGrade = (bet: PersonalBet, newResult: BetResult) => {
    const updated: PersonalBet = {
      ...bet,
      result: newResult,
      gradedAt: newResult !== 'PENDING' ? Date.now() : null,
      pnl: calcBetPnl({ result: newResult, odds: bet.odds, stake: bet.stake })
    };
    onSaveBet(updated);
  };

  // Export handlers
  const handleExportCsv = () => {
    const csvStr = exportBetsToCsv(bets);
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `gatekeep_personal_bets_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJson = () => {
    const jsonStr = exportBetsToJson(bets);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `gatekeep_personal_bets_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sportColor = (s: BetSport) => {
    if (s === 'nba') return 'text-orange-400 bg-orange-950/60 border-orange-800/80';
    if (s === 'nhl') return 'text-cyan-400 bg-cyan-950/60 border-cyan-800/80';
    if (s === 'nfl') return 'text-sky-400 bg-sky-950/60 border-sky-800/80';
    return 'text-amber-400 bg-amber-950/60 border-amber-800/80';
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Top Banner & Title */}
      <div className="bg-[#121824] p-4 rounded-2xl border border-[#222d3e] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Personal Portfolio
            </span>
            <span className="bg-[#182232] text-[11px] px-2 py-0.5 rounded font-mono text-slate-400 border border-[#222d3e]">
              Independent from Model Card
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#182232] text-cyan-300 border border-[#222d3e]">
              Display: {displayCfg.mode === 'currency' ? `Currency ($1u = $${displayCfg.unitValue})` : 'Units (u)'}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold font-display text-white tracking-tight uppercase mt-1">
            My Logged Bets &amp; P&amp;L
          </h2>
          <p className="text-xs text-[#8b97ac]">
            Track only the bets you actually place across sportsbooks. Auto-grades against official box scores when available.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap self-stretch sm:self-auto">
          <button
            onClick={() => { setEditingBet(null); setIsLogModalOpen(true); }}
            className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-display uppercase tracking-wider text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Log New Bet</span>
          </button>

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-3 py-2 bg-[#182232] hover:bg-[#222d3e] text-cyan-300 border border-[#222d3e] text-xs font-mono font-semibold rounded-xl flex items-center gap-1.5 transition cursor-pointer"
            title="Import bets from CSV or JSON file"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Bulk Import</span>
          </button>

          <div className="flex items-center bg-[#0b0f14] rounded-xl border border-[#222d3e] p-0.5">
            <button
              onClick={handleExportCsv}
              disabled={bets.length === 0}
              className="px-2.5 py-1.5 text-xs font-mono text-[#8b97ac] hover:text-white disabled:opacity-40 transition flex items-center gap-1"
              title="Export all bets to CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>CSV</span>
            </button>
            <span className="text-[#222d3e]">|</span>
            <button
              onClick={handleExportJson}
              disabled={bets.length === 0}
              className="px-2.5 py-1.5 text-xs font-mono text-[#8b97ac] hover:text-white disabled:opacity-40 transition flex items-center gap-1"
              title="Export all bets to JSON"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>JSON</span>
            </button>
          </div>

          <button
            onClick={handleAutoGrade}
            className="px-3 py-2 bg-[#182232] hover:bg-[#222d3e] text-[#8b97ac] hover:text-white border border-[#222d3e] text-xs font-mono font-semibold rounded-xl flex items-center gap-1.5 transition cursor-pointer"
            title="Re-check pending bets against current loaded box score card rows"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Auto-Grade</span>
          </button>
        </div>
      </div>

      {feedbackMessage && (
        <div className="bg-[#182232] border border-cyan-500/50 text-cyan-200 px-4 py-2.5 rounded-xl text-xs font-mono flex items-center justify-between animate-fade-in">
          <span>{feedbackMessage}</span>
          <button onClick={() => setFeedbackMessage(null)} className="text-[#8b97ac] hover:text-white">
            &times;
          </button>
        </div>
      )}

      {/* KPI Running Summary Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total Bets */}
        <div className="bg-[#121824] p-3.5 rounded-2xl border border-[#222d3e] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#8b97ac] mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider">Total / Pending</span>
            <Layers className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{summary.totalBets}</span>
            <span className="text-xs font-mono text-sky-400">({summary.pendingBets} pending)</span>
          </div>
          <span className="text-[10px] font-mono text-[#556277] mt-1">
            {summary.settledBets} settled ({summary.hits}W - {summary.misses}L - {summary.pushes}P)
          </span>
        </div>

        {/* Win Rate */}
        <div className="bg-[#121824] p-3.5 rounded-2xl border border-[#222d3e] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#8b97ac] mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider">Win Rate</span>
            <Percent className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {summary.settledBets > 0 ? `${summary.winRate.toFixed(1)}%` : '—'}
            </span>
            <span className="text-xs font-mono text-[#8b97ac]">
              {summary.hits}/{summary.hits + summary.misses}
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#556277] mt-1">
            Standard win rate (pushes/voids excluded)
          </span>
        </div>

        {/* Net Units / Currency P&L */}
        <div className="bg-[#121824] p-3.5 rounded-2xl border border-[#222d3e] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#8b97ac] mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider">Net Profit / P&amp;L</span>
            <TrendingUp className={`w-4 h-4 ${summary.netUnits >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold font-mono ${
              summary.netUnits > 0 ? 'text-emerald-400' : summary.netUnits < 0 ? 'text-rose-400' : 'text-slate-300'
            }`}>
              {formatProfit(summary.netUnits)}
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#556277] mt-1">
            {displayCfg.mode === 'currency' ? `Converted from ${summary.netUnits >= 0 ? '+' : ''}${summary.netUnits.toFixed(2)}u` : 'Net units earned'}
          </span>
        </div>

        {/* Total Risked & ROI */}
        <div className="bg-[#121824] p-3.5 rounded-2xl border border-[#222d3e] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#8b97ac] mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider">Staked &amp; ROI</span>
            <span className="text-[10px] font-mono text-cyan-400">
              ROI: {summary.settledStaked > 0 ? `${summary.roi >= 0 ? '+' : ''}${summary.roi.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {formatStake(summary.settledStaked)}
            </span>
            <span className="text-xs font-mono text-[#8b97ac]">settled</span>
          </div>
          <span className="text-[10px] font-mono text-[#556277] mt-1">
            Total active staked: {formatStake(summary.totalStaked)}
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-[#121824] p-3.5 rounded-2xl border border-[#222d3e] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Sport Selector Pills */}
          <div className="flex items-center gap-1 bg-[#0b0f14] p-1 rounded-xl border border-[#222d3e]">
            <button
              onClick={() => setSelectedSport('ALL')}
              className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg transition ${
                selectedSport === 'ALL' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              All Sports ({overallSummary.totalBets})
            </button>
            {(['nba', 'nhl', 'nfl', 'mlb'] as BetSport[]).map(s => {
              const count = bets.filter(b => b.sport === s).length;
              return (
                <button
                  key={s}
                  onClick={() => setSelectedSport(s)}
                  className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg transition ${
                    selectedSport === s
                      ? s === 'nba' ? 'bg-orange-500 text-slate-950 font-bold'
                        : s === 'nhl' ? 'bg-cyan-400 text-slate-950 font-bold'
                        : s === 'nfl' ? 'bg-sky-500 text-slate-950 font-bold'
                        : 'bg-amber-400 text-amber-950 font-bold'
                      : 'text-[#8b97ac] hover:text-white'
                  }`}
                >
                  {s.toUpperCase()} ({count})
                </button>
              );
            })}
          </div>

          {/* Result Filter Selector */}
          <div className="flex items-center gap-1.5 bg-[#0b0f14] p-1 rounded-xl border border-[#222d3e]">
            {[
              { id: 'ALL', label: 'All Results' },
              { id: 'PENDING', label: 'Pending' },
              { id: 'SETTLED', label: 'Settled' },
              { id: 'HIT', label: 'Hits' },
              { id: 'MISS', label: 'Misses' }
            ].map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedResult(r.id)}
                className={`px-2.5 py-1 text-xs font-mono rounded-lg transition ${
                  selectedResult === r.id
                    ? 'bg-slate-700 text-white font-bold'
                    : 'text-[#8b97ac] hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date, Market & Search Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#222d3e]/70">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search Input */}
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-[#556277] absolute left-2.5" />
              <input
                type="text"
                placeholder="Search player, team or notes…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-[#0b0f14] border border-[#222d3e] text-white text-xs pl-8 pr-3 py-1.5 rounded-xl font-mono focus:border-cyan-400 outline-none w-52 sm:w-64"
              />
            </div>

            {/* Market Filter */}
            {availableMarkets.length > 0 && (
              <div className="flex items-center gap-1 text-xs font-mono">
                <Filter className="w-3.5 h-3.5 text-[#8b97ac]" />
                <select
                  value={selectedMarket}
                  onChange={e => setSelectedMarket(e.target.value)}
                  className="bg-[#0b0f14] border border-[#222d3e] text-white text-xs px-2.5 py-1.5 rounded-xl font-mono outline-none focus:border-cyan-400 cursor-pointer"
                >
                  <option value="ALL">All Markets</option>
                  {availableMarkets.map(m => (
                    <option key={m} value={m}>{m.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Date range inputs */}
            <div className="flex items-center gap-1.5 text-xs font-mono text-[#8b97ac]">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" />
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-[#0b0f14] border border-[#222d3e] text-white text-xs px-2 py-1 rounded-lg outline-none focus:border-cyan-400"
                title="Filter start date"
              />
              <span>to</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-[#0b0f14] border border-[#222d3e] text-white text-xs px-2 py-1 rounded-lg outline-none focus:border-cyan-400"
                title="Filter end date"
              />
              {(startDate || endDate || searchQuery || selectedResult !== 'ALL' || selectedMarket !== 'ALL') && (
                <button
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setSearchQuery('');
                    setSelectedResult('ALL');
                    setSelectedMarket('ALL');
                  }}
                  className="text-[11px] text-cyan-400 hover:underline ml-1"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <div className="text-xs font-mono text-[#8b97ac]">
            Showing <span className="text-white font-bold">{filteredBets.length}</span> of {bets.length} bets
          </div>
        </div>
      </div>

      {/* Bets List / Table */}
      {filteredBets.length === 0 ? (
        <div className="bg-[#121824] rounded-2xl border border-[#222d3e] p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-[#182232] border border-[#222d3e] flex items-center justify-center mx-auto text-[#8b97ac]">
            <Clock className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white font-display uppercase tracking-wide">
              {bets.length === 0 ? 'No Personal Bets Logged Yet' : 'No Bets Match Your Filters'}
            </h3>
            <p className="text-xs text-[#8b97ac] max-w-md mx-auto mt-1 font-mono">
              {bets.length === 0
                ? 'Record the wagers you place with sportsbooks. Click "+ Log Bet" to add manually, upload a CSV/JSON file, or click "+ Bet" on any desk row.'
                : 'Try clearing the search query or adjusting the sport and date filters.'}
            </p>
          </div>
          {bets.length === 0 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => { setEditingBet(null); setIsLogModalOpen(true); }}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-display uppercase tracking-wider text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>Log Your First Bet</span>
              </button>
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="px-4 py-2 bg-[#182232] hover:bg-[#222d3e] text-cyan-300 border border-[#222d3e] text-xs font-mono font-semibold rounded-xl flex items-center gap-1.5 transition cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import CSV / JSON</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[#0f1520] rounded-2xl border border-[#222d3e] overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[#222d3e] bg-[#121824] text-[#8b97ac] text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-3.5 font-semibold">Date &amp; Sport</th>
                  <th className="py-3 px-3.5 font-semibold">Player &amp; Matchup</th>
                  <th className="py-3 px-3.5 font-semibold">Market &amp; Pick</th>
                  <th className="py-3 px-3.5 font-semibold text-center">Odds</th>
                  <th className="py-3 px-3.5 font-semibold text-center">Stake</th>
                  <th className="py-3 px-3.5 font-semibold text-center">Actual</th>
                  <th className="py-3 px-3.5 font-semibold text-center">Result</th>
                  <th className="py-3 px-3.5 font-semibold text-right">Net P&amp;L</th>
                  <th className="py-3 px-3.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222d3e]/50">
                {filteredBets.map(bet => {
                  const pnl = bet.pnl !== undefined ? bet.pnl : calcBetPnl(bet);

                  return (
                    <tr
                      key={bet.id}
                      className={`hover:bg-[#121824]/80 transition ${
                        bet.result === 'HIT' ? 'bg-emerald-950/10' : bet.result === 'MISS' ? 'bg-rose-950/10' : ''
                      }`}
                    >
                      {/* Date & Sport */}
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${sportColor(bet.sport)}`}>
                            {bet.sport}
                          </span>
                          <span className="text-white text-xs">{bet.date}</span>
                        </div>
                      </td>

                      {/* Player & Matchup */}
                      <td className="py-3 px-3.5">
                        <div className="flex flex-col">
                          <span className="text-white font-bold text-sm tracking-tight">{bet.player}</span>
                          {(bet.team || bet.opp) && (
                            <span className="text-[10px] text-[#8b97ac]">
                              {bet.team} {bet.opp ? `vs ${bet.opp}` : ''}
                            </span>
                          )}
                          {bet.notes && (
                            <span className="text-[10px] text-cyan-400/80 truncate max-w-[200px]" title={bet.notes}>
                              &ldquo;{bet.notes}&rdquo;
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Market & Pick */}
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            bet.side === 'OVER'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-orange-950 text-orange-300 border border-orange-800'
                          }`}>
                            {bet.side} {bet.line}
                          </span>
                          <span className="text-[#8b97ac] uppercase text-[11px]">
                            {bet.market}
                          </span>
                        </div>
                      </td>

                      {/* Odds */}
                      <td className="py-3 px-3.5 text-center whitespace-nowrap">
                        <span className="text-white font-semibold">
                          {bet.odds > 0 ? `+${bet.odds}` : bet.odds}
                        </span>
                      </td>

                      {/* Stake */}
                      <td className="py-3 px-3.5 text-center whitespace-nowrap">
                        <span className="text-cyan-300 font-bold">
                          {formatStake(bet.stake)}
                        </span>
                      </td>

                      {/* Actual */}
                      <td className="py-3 px-3.5 text-center whitespace-nowrap">
                        {bet.actual !== null && bet.actual !== undefined ? (
                          <span className="text-white font-bold bg-[#182232] px-2 py-0.5 rounded border border-[#222d3e]">
                            {bet.actual}
                          </span>
                        ) : (
                          <span className="text-[#556277]">—</span>
                        )}
                      </td>

                      {/* Result Badge & Quick Grade */}
                      <td className="py-3 px-3.5 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded flex items-center gap-1 border ${
                            bet.result === 'HIT'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-500 shadow-sm shadow-emerald-950/50'
                              : bet.result === 'MISS'
                              ? 'bg-rose-950 text-rose-300 border-rose-500 shadow-sm shadow-rose-950/50'
                              : bet.result === 'PUSH'
                              ? 'bg-amber-950 text-amber-300 border-amber-600'
                              : bet.result === 'VOID'
                              ? 'bg-slate-800 text-slate-400 border-slate-700'
                              : 'bg-sky-950/80 text-sky-300 border-sky-600 animate-pulse'
                          }`}>
                            {bet.result === 'HIT' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                            {bet.result === 'MISS' && <XCircle className="w-3 h-3 text-rose-400" />}
                            {bet.result === 'PENDING' && <Clock className="w-3 h-3 text-sky-400" />}
                            {bet.result}
                          </span>

                          {/* Quick manual grade dropdown */}
                          <select
                            value={bet.result}
                            onChange={e => handleQuickGrade(bet, e.target.value as BetResult)}
                            className="bg-[#0b0f14] border border-[#222d3e] text-[10px] text-[#8b97ac] rounded px-1 py-0.5 outline-none hover:text-white cursor-pointer"
                            title="Quick manual result override"
                          >
                            <option value="PENDING">Pending</option>
                            <option value="HIT">Hit (Won)</option>
                            <option value="MISS">Miss (Lost)</option>
                            <option value="PUSH">Push</option>
                            <option value="VOID">Void</option>
                          </select>
                        </div>
                      </td>

                      {/* Net P&L */}
                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        {pnl !== null ? (
                          <span className={`font-bold text-sm ${
                            pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-rose-400' : 'text-[#8b97ac]'
                          }`}>
                            {formatProfit(pnl)}
                          </span>
                        ) : (
                          <span className="text-[#556277] text-xs">pending</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setEditingBet(bet); setIsLogModalOpen(true); }}
                            className="p-1 rounded text-[#8b97ac] hover:text-white hover:bg-[#182232] transition"
                            title="Edit this bet"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete bet on ${bet.player} (${bet.side} ${bet.line} ${bet.market})?`)) {
                                onDeleteBet(bet.id);
                              }
                            }}
                            className="p-1 rounded text-[#8b97ac] hover:text-rose-400 hover:bg-[#182232] transition"
                            title="Delete this bet"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <LogBetModal
        isOpen={isLogModalOpen}
        onClose={() => { setIsLogModalOpen(false); setEditingBet(null); }}
        onSave={onSaveBet}
        initialBet={editingBet}
      />

      <ImportBetsModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={onImportBets}
      />
    </div>
  );
};
