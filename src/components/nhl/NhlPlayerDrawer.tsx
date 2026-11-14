import React, { useMemo, useState } from 'react';
import { NhlSkaterProjection, NhlMarket } from '../../types/nhl';
import { NhlRowEval, marketOf } from '../../lib/nhl_board';
import { NHL_CONFIG } from '../../model/nhl_engine';
import { jointPair, fairAmerican } from '../../model/sampler';
import { simulateNhlTeam } from '../../model/gamesim';
import { SimJointBuilder, SimLegOption } from '../common/SimJointBuilder';
import { MarketVarianceInfo, getNhlMarketVariance } from '../../lib/market_variance';
import { MarketVarianceDrawerPanel } from '../common/MarketVarianceDrawerPanel';

interface Props {
  projection: NhlSkaterProjection;
  market: NhlMarket;
  line: number;
  evalRow: NhlRowEval;
  /** every priced skater on this player's team in this game (including this one); enables the game simulator */
  teammates?: NhlSkaterProjection[];
  variance?: MarketVarianceInfo;
}

const Row = ({ k, v, strong }: { k: React.ReactNode; v: React.ReactNode; strong?: boolean }) => (
  <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
    <span className="text-[#8b97ac]">{k}</span>
    <span className={strong ? 'text-cyan-400 font-bold' : 'text-white font-medium'}>{v}</span>
  </div>
);

/**
 * Game simulator: team shot volume -> Dirichlet shares -> goals and assists. Teammate dependence and the
 * shots<->points link EMERGE from that structure (validated on real 2025-26 games in scripts/validate_gamesim.ts).
 * Needs at least 9 priced skaters on the team; otherwise the copula fallback below is used.
 */
const SimPanel: React.FC<{ projection: NhlSkaterProjection; teammates: NhlSkaterProjection[]; fallback: React.ReactNode }> = ({ projection, teammates, fallback }) => {
  const sims = NHL_CONFIG.sims;
  const usable = useMemo(() => teammates.filter(t => t.availability !== 'OUT' && t.availability !== 'IR' && t.availability !== 'SCRATCHED' && t.availability !== 'INACTIVE'), [teammates]);
  const sim = useMemo(() => {
    if (usable.length < 9 || !usable.some(t => t.playerId === projection.playerId)) return null;
    return simulateNhlTeam({
      players: usable.map(t => ({ id: String(t.playerId), pos: t.pos, muShots: t.sog.mu, muPoints: t.pts ? t.pts.mu : null })),
      sims, seed: `${projection.team}|${projection.gameId ?? ''}|${usable.map(t => t.playerId + ':' + t.sog.mu.toFixed(3)).join(',')}`
    });
  }, [usable, sims, projection.playerId, projection.team, projection.gameId]);
  if (!sim) return <>{fallback}</>;
  const options: SimLegOption[] = [];
  usable.forEach(t => {
    const d = sim.draws[String(t.playerId)];
    if (!d || !d.sog) return;
    const caution = t.inputsSource !== 'REAL' ? 'estimated inputs' : t.availability !== 'ACTIVE' ? `availability ${String(t.availability).toLowerCase()}` : undefined;
    options.push({ id: `${t.playerId}:sog`, label: `${t.name} SOG`, draws: d.sog, defaultLine: t.sog.defaultLine, teamKey: t.team, caution });
    if (d.pts && t.pts) options.push({ id: `${t.playerId}:pts`, label: `${t.name} PTS`, draws: d.pts, defaultLine: t.pts.lines[0], teamKey: t.team, caution });
  });
  const me = String(projection.playerId);
  const initial = [{ optionId: `${me}:sog`, side: 'over' as const, line: projection.sog.defaultLine }, ...(projection.pts ? [{ optionId: `${me}:pts`, side: 'over' as const, line: projection.pts.lines[0] }] : [])];
  return (
    <SimJointBuilder
      title={`Game simulation joint (${sims.toLocaleString()} simulated games)`}
      options={options}
      initial={initial}
      note={`Team shot volume → Dirichlet shares → shots, then points tied to the same skater's shots and a shared team scoring factor. Parameters are solved to match the priced μ and NB variance and the MEASURED teammate correlations (shots +0.018, points +0.096). Checked on 1,500 real 2025-26 team-games: actual team point totals landed inside the simulator's 80% band 79% of the time (independence: 56%); same-skater SOG≥3 + PTS≥1 simulated 14.0% vs actual 13.6% (independence 11.0%); teammate shots stay near-independent, so a shots stack prices close to the product. Absent players' shots are not redistributed to teammates. Each leg alone still uses the closed-form price.`}
    />
  );
};

/** Same-skater shots + points combo priced through the copula (marginals stay the validated NB). Fallback when the team is not fully loaded. */
const JointPanel: React.FC<{ projection: NhlSkaterProjection }> = ({ projection }) => {
  const sog = projection.sog;
  const pts = projection.pts;
  const [sogLine, setSogLine] = useState(sog.defaultLine);
  const [ptsLine, setPtsLine] = useState(pts ? pts.lines[0] : 0.5);
  const [sogSide, setSogSide] = useState<'over' | 'under'>('over');
  const [ptsSide, setPtsSide] = useState<'over' | 'under'>('over');
  const rho = NHL_CONFIG.rhoShotsPoints;
  const sims = NHL_CONFIG.sims;
  const res = useMemo(() => {
    if (!pts) return null;
    return jointPair(
      { marginal: { mu: sog.mu, r: sog.r }, line: sogLine, side: sogSide },
      { marginal: { mu: pts.mu, r: pts.r }, line: ptsLine, side: ptsSide },
      rho,
      { sims }
    );
  }, [sog.mu, sog.r, pts?.mu, pts?.r, sogLine, ptsLine, sogSide, ptsSide, rho, sims]);
  if (!pts || !res) return null;
  const sel = 'bg-[#0b0f14] border border-[#222d3e] rounded px-1.5 py-1 text-xs font-mono text-white outline-none';
  const fa = fairAmerican(res.p);
  const fi = fairAmerican(res.pIndep);
  return (
    <div className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] space-y-2">
      <div className="text-white font-bold">Shots + points combo (Monte Carlo, {res.sims.toLocaleString()} draws)</div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={sel} value={sogSide} onChange={e => setSogSide(e.target.value as 'over' | 'under')}><option value="over">Over</option><option value="under">Under</option></select>
        <select className={sel} value={sogLine} onChange={e => setSogLine(parseFloat(e.target.value))}>{sog.lines.map(l => <option key={l} value={l}>{l} SOG</option>)}</select>
        <span className="text-[#556277]">+</span>
        <select className={sel} value={ptsSide} onChange={e => setPtsSide(e.target.value as 'over' | 'under')}><option value="over">Over</option><option value="under">Under</option></select>
        <select className={sel} value={ptsLine} onChange={e => setPtsLine(parseFloat(e.target.value))}>{pts.lines.map(l => <option key={l} value={l}>{l} PTS</option>)}</select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        <Row k="Joint P (correlated)" v={`${(res.p * 100).toFixed(1)}% ± ${(res.se * 196).toFixed(1)}  ·  fair ${fa === null ? '—' : fa > 0 ? '+' + fa : fa}`} strong />
        <Row k="If independent" v={`${(res.pIndep * 100).toFixed(1)}%  ·  fair ${fi === null ? '—' : fi > 0 ? '+' + fi : fi}`} />
      </div>
      <div className="text-[10px] text-[#556277]">
        ρ = {rho.toFixed(2)} (fitted on MoneyPuck logs unless you overrode it in Settings). A book's same-player combo price carries its own correlation and margin, so compare it with the fair price here, not with the independent product.
      </div>
    </div>
  );
};

export const NhlPlayerDrawer: React.FC<Props> = ({ projection, market, line, evalRow, teammates, variance }) => {
  const mp = marketOf(projection, market)!;
  const d = evalRow.decision;
  const recent = market === 'sog' ? projection.recentShots : projection.recentPoints;
  const unit = market === 'sog' ? 'SOG' : 'PTS';
  const srcNote =
    projection.oppSource === 'live' ? 'live team table, shrunk by games played'
    : projection.oppSource === 'static' ? 'STALE hand-typed table at half weight (live team table not loaded)'
    : 'no opponent data (neutral 1.00)';

  return (
    <div className="p-4 bg-[#182232] border-t border-[#222d3e] text-xs font-mono space-y-3">
      <div className="flex items-center justify-between border-b border-[#222d3e] pb-2">
        <span className="uppercase tracking-wider text-sm font-bold text-white">
          {market === 'sog' ? 'Shots on Goal' : 'Points'} projection &amp; price
        </span>
        <span className="text-cyan-400">{NHL_CONFIG.version} &middot; NB r = {mp.r}{market === 'pts' ? ' (prior)' : ''}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        <Row k="Shrunk base rate (μ₀)" v={`${mp.mu0.toFixed(2)} ${unit}/gm`} />
        <Row k="Evidence behind rate" v={`${mp.nEff.toFixed(0)} effective games`} />
        <Row k={`Opponent factor (${projection.opp})`} v={`${mp.oppFactor.toFixed(3)}×`} />
        {mp.contextFactor !== undefined && (
          <Row k="Context factor (Priors)" v={`${mp.contextFactor.toFixed(3)}× (${mp.contextFactor >= 1.0 ? '+' : ''}${Math.round((mp.contextFactor - 1.0) * 100)}%)`} strong />
        )}
        <Row k="Final expected (μ)" v={`${mp.mu.toFixed(2)} ${unit}`} strong />
        <Row k={`P(Over ${line})`} v={`${(evalRow.pOver * 100).toFixed(1)}%`} />
        <Row k={`P(Under ${line})`} v={`${(evalRow.pUnder * 100).toFixed(1)}%`} />
        <Row k="Fair over (de-vigged)" v={d.fairOver !== null ? `${(d.fairOver * 100).toFixed(1)}%${d.twoWay ? '' : ' (1-sided, assumed hold)'}` : '—'} />
        <Row k="EV over / under" v={`${d.evOver !== null ? (d.evOver * 100).toFixed(1) + '%' : '—'} / ${d.evUnder !== null ? (d.evUnder * 100).toFixed(1) + '%' : '—'}`} />
        <Row k="Avg ice time" v={`${projection.toiAvg.toFixed(1)} min`} />
        <Row k="Inputs / availability" v={`${projection.inputsSource} / ${projection.availability}`} />
      </div>
      <div className="text-[10px] text-[#556277]">Opponent factor source: {srcNote}.</div>

      {mp.contextAdjustments && mp.contextAdjustments.length > 0 && (
        <div className="p-3 bg-[#0f1520] rounded-xl border border-cyan-800/60 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-cyan-300 uppercase font-bold tracking-wider">
              Active Context Prior Adjustments (Goalie, Defense, Usage, Quality)
            </span>
            <span className="text-[10px] text-cyan-400 font-bold">
              Net Impact: {((mp.contextFactor ?? 1.0) - 1.0) >= 0 ? '+' : ''}{Math.round(((mp.contextFactor ?? 1.0) - 1.0) * 100)}%
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {mp.contextAdjustments.map((ca, idx) => (
              <div key={idx} className="flex items-center justify-between bg-[#121927] px-2.5 py-1.5 rounded border border-[#222d3e]">
                <span className="text-white text-xs">{ca.label}</span>
                <span className={`font-bold font-mono text-xs ${ca.impactPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {ca.impactPct > 0 ? '+' : ''}{Math.round(ca.impactPct * 100)}%
                </span>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-[#556277]">
            Integrates goalie quality, opponent team defense, PP1/PP2 usage, and shot danger quality into expectations while preserving MoneyPuck skater season baseline.
          </div>
        </div>
      )}

      <div className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e]">
        <div className="text-[11px] text-[#8b97ac] uppercase mb-1.5 font-bold">Last games ({unit}, most recent first):</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {recent.length ? recent.map((s, i) => (
            <span key={i} className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold ${
              s > line ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>{s}</span>
          )) : <span className="text-[#556277]">No game log loaded</span>}
        </div>
      </div>

      <MarketVarianceDrawerPanel
        variance={variance ?? getNhlMarketVariance(projection, market, line, undefined)}
        sportLabel="NHL Player Prop"
        marketUnit={unit}
      />

      {teammates && teammates.length >= 9 ? (
        <SimPanel projection={projection} teammates={teammates} fallback={<JointPanel projection={projection} />} />
      ) : (
        <JointPanel projection={projection} />
      )}

      <div className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e]">
        <div className="text-white font-bold mb-1">
          Action: <span className={`px-1.5 py-0.5 rounded text-[10px] ${d.tag === 'STAB' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' : d.tag === 'FADE' ? 'bg-orange-950 text-orange-300 border border-orange-600' : 'bg-slate-800 text-slate-300'}`}>{d.tag}</span>
        </div>
        <div className="text-[#8b97ac]">{d.reason}</div>
      </div>
    </div>
  );
};
