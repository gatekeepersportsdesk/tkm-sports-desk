import React, { useMemo, useState } from 'react';
import { simMlbCard, parseAmericanOdds, parlayEv, MLB_DEFAULT_TUNE } from '../../model/mlb_engine';
import { Calculator, AlertTriangle } from 'lucide-react';

interface Leg {
  id: number;
  name: string;
  team: string;
  calP: number;
  overPrice: string;
  gamePk: number;
  line?: number;
  call?: 'PLAY' | 'PASS';
  quality?: string;
}

interface MlbParlayPickerProps {
  legs: Leg[];
  onRemoveLeg: (id: number) => void;
  onClear: () => void;
  /** assumed book shading for same-game parlays (profit multiplier); 1 = none */
  sgpHaircut?: number;
}

const toAmerican = (dec: number): string =>
  dec >= 2 ? `+${Math.round((dec - 1) * 100)}` : `-${Math.round(100 / (dec - 1))}`;

export const MlbParlayPicker: React.FC<MlbParlayPickerProps> = ({
  legs,
  onRemoveLeg,
  onClear,
  sgpHaircut = MLB_DEFAULT_TUNE.sgpHaircut
}) => {
  const [quoted, setQuoted] = useState('');
  const [result, setResult] = useState<ReturnType<typeof simMlbCard> | null>(null);
  const [simulating, setSimulating] = useState(false);

  // any change to the ticket invalidates the previous simulation
  const ticketKey = legs.map(l => `${l.id}:${l.calP}:${l.overPrice}`).join('|');
  React.useEffect(() => { setResult(null); }, [ticketKey]);

  const legDecs = legs.map(l => parseAmericanOdds(l.overPrice)?.dec ?? null);
  const missingPrice = legDecs.some(d => d === null);
  const straightDec = legDecs.every(d => d !== null) ? (legDecs as number[]).reduce((a, d) => a * d, 1) : null;
  const quotedDec = quoted.trim() ? parseAmericanOdds(quoted)?.dec ?? null : null;

  const warnings = useMemo(() => {
    const w: string[] = [];
    legs.forEach(l => {
      if (l.call && l.call !== 'PLAY') w.push(`${l.name}: not a PLAY on the board${l.quality === 'EST' ? ' (estimated inputs)' : ''}`);
    });
    if (legs.length >= 2 && legs.every(l => l.call === 'PLAY') === false) w.push('A parlay of non-PLAY legs multiplies their vig; singles are usually better.');
    return w;
  }, [legs]);

  const handleRunSim = () => {
    if (legs.length < 2) return;
    setSimulating(true);
    setTimeout(() => {
      setResult(simMlbCard(legs.map(l => ({ name: l.name, team: l.team, p: l.calP, game: l.gamePk })), 20000));
      setSimulating(false);
    }, 30);
  };

  const sameGame = result?.same ?? false;
  const priceUsed = quotedDec ?? straightDec;
  const shading = quotedDec ? 1 : sameGame ? sgpHaircut : 1;
  const ev = result && priceUsed ? parlayEv(result.sim, priceUsed, shading) : null;
  const fairDec = result && result.sim > 0 ? 1 / result.sim : null;

  return (
    <div className="space-y-4">
      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e]">
        <div className="flex items-center justify-between border-b border-[#222d3e] pb-3 mb-4">
          <div>
            <h2 className="text-lg font-bold font-display uppercase tracking-wide text-white">
              Parlay Simulator (Gaussian Copula)
            </h2>
            <p className="text-xs text-[#8b97ac]">
              Team factor 0.07 &amp; same-game factor 0.03 &middot; 20,000 seeded draws &middot; leg probabilities are the desk's blended P
            </p>
          </div>
          <button onClick={onClear} className="text-xs text-[#8b97ac] hover:text-white underline font-mono">
            Clear Selection
          </button>
        </div>

        {legs.length === 0 ? (
          <div className="p-8 text-center text-[#556277] text-xs font-mono">
            No legs selected. Click "+ Add to Parlay" on any hitter card on the board.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              {legs.map(leg => (
                <div key={leg.id} className="flex items-center justify-between p-2.5 rounded-xl bg-[#182232] border border-[#222d3e] text-xs font-mono">
                  <div>
                    <span className="font-bold text-white mr-2">{leg.name}</span>
                    <span className="text-[#8b97ac]">
                      ({leg.team} &middot; Over {leg.line ?? 0.5} Hits &middot; {(leg.calP * 100).toFixed(1)}% &middot; {leg.overPrice || 'no price'})
                    </span>
                    {leg.call === 'PLAY' && <span className="ml-2 text-emerald-400 font-bold">PLAY</span>}
                  </div>
                  <button onClick={() => onRemoveLeg(leg.id)} className="text-rose-400 hover:text-rose-300 font-bold px-2 py-0.5">
                    &times;
                  </button>
                </div>
              ))}
            </div>

            {warnings.length > 0 && (
              <div className="flex gap-2 text-[11px] font-mono text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-xl px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <div>{warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3 pt-2">
              <label className="text-[10px] text-[#8b97ac] font-mono flex flex-col">
                Book's quoted parlay price (optional)
                <input
                  type="text"
                  value={quoted}
                  onChange={e => setQuoted(e.target.value)}
                  placeholder="e.g. +260"
                  className="w-32 bg-[#0b0f14] border border-[#222d3e] rounded px-2 py-1.5 text-xs text-white mt-0.5 outline-none focus:border-amber-400"
                />
              </label>
              <button
                onClick={handleRunSim}
                disabled={legs.length < 2 || simulating}
                className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-amber-950 font-bold font-display uppercase tracking-wider text-xs rounded-xl transition disabled:opacity-50 flex items-center gap-1.5"
              >
                <Calculator className="w-4 h-4" />
                {simulating ? 'Simulating…' : 'Run Simulation'}
              </button>
              <span className="text-xs font-mono text-[#8b97ac]">{legs.length} leg{legs.length !== 1 ? 's' : ''} (max 4)</span>
            </div>
            {missingPrice && <p className="text-[11px] font-mono text-amber-300">Some legs have no odds — enter them on the board or quote the parlay price.</p>}

            {result && (
              <div className="mt-4 p-4 rounded-xl bg-[#0f1520] border border-[#222d3e] space-y-2 text-xs font-mono">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <Stat label="Simulated win" value={`${(result.sim * 100).toFixed(1)}%`} sub={`± ${(result.se * 196).toFixed(1)} pts (95%)`} tone="amber" />
                  <Stat label="Independent win" value={`${(result.indep * 100).toFixed(1)}%`} />
                  <Stat label="Correlation lift" value={`${result.lift >= 0 ? '+' : ''}${(result.lift * 100).toFixed(1)} pts`} tone={result.lift >= 0 ? 'good' : 'bad'} />
                  <Stat label="Fair price (sim)" value={fairDec ? toAmerican(fairDec) : '—'} />
                  <Stat
                    label={quotedDec ? 'EV @ quoted' : sameGame ? 'EV @ shaded product' : 'EV @ product'}
                    value={ev === null ? '—' : `${ev >= 0 ? '+' : ''}${(ev * 100).toFixed(1)}%`}
                    sub={priceUsed ? `price ${toAmerican(1 + (priceUsed - 1) * shading)}` : 'no price'}
                    tone={ev === null ? undefined : ev > 0 ? 'good' : 'bad'}
                  />
                </div>
                <p className="text-[11px] text-[#8b97ac] pt-1">
                  {sameGame
                    ? quotedDec
                      ? 'Same-game ticket priced at the book\'s own quote (books already shade correlated legs).'
                      : `Same-game ticket: no quote entered, so the straight product is shaded by an ASSUMED ${((1 - sgpHaircut) * 100).toFixed(0)}% of profit. Enter the book's real quote for a true EV.`
                    : 'Cross-game ticket: legs priced independently apart from the shared team factor.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: 'amber' | 'good' | 'bad' }> = ({ label, value, sub, tone }) => (
  <div>
    <span className="text-[#8b97ac] text-[11px] block">{label}</span>
    <p className={`text-lg font-bold ${tone === 'amber' ? 'text-amber-400' : tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-white'}`}>{value}</p>
    {sub && <span className="text-[10px] text-[#556277]">{sub}</span>}
  </div>
);
