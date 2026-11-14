import React, { useMemo, useState } from 'react';
import { CardRow } from '../../lib/card_core';
import { BettableConfig } from '../../lib/bettable';
import {
  ParlayLeg, ParlayMode, ParlayRules, ParlayTicket, PaperTicket, PSport, DEFAULT_RULES, MODES, legFromCard, legIssue, priceTicket,
  suggestTickets, summarizePaper, ticketConflict, buildPool
} from '../../lib/parlay_core';

interface Props {
  sport: PSport;
  sportLabel: string;
  today: string;
  /** every daily-card row of this sport (open ones become candidate legs) */
  cardRows: CardRow[];
  /** priced singles that already qualified (STAB / FADE, EV > 0, two-way price); empty for sports without them */
  pricedLegs: ParlayLeg[];
  markets: { id: string; label: string }[];
  paper: PaperTicket[];
  paperStatus: string;
  onExport: () => void;
  bettable: BettableConfig;
}

const MODE_HELP: Record<ParlayMode, string> = {
  edge: 'Only singles that already qualified on a real two-way price (EV > 0). Needs prices entered on the desk.',
  safe: 'REAL inputs, known availability, win probability at or above the threshold, no one-sided or heavy-juice prices.',
  sgp: 'Every leg from one game; the dependence engine for the sport prices the correlation.',
  cross: 'Every leg from a different game; the price is the plain product.'
};
const PRESETS: { label: string; sport?: PSport; mode: ParlayMode; L: number; markets?: string[] }[] = [
  { label: 'NBA same-player points + threes', sport: 'nba', mode: 'sgp', L: 2, markets: ['pts', 'tpm'] },
  { label: 'NBA same-player points + rebounds', sport: 'nba', mode: 'sgp', L: 2, markets: ['pts', 'reb'] },
  { label: 'NHL same-skater shots + points', sport: 'nhl', mode: 'sgp', L: 2 },
  { label: '3-leg edge, cross-game', mode: 'edge', L: 3 },
  { label: '2-leg safe (58%+, juice ≤ 115)', mode: 'safe', L: 2 }
];
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const am = (x: number | null) => (x === null ? '—' : x > 0 ? `+${x}` : `${x}`);
const signed = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

const TicketCard: React.FC<{ t: ParlayTicket; action?: React.ReactNode }> = ({ t, action }) => (
  <div className="bg-[#0f1520] rounded-xl border border-[#222d3e] p-3 space-y-1">
    <div className="flex items-start justify-between gap-2">
      <div className="space-y-0.5">
        {t.legs.map(l => <div key={l.id} className="text-xs font-mono text-white">{l.playerName} <span className="text-[#556277]">{l.team}v{l.opp}</span> · {l.market.toUpperCase()} {l.side} {l.line}<span className="text-[#8b97ac]"> · {pct(l.pLean, 0)}</span>{l.tag === 'EDGE' && <span className="ml-1 text-[9px] text-emerald-300 border border-emerald-700 rounded px-1">EDGE</span>}</div>)}
      </div>
      {action}
    </div>
    <div className="text-[11px] font-mono text-[#8b97ac]">
      joint <span className="text-cyan-400 font-bold">{pct(t.jointP)}</span>{t.se > 0 ? <span className="text-[#556277]"> ±{(t.se * 100).toFixed(1)}</span> : null} · product {pct(t.indepP)}{t.correlated ? <span> · dependence {signed(t.jointP - t.indepP)}</span> : null} · fair {am(t.fairAmerican)}
    </div>
  </div>
);

export const ParlayLab: React.FC<Props> = ({ sport, sportLabel, today, cardRows, pricedLegs, markets, paper, paperStatus, onExport, bettable }) => {
  const [mode, setMode] = useState<ParlayMode>('safe');
  const [L, setL] = useState(2);
  const [rulesLocal, setRules] = useState<ParlayRules>(DEFAULT_RULES);
  const rules = useMemo(() => ({ ...rulesLocal, bet: bettable }), [rulesLocal, bettable]);
  const [chosen, setChosen] = useState<ParlayLeg[]>([]);
  const [book, setBook] = useState('');
  const [sort, setSort] = useState<'p' | 'name'>('p');
  const [showHidden, setShowHidden] = useState(false);

  const pool = useMemo(() => {
    const card = cardRows.filter(r => r.result === null && r.date === today).map(r => legFromCard(r, sport));
    const combined = buildPool(card, pricedLegs);
    // Hard filter: candidate legs must have posted odds + line by default.
    // No-odds / estimated-only legs cannot enter tickets unless explicitly shown.
    if (showHidden) return combined;
    return combined.filter(l => (l.overOdds != null || l.underOdds != null) && l.inputs === 'REAL');
  }, [cardRows, pricedLegs, sport, today, showHidden]);
  const suggestions = useMemo(() => suggestTickets(pool, mode, L, rules, { top: 5 }), [pool, mode, L, rules]);
  const candidates = useMemo(() => pool.map(l => ({ l, why: legIssue(l, mode, rules) })).sort((a, b) => sort === 'p' ? b.l.pLean - a.l.pLean : a.l.playerName.localeCompare(b.l.playerName)), [pool, mode, rules, sort]);
  const bookN = book.trim() === '' ? null : Number(book.replace('−', '-'));
  const bookOk = bookN !== null && Number.isFinite(bookN) && Math.abs(bookN) >= 100;
  const active = useMemo(() => (chosen.length >= 2 ? priceTicket(chosen, mode, { bookAmerican: bookOk ? bookN : null }) : null), [chosen, mode, bookN, bookOk]);
  const stats = useMemo(() => summarizePaper(paper).filter(s => s.sport === sport), [paper, sport]);
  const mine = useMemo(() => paper.filter(t => t.sport === sport).sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1)), [paper, sport]);
  const chip = (on: boolean) => `px-2.5 py-1 rounded-full text-[11px] font-mono cursor-pointer ${on ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#0f1520] text-[#8b97ac] border border-[#222d3e] hover:text-white'}`;
  const toggle = (l: ParlayLeg) => setChosen(c => (c.some(x => x.id === l.id) ? c.filter(x => x.id !== l.id) : c.length >= 6 ? c : [...c, l]));
  const addIssue = (l: ParlayLeg) => { const next = [...chosen, l]; return chosen.some(x => x.id === l.id) ? null : ticketConflict(next, mode); };
  const copy = () => { if (active) void navigator.clipboard?.writeText(`${sportLabel} ${mode} parlay (${active.legs.length} legs)\n` + active.legs.map(l => `${l.playerName} ${l.market.toUpperCase()} ${l.side} ${l.line} (${pct(l.pLean, 0)})`).join('\n') + `\nModel joint ${pct(active.jointP)} · product ${pct(active.indepP)} · fair ${am(active.fairAmerican)}${active.ev !== null && active.ev !== undefined ? ` · EV ${signed(active.ev)} at ${am(active.bookAmerican ?? null)}` : ''}`); };

  return (
    <div className="space-y-4">
      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold uppercase tracking-wide text-white">{sportLabel} Ticket Builder</h2>
            <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-600/70 text-[10px] font-mono font-semibold">
              SANDBOX PLAYGROUND
            </span>
          </div>
          <div className="mt-1 text-xs font-semibold text-amber-300/90 font-mono flex items-center gap-1.5">
            <span>⚠️ Playground only — does not affect Today&apos;s Plays or graded performance.</span>
          </div>
          <p className="text-xs text-[#8b97ac] mt-1">
            Manual sandbox for experimenting with custom 2–6 leg tickets and correlation calculations. Building or evaluating combinations here does not write to the official daily card or alter picker win rates. Official daily recommendations live on the Desk in Today&apos;s Plays.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {MODES.map(m => <button key={m} onClick={() => { setMode(m); setChosen([]); }} className={chip(mode === m)}>{m === 'sgp' ? 'Same game' : m === 'cross' ? 'Cross game' : m === 'edge' ? 'Edge' : 'Safe'}</button>)}
          <span className="text-[#556277]">|</span>
          {[2, 3, 4, 5, 6].map(n => <button key={n} onClick={() => setL(n)} className={chip(L === n)}>{n} legs</button>)}
        </div>
        <p className="text-[11px] text-[#556277]">{MODE_HELP[mode]}</p>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-[#8b97ac]">
          {mode === 'safe' && <>
            <label className="flex items-center gap-1">min win prob <input type="number" step="0.01" min="0.5" max="0.95" value={rules.minP} onChange={e => setRules(r => ({ ...r, minP: Math.min(0.95, Math.max(0.5, Number(e.target.value) || 0.58)) }))} className="w-16 bg-[#0f1520] border border-[#222d3e] rounded px-1 py-0.5 text-white" /></label>
            <label className="flex items-center gap-1">max juice <input type="number" step="5" min="100" max="200" value={rules.maxJuice} onChange={e => setRules(r => ({ ...r, maxJuice: Math.max(100, Number(e.target.value) || 115) }))} className="w-16 bg-[#0f1520] border border-[#222d3e] rounded px-1 py-0.5 text-white" /></label>
          </>}
          {markets.length > 1 && <span className="flex items-center gap-1.5 flex-wrap">markets:
            <button onClick={() => setRules(r => ({ ...r, markets: null }))} className={chip(rules.markets === null)}>all</button>
            {markets.map(m => <button key={m.id} onClick={() => setRules(r => { const cur = r.markets ?? []; const next = cur.includes(m.id) ? cur.filter(x => x !== m.id) : [...cur, m.id]; return { ...r, markets: next.length ? next : null }; })} className={chip(!!rules.markets?.includes(m.id))}>{m.label}</button>)}
          </span>}
          <button onClick={() => setChosen([])} className="px-2 py-0.5 rounded border border-[#222d3e] hover:text-white cursor-pointer">Clear ticket</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-[#8b97ac]">presets:
          {PRESETS.filter(p => !p.sport || p.sport === sport).map(p => <button key={p.label} onClick={() => { setMode(p.mode); setL(p.L); setRules(r => ({ ...r, markets: p.markets ?? null })); setChosen([]); }} className={chip(false)}>{p.label}</button>)}
        </div>
      </div>

      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-white">Suggested {L}-leg {mode === 'sgp' ? 'same-game' : mode === 'cross' ? 'cross-game' : mode} tickets</h3>
        {suggestions.length === 0 ? (
          <p className="text-xs text-[#556277]">No {L}-leg ticket qualifies yet among priced legs ({pool.length} priced legs with odds). Import odds on the desk to populate qualified legs.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {suggestions.map((t, i) => <TicketCard key={t.id} t={t} action={<button onClick={() => setChosen(t.legs)} className="px-2 py-1 rounded border border-[#222d3e] text-[11px] font-mono text-cyan-300 hover:text-white cursor-pointer whitespace-nowrap">#{i + 1} · load</button>} />)}
          </div>
        )}
        <p className="text-[10px] text-[#556277]">Ranked by modelled win probability, not by payout. Suggestions are informational for manual tickets; primary picks live on the Desk in Today&apos;s Plays.</p>
      </div>

      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-white">Your Custom Ticket</h3>
        {!active ? <p className="text-xs text-[#556277]">Tick two to six legs below, load a suggestion, or click &ldquo;+ Ticket&rdquo; on Today&apos;s Plays.</p> : (
          <>
            <TicketCard t={active} />
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-[#8b97ac]">
              <label className="flex items-center gap-1">book parlay price (American) <input value={book} onChange={e => setBook(e.target.value)} placeholder="+450" className="w-20 bg-[#0f1520] border border-[#222d3e] rounded px-1 py-0.5 text-white" /></label>
              {active.ev !== null && active.ev !== undefined ? <span className={active.ev > 0 ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'}>EV {signed(active.ev)} per 1u at {am(active.bookAmerican ?? null)}</span> : <span>no price typed: fair price only</span>}
              <button onClick={copy} className="px-2 py-0.5 rounded border border-[#222d3e] hover:text-white cursor-pointer">Copy</button>
            </div>
            <ul className="text-[11px] text-amber-300/90 list-disc pl-5 space-y-0.5">{active.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </>
        )}
      </div>

      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-white">Eligible Candidate Legs ({pool.length})</h3>
          <div className="flex items-center gap-2 text-[11px] font-mono text-[#8b97ac]">
            <button onClick={() => setSort(sort === 'p' ? 'name' : 'p')} className="px-2 py-0.5 rounded border border-[#222d3e] hover:text-white cursor-pointer">sort: {sort === 'p' ? 'win prob' : 'name'}</button>
            <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} className="accent-cyan-400" />show unpriced / hypothetical legs</label>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead><tr className="border-b border-[#222d3e] text-[#8b97ac] uppercase text-[11px]"><th className="py-1.5 px-2"></th><th className="py-1.5 px-2">Player</th><th className="py-1.5 px-2">Leg</th><th className="py-1.5 px-2 text-right">μ</th><th className="py-1.5 px-2 text-right">Win prob</th><th className="py-1.5 px-2">Status</th></tr></thead>
            <tbody>
              {candidates.filter(c => showHidden || c.why === null).slice(0, 150).map(({ l, why }) => {
                const on = chosen.some(x => x.id === l.id);
                const block = why ?? (on ? null : addIssue(l));
                return (
                  <tr key={l.id} className={`border-b border-[#222d3e]/50 ${block && !on ? 'text-[#556277]' : 'text-white'}`}>
                    <td className="py-1 px-2"><input type="checkbox" checked={on} disabled={(!!block && !on) || (!on && chosen.length >= 6)} onChange={() => toggle(l)} className="accent-cyan-400" /></td>
                    <td className="py-1 px-2 font-bold">{l.playerName}<span className="text-[#556277] font-normal"> {l.team}v{l.opp}</span></td>
                    <td className="py-1 px-2">{l.market.toUpperCase()} {l.side} {l.line}{l.overOdds != null || l.underOdds != null ? <span className="text-[#8b97ac]"> ({l.overOdds ?? '—'}/{l.underOdds ?? '—'})</span> : null}{l.tag === 'EDGE' && <span className="ml-1 text-[9px] text-emerald-300 border border-emerald-700 rounded px-1">EDGE</span>}</td>
                    <td className="py-1 px-2 text-right">{l.mu.toFixed(2)}</td>
                    <td className="py-1 px-2 text-right text-cyan-400">{pct(l.pLean)}</td>
                    <td className="py-1 px-2 text-[#8b97ac]">{block ?? (l.src === 'ledger' ? 'priced, qualified' : 'model-only')}</td>
                  </tr>
                );
              })}
              {candidates.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-[#556277]">No open legs. The card fills itself when the {sportLabel} slate loads before the games start.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[#121824] p-5 rounded-2xl border border-[#222d3e] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-white">Paper tickets — how the model's parlays actually fare</h3>
            <p className="text-xs text-[#8b97ac]">Every day the desk builds a fixed menu of tickets from pre-game information only (nothing is hand-picked, nothing is bet), then grades them from the daily card once the games are final. A ticket loses if any leg loses; a ticket with a void or pushed leg is excluded.</p>
            {paperStatus && <div className="mt-1 text-[11px] font-mono text-cyan-300">{paperStatus}</div>}
          </div>
          <button onClick={onExport} className="px-2 py-1 rounded border border-[#222d3e] text-[11px] font-mono text-[#8b97ac] hover:text-white cursor-pointer whitespace-nowrap">Export tickets JSON</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead><tr className="border-b border-[#222d3e] text-[#8b97ac] uppercase text-[11px]"><th className="py-1.5 px-2">Menu</th><th className="py-1.5 px-2 text-right">Decided</th><th className="py-1.5 px-2 text-right">Predicted</th><th className="py-1.5 px-2 text-right">Happened</th><th className="py-1.5 px-2 text-right">Brier (joint / product)</th><th className="py-1.5 px-2">Read</th></tr></thead>
            <tbody>
              {stats.length === 0 ? <tr><td colSpan={6} className="py-4 text-center text-[#556277]">Nothing graded yet. Tickets are created automatically when the slate loads; come back after the games are final.</td></tr> : stats.map(s => (
                <tr key={s.key} className="border-b border-[#222d3e]/50 text-white">
                  <td className="py-1.5 px-2 font-bold">{s.mode === 'sgp' ? 'same-game' : s.mode} · {s.L} legs</td>
                  <td className="py-1.5 px-2 text-right">{s.n}</td>
                  <td className="py-1.5 px-2 text-right">{pct(s.predicted!)}</td>
                  <td className="py-1.5 px-2 text-right text-cyan-400">{pct(s.realized!)} <span className="text-[#556277]">±{(s.noise! * 100).toFixed(1)}</span></td>
                  <td className="py-1.5 px-2 text-right">{s.brier!.toFixed(3)} / {s.brierIndep!.toFixed(3)}</td>
                  <td className="py-1.5 px-2 text-[#8b97ac]">{s.n < 30 ? <span className="text-amber-400">n={s.n}: too few</span> : Math.abs(s.realized! - s.predicted!) <= 2 * s.noise! ? 'in line with the model' : s.realized! < s.predicted! ? 'under-delivering' : 'over-delivering'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-[#556277]">"Predicted" is the average modelled joint probability at capture time, "Happened" the share that won. Tickets are built from each day's highest-probability legs, so a persistent gap (happened below predicted) can come from picking the model's most optimistic numbers, not only from bad dependence: that is exactly what this measures. Brier: lower is better; on correlated tickets (same-game) the joint should beat the plain product. Tickets of the same day share games, so the noise is larger than shown; judge it over weeks, not days.</p>
        <details>
          <summary className="text-[11px] font-mono text-[#8b97ac] cursor-pointer">Recent paper tickets ({mine.length})</summary>
          <div className="mt-2 space-y-1.5 max-h-[320px] overflow-y-auto">
            {mine.slice(0, 60).map(t => (
              <div key={t.id} className="text-[11px] font-mono flex items-start gap-2 border-b border-[#222d3e]/40 pb-1">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${t.result === null ? 'bg-slate-800 text-slate-400 border-slate-700' : t.result === 'HIT' ? 'bg-emerald-950 text-emerald-300 border-emerald-600' : t.result === 'MISS' ? 'bg-rose-950 text-rose-300 border-rose-700' : 'bg-slate-800 text-slate-300 border-slate-600'}`}>{t.result ?? 'PENDING'}</span>
                <span className="text-[#8b97ac]">{t.date} · {t.mode === 'sgp' ? 'same-game' : t.mode} {t.L}</span>
                <span className="text-white">{t.legs.map(l => `${l.name} ${l.market.toUpperCase()} ${l.side[0]}${l.line}`).join(' + ')}</span>
                <span className="ml-auto text-cyan-400 whitespace-nowrap">{pct(t.jointP)}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
};
