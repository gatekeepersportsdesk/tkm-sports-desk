import React, { useState, useEffect } from 'react';
import { X, Check, DollarSign } from 'lucide-react';
import { PersonalBet, BetSport, BetSide, BetResult, createPersonalBet } from '../../lib/personal_bets';
import { useDisplaySettings } from './DisplaySettingsContext';

interface LogBetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (bet: PersonalBet) => void;
  initialBet?: Partial<PersonalBet> | null;
}

const SPORT_MARKETS: Record<BetSport, { id: string; label: string }[]> = {
  nba: [
    { id: 'points', label: 'Points (PTS)' },
    { id: 'rebounds', label: 'Rebounds (REB)' },
    { id: 'assists', label: 'Assists (AST)' },
    { id: 'threes', label: '3-Pointers (3PM)' },
    { id: 'pra', label: 'PTS + REB + AST' },
    { id: 'steals', label: 'Steals (STL)' },
    { id: 'blocks', label: 'Blocks (BLK)' }
  ],
  nhl: [
    { id: 'sog', label: 'Shots on Goal (SOG)' },
    { id: 'points', label: 'Points (PTS)' }
  ],
  nfl: [
    { id: 'receptions', label: 'Receptions (REC)' }
  ],
  mlb: [
    { id: 'hits', label: '0.5+ Hits (HITS)' }
  ]
};

export const LogBetModal: React.FC<LogBetModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialBet
}) => {
  const { displayCfg, formatStake } = useDisplaySettings();

  const [sport, setSport] = useState<BetSport>('nba');
  const [player, setPlayer] = useState('');
  const [team, setTeam] = useState('');
  const [opp, setOpp] = useState('');
  const [market, setMarket] = useState('points');
  const [side, setSide] = useState<BetSide>('OVER');
  const [line, setLine] = useState('0.5');
  const [odds, setOdds] = useState('-110');
  const [stake, setStake] = useState('1.0');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [result, setResult] = useState<BetResult>('PENDING');
  const [actual, setActual] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialBet) {
        setSport(initialBet.sport || 'nba');
        setPlayer(initialBet.player || '');
        setTeam(initialBet.team || '');
        setOpp(initialBet.opp || '');
        setMarket(initialBet.market || (SPORT_MARKETS[initialBet.sport || 'nba'][0]?.id || 'points'));
        setSide(initialBet.side || 'OVER');
        setLine(initialBet.line !== undefined ? String(initialBet.line) : '0.5');
        setOdds(initialBet.odds !== undefined ? (initialBet.odds > 0 ? `+${initialBet.odds}` : String(initialBet.odds)) : '-110');
        setStake(initialBet.stake !== undefined ? String(initialBet.stake) : '1.0');
        setDate(initialBet.date || new Date().toISOString().split('T')[0]);
        setResult(initialBet.result || 'PENDING');
        setActual(initialBet.actual !== undefined && initialBet.actual !== null ? String(initialBet.actual) : '');
        setNotes(initialBet.notes || '');
      } else {
        setPlayer('');
        setTeam('');
        setOpp('');
        setLine('0.5');
        setOdds('-110');
        setStake('1.0');
        setDate(new Date().toISOString().split('T')[0]);
        setResult('PENDING');
        setActual('');
        setNotes('');
      }
      setError(null);
    }
  }, [isOpen, initialBet]);

  // Adjust default market when sport switches if market is not valid for sport
  const handleSportChange = (s: BetSport) => {
    setSport(s);
    const validMarkets = SPORT_MARKETS[s].map(m => m.id);
    if (!validMarkets.includes(market)) {
      setMarket(validMarkets[0] || 'points');
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!player.trim()) {
      setError('Player name is required.');
      return;
    }

    const parsedLine = parseFloat(line);
    if (isNaN(parsedLine) || parsedLine < 0) {
      setError('Please enter a valid line number (e.g. 24.5).');
      return;
    }

    const cleanOddsStr = odds.trim().replace('+', '');
    const parsedOdds = parseInt(cleanOddsStr, 10);
    if (isNaN(parsedOdds) || parsedOdds === 0) {
      setError('Please enter valid American odds (e.g. -110 or +135).');
      return;
    }

    const parsedStake = parseFloat(stake);
    if (isNaN(parsedStake) || parsedStake <= 0) {
      setError('Please enter a stake greater than 0.');
      return;
    }

    const parsedActual = actual.trim() !== '' ? parseFloat(actual) : null;

    const savedBet = createPersonalBet({
      id: initialBet?.id,
      date,
      sport,
      player: player.trim(),
      team: team.trim().toUpperCase(),
      opp: opp.trim().toUpperCase(),
      market: market.trim().toLowerCase(),
      side,
      line: parsedLine,
      odds: parsedOdds,
      stake: parsedStake,
      result,
      actual: parsedActual,
      notes: notes.trim(),
      source: initialBet?.id ? initialBet.source : 'manual'
    });

    onSave(savedBet);
    onClose();
  };

  const parsedStakeNum = parseFloat(stake) || 1.0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#0f1520] border border-[#222d3e] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#222d3e] bg-[#121824]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            <h3 className="font-display font-bold text-white text-base uppercase tracking-wider">
              {initialBet?.id ? 'Edit Personal Bet' : 'Log Personal Bet'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#8b97ac] hover:text-white hover:bg-[#182232] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-600/50 text-rose-200 text-xs font-mono">
              {error}
            </div>
          )}

          {/* Sport Switcher */}
          <div>
            <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1.5">
              Sport
            </label>
            <div className="grid grid-cols-4 gap-1.5 bg-[#0b0f14] p-1 rounded-xl border border-[#222d3e]">
              {(['nba', 'nhl', 'nfl', 'mlb'] as BetSport[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleSportChange(s)}
                  className={`py-1.5 rounded-lg text-xs font-mono font-bold uppercase transition ${
                    sport === s
                      ? s === 'nba' ? 'bg-orange-500 text-slate-950 shadow-sm'
                        : s === 'nhl' ? 'bg-cyan-400 text-slate-950 shadow-sm'
                        : s === 'nfl' ? 'bg-sky-500 text-slate-950 shadow-sm'
                        : 'bg-amber-400 text-amber-950 shadow-sm'
                      : 'text-[#8b97ac] hover:text-white'
                  }`}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Player & Matchup */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
                Player Name *
              </label>
              <input
                type="text"
                placeholder="e.g. LeBron James"
                value={player}
                onChange={e => setPlayer(e.target.value)}
                required
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono placeholder:text-[#556277] outline-none focus:border-cyan-400"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
                Date (YYYY-MM-DD)
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
                Team (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. LAL"
                value={team}
                onChange={e => setTeam(e.target.value.toUpperCase())}
                maxLength={4}
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono placeholder:text-[#556277] outline-none focus:border-cyan-400 uppercase"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
                Opponent (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. GSW"
                value={opp}
                onChange={e => setOpp(e.target.value.toUpperCase())}
                maxLength={4}
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono placeholder:text-[#556277] outline-none focus:border-cyan-400 uppercase"
              />
            </div>
          </div>

          {/* Market & Side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
                Market
              </label>
              <select
                value={market}
                onChange={e => setMarket(e.target.value)}
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono outline-none focus:border-cyan-400 cursor-pointer"
              >
                {SPORT_MARKETS[sport].map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
                Side (Over / Under)
              </label>
              <div className="grid grid-cols-2 gap-2 bg-[#0b0f14] p-1 rounded-xl border border-[#222d3e]">
                <button
                  type="button"
                  onClick={() => setSide('OVER')}
                  className={`py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                    side === 'OVER' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-[#8b97ac] hover:text-white'
                  }`}
                >
                  OVER
                </button>
                <button
                  type="button"
                  onClick={() => setSide('UNDER')}
                  className={`py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                    side === 'UNDER' ? 'bg-orange-500 text-slate-950 shadow-sm' : 'text-[#8b97ac] hover:text-white'
                  }`}
                >
                  UNDER
                </button>
              </div>
            </div>
          </div>

          {/* Line & Odds & Stake */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
                Line
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={line}
                onChange={e => setLine(e.target.value)}
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono font-bold outline-none focus:border-cyan-400 text-center"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
                American Odds
              </label>
              <input
                type="text"
                placeholder="-110"
                value={odds}
                onChange={e => setOdds(e.target.value)}
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono font-bold outline-none focus:border-cyan-400 text-center"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider">
                  Stake (units)
                </label>
                {displayCfg.mode === 'currency' && (
                  <span className="text-[10px] font-mono text-emerald-400 flex items-center">
                    <DollarSign className="w-2.5 h-2.5" />
                    {formatStake(parsedStakeNum)}
                  </span>
                )}
              </div>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={stake}
                onChange={e => setStake(e.target.value)}
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono font-bold outline-none focus:border-cyan-400 text-center"
              />
            </div>
          </div>

          {/* Result & Actual Outcome (if settled) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-[#222d3e]/70">
            <div>
              <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
                Status / Result
              </label>
              <select
                value={result}
                onChange={e => setResult(e.target.value as BetResult)}
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono outline-none focus:border-cyan-400 cursor-pointer"
              >
                <option value="PENDING">PENDING (Awaiting game)</option>
                <option value="HIT">HIT (Won)</option>
                <option value="MISS">MISS (Lost)</option>
                <option value="PUSH">PUSH (Tied)</option>
                <option value="VOID">VOID (DNP / Canceled)</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
                Actual Stat (Optional)
              </label>
              <input
                type="number"
                step="1"
                placeholder="Official result"
                value={actual}
                onChange={e => setActual(e.target.value)}
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block mb-1">
              Notes (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Boosted to +130 on FanDuel, player minutes trending up"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl px-3 py-2 text-sm text-white font-mono placeholder:text-[#556277] outline-none focus:border-cyan-400"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#222d3e]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-mono font-semibold text-[#8b97ac] hover:text-white hover:bg-[#182232] transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-mono font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center gap-1.5 shadow-md transition"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              {initialBet?.id ? 'Update Bet' : 'Save Bet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
