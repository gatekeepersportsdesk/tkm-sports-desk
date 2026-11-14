import React, { useMemo, useState } from 'react';
import { NbaMarket, NbaPlayerProjection, NBA_MARKETS, NBA_MARKET_UNIT } from '../../types/nba';
import { priceNbaJoint, NbaJointLeg, measuredRho } from '../../model/nba_joint';
import { fairAmerican } from '../../model/sampler';

interface LegState { playerId: number; market: NbaMarket; side: 'over' | 'under'; line: number }
interface Props { projection: NbaPlayerProjection; market: NbaMarket; line: number; gamePlayers: NbaPlayerProjection[] }

const sel = 'bg-[#0b0f14] border border-[#222d3e] rounded px-1.5 py-1 text-xs font-mono text-white outline-none';
const fmt = (x: number | null) => (x === null ? '—' : x > 0 ? '+' + x : String(x));

/**
 * Up to 3 legs from the same game. Same-player legs use correlations MEASURED on real box scores; teammates and opponents
 * measured within noise of zero, so those legs price close to the product. Display only: never a bet signal.
 */
export const NbaJointPanel: React.FC<Props> = ({ projection, market, line, gamePlayers }) => {
  const [legs, setLegs] = useState<LegState[]>([
    { playerId: projection.playerId, market, side: 'over', line },
    { playerId: projection.playerId, market: market === 'pts' ? 'reb' : 'pts', side: 'over', line: (market === 'pts' ? projection.markets.reb : projection.markets.pts).defaultLine }
  ]);
  const byId = useMemo(() => new Map(gamePlayers.map(p => [p.playerId, p])), [gamePlayers]);
  const upd = (i: number, patch: Partial<LegState>) => setLegs(prev => prev.map((l, j) => {
    if (j !== i) return l;
    const n = { ...l, ...patch };
    if (patch.playerId !== undefined || patch.market !== undefined) {
      const pp = byId.get(n.playerId); if (pp) n.line = pp.markets[n.market].defaultLine;
    }
    return n;
  }));
  const resolved: NbaJointLeg[] = legs.flatMap(l => {
    const pp = byId.get(l.playerId); if (!pp) return [];
    const mp = pp.markets[l.market];
    return [{ playerId: l.playerId, team: pp.team, gameId: pp.gameId ?? '', market: l.market, mu: mp.mu, r: mp.r, line: l.line, side: l.side }];
  });
  const key = resolved.map(l => `${l.playerId}|${l.market}|${l.line}|${l.side}`).join(';');
  const res = useMemo(() => (resolved.length ? priceNbaJoint(resolved) : null), [key]);
  const cautions = legs.map(l => byId.get(l.playerId)).filter((p): p is NbaPlayerProjection => !!p && (p.inputsSource !== 'REAL' || p.availability !== 'ACTIVE'))
    .map(p => `${p.name}: ${p.inputsSource !== 'REAL' ? 'estimated inputs' : 'availability ' + p.availability.toLowerCase()}`);
  const sorted = useMemo(() => [...gamePlayers].sort((a, b) => (a.team === b.team ? b.pm - a.pm : a.team < b.team ? -1 : 1)), [gamePlayers]);
  const pairs = resolved.flatMap((a, i) => resolved.slice(i + 1).map((b, j) => ({ a, b, rho: res?.corr?.[i]?.[i + 1 + j] ?? 0 }))).filter(x => Math.abs(x.rho) > 0);
  return (
    <div className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] space-y-2">
      <div className="text-white font-bold">Joint price (Monte Carlo copula, measured correlations)</div>
      {legs.map((l, i) => {
        const pp = byId.get(l.playerId);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className={sel} value={l.playerId} onChange={e => upd(i, { playerId: parseInt(e.target.value) })}>
              {sorted.map(p => <option key={p.playerId} value={p.playerId}>{p.name} ({p.team})</option>)}
            </select>
            <select className={sel} value={l.market} onChange={e => upd(i, { market: e.target.value as NbaMarket })}>
              {NBA_MARKETS.map(m => <option key={m} value={m}>{NBA_MARKET_UNIT[m]}</option>)}
            </select>
            <select className={sel} value={l.side} onChange={e => upd(i, { side: e.target.value as 'over' | 'under' })}><option value="over">Over</option><option value="under">Under</option></select>
            <select className={sel} value={l.line} onChange={e => upd(i, { line: parseFloat(e.target.value) })}>
              {(pp ? pp.markets[l.market].lines : [l.line]).map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            {legs.length > 1 && <button className="text-[#8b97ac] hover:text-white px-1" onClick={() => setLegs(prev => prev.filter((_, j) => j !== i))}>×</button>}
          </div>
        );
      })}
      {legs.length < 3 && (
        <button className={sel} onClick={() => setLegs(prev => [...prev, { playerId: projection.playerId, market: 'reb', side: 'over', line: projection.markets.reb.defaultLine }])}>+ add leg</button>
      )}
      {res?.conflict && <div className="text-[11px] text-amber-300">{res.conflict}</div>}
      {res && !res.conflict && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <div className="flex justify-between py-1 border-b border-[#222d3e]/50"><span className="text-[#8b97ac]">Joint P (correlated)</span><span className="text-cyan-400 font-bold">{(res.p * 100).toFixed(1)}% ± {(res.se * 196).toFixed(1)} · fair {fmt(fairAmerican(res.p))}</span></div>
          <div className="flex justify-between py-1 border-b border-[#222d3e]/50"><span className="text-[#8b97ac]">If independent</span><span className="text-white font-medium">{(res.pIndep * 100).toFixed(1)}% · fair {fmt(fairAmerican(res.pIndep))}</span></div>
          <div className="sm:col-span-2 text-[10px] text-[#556277] py-1">
            {pairs.length ? 'Correlation used: ' + pairs.map(x => `${NBA_MARKET_UNIT[x.a.market]}–${NBA_MARKET_UNIT[x.b.market]} ${x.rho.toFixed(2)}${x.a.playerId === x.b.playerId ? '' : x.a.team === x.b.team ? ' (teammates)' : ' (opponents)'}`).join(' · ') : 'No measurable dependence between these legs: the joint is the product of the single prices.'}
          </div>
        </div>
      )}
      {cautions.length > 0 && <div className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800 rounded px-2 py-1">⚠ {cautions.join(' · ')}. Treat this fair price as indicative only; it is not a bet signal.</div>}
      <div className="text-[10px] text-[#556277]">
        Marginals are the same Negative Binomial prices as the rows. Correlations were measured on 2023-26 box scores (same player: points-threes {measuredRho('samePlayer', 'pts', 'tpm').toFixed(2)}, points-rebounds {measuredRho('samePlayer', 'pts', 'reb').toFixed(2)}, points-assists {measuredRho('samePlayer', 'pts', 'ast').toFixed(2)}, rebounds-assists {measuredRho('samePlayer', 'reb', 'ast').toFixed(2)}); teammates and opponents were within sampling noise of zero, so they are priced as independent. Checked against real outcomes in scripts/nba/fit_nba.py. A book's same-game parlay price carries its own margin, so compare it with the fair price here.
      </div>
    </div>
  );
};
