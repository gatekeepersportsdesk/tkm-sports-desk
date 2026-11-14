import React, { useMemo } from 'react';
import { simulateNflTeam } from '../../model/gamesim';
import { SimJointBuilder, SimLegOption } from '../common/SimJointBuilder';
import { NflPropSnapshot } from '../../types/nfl';
import { NFL_PLAYERS } from '../../data/nfl_seed';
import { MarketVarianceInfo, getNflMarketVariance } from '../../lib/market_variance';
import { MarketVarianceDrawerPanel } from '../common/MarketVarianceDrawerPanel';
import { useDisplaySettings } from '../common/DisplaySettingsContext';

interface NflPlayerDrawerProps {
  snapshot: NflPropSnapshot;
  isBetPlaced: boolean;
  onRecordBet: (snap: NflPropSnapshot) => void;
  /** every priced receiver on this player's team that week (including this one) */
  teammates?: NflPropSnapshot[];
  variance?: MarketVarianceInfo;
}

const OUT_STATES = ['OUT', 'IR', 'INACTIVE', 'SCRATCHED', 'NOT_IN_LINEUP'];

/** Team receptions simulation: dropbacks -> targets (NB) -> Dirichlet shares -> binomial catches. */
const NflStackPanel: React.FC<{ snapshot: NflPropSnapshot; teammates: NflPropSnapshot[] }> = ({ snapshot, teammates }) => {
  const usable = useMemo(() => teammates.filter(t => !t.availability || !OUT_STATES.includes(t.availability)), [teammates]);
  const sim = useMemo(() => {
    if (usable.length < 2 || !usable.some(t => t.player === snapshot.player)) return null;
    return simulateNflTeam({
      players: usable.map(t => ({ id: t.player, mu: t.mu, catchRate: t.shrunkCatchRate, alpha: t.alpha })),
      sims: 10000,
      seed: `${snapshot.team}|${snapshot.season}|${snapshot.week}|${usable.map(t => t.player + ':' + t.mu.toFixed(3)).join(',')}`
    });
  }, [usable, snapshot.dropbacks, snapshot.team, snapshot.season, snapshot.week, snapshot.player]);
  if (!sim) return null;
  const options: SimLegOption[] = [];
  usable.forEach(t => { const d = sim.draws[t.player]?.rec; if (d) options.push({ id: t.player, label: `${t.player} receptions`, draws: d, defaultLine: t.line, teamKey: t.team, caution: t.inputsSource && t.inputsSource !== 'REAL' ? 'estimated inputs' : (!t.availability || t.availability === 'UNKNOWN') ? 'availability unconfirmed' : undefined }); });
  return (
    <SimJointBuilder
      title="Same-game receptions stack (10,000 simulated games)"
      options={options}
      initial={[{ optionId: snapshot.player, side: 'over', line: snapshot.line }]}
      note={`Team targets → Dirichlet shares → catches, mean-matched to each priced μ and to the NB variance, with the MEASURED teammate residual correlation (+0.027). Checked on 7,964 real 2024-26 player-games: simulated marginals cover 50.4 / 80.3 / 90.2% at the 50 / 80 / 90 levels. Honest limit: teammates' receptions are almost independent once game script is in the mean, so a stack prices close to the product of its legs (pairs: simulated 15.6%, independence 15.3%, actual 16.4%; a statistical tie on Brier). Each leg alone still uses the closed-form price.`}
    />
  );
};

export const NflPlayerDrawer: React.FC<NflPlayerDrawerProps> = ({
  snapshot,
  isBetPlaced,
  onRecordBet,
  teammates,
  variance
}) => {
  const { formatStake } = useDisplaySettings();
  const player = NFL_PLAYERS[snapshot.player];
  const routePct = player ? (player.route_pct * 100).toFixed(1) : "—";
  const ratio = player ? player.ratio.toFixed(4) : "1.0000";

  return (
    <div className="p-4 bg-[#182232] border-t border-[#222d3e] text-xs space-y-3">
      <div className="font-semibold text-white flex items-center justify-between border-b border-[#222d3e] pb-2">
        <span className="font-display uppercase tracking-wider text-sm">
          Mathematical Derivation & Audit Ledger (v1.6 Spec)
        </span>
        <span className="font-mono text-sky-400">
          Model Version: v1.6 walk-forward + 0.6/0.4 blend + absence
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
          <span className="text-[#8b97ac]">1. Projected Dropbacks (Game Script OLS)</span>
          <span className="font-mono text-white font-medium">{snapshot.dropbacks.toFixed(2)}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
          <span className="text-[#8b97ac]">2. Route Participation (Snap Proxy)</span>
          <span className="font-mono text-white font-medium">{routePct}%</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
          <span className="text-[#8b97ac]">3. Bayesian Shrunk TPRR (K=100)</span>
          <span className="font-mono text-white font-medium">{snapshot.shrunkTprr.toFixed(4)}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
          <span className="text-[#8b97ac]">4. Shrunk Catch Rate (K=30 vs 0.68)</span>
          <span className="font-mono text-white font-medium">{(snapshot.shrunkCatchRate * 100).toFixed(1)}%</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
          <span className="text-[#8b97ac]">5. Structural Expected &mu;&#x2081;</span>
          <span className="font-mono text-white font-medium">{snapshot.muStructural.toFixed(3)}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
          <span className="text-[#8b97ac]">6. Walk-Forward Ratio (Clipped [0.85, 1.15])</span>
          <span className="font-mono text-white font-medium">{ratio}</span>
        </div>
        {snapshot.priorWeight !== undefined && snapshot.priorWeight > 0 && (
          <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
            <span className="text-[#8b97ac]">7. External Rate Prior ({snapshot.priorSource})</span>
            <span className="font-mono text-purple-300 font-medium">
              {snapshot.priorAvg?.toFixed(1)} avg rec ({snapshot.priorGames} games, {Math.round(snapshot.priorWeight * 100)}% wt)
            </span>
          </div>
        )}
        <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
          <span className="text-[#8b97ac]">8. v1.6 Final Blended &mu; (60% Model / 40% Shrunk Szn Avg)</span>
          <span className="font-mono text-sky-400 font-bold">{snapshot.mu.toFixed(3)}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
          <span className="text-[#8b97ac]">8. Negative Binomial Dispersion (&alpha;)</span>
          <span className="font-mono text-white font-medium">{snapshot.alpha.toFixed(3)} ({snapshot.pos})</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
          <span className="text-[#8b97ac]">9. De-vigged Market Fair Win %</span>
          <span className="font-mono text-white font-medium">
            {((snapshot.lean === 'OVER' ? snapshot.fair_over : snapshot.fair_under) * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
          <span className="text-[#8b97ac]">10. Model Conditional Win %</span>
          <span className="font-mono text-white font-medium">
            {((snapshot.lean === 'OVER' ? snapshot.p_over : snapshot.p_under) * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="p-3 bg-[#0f1520] rounded-lg border border-[#222d3e]">
        <div className="text-white font-semibold mb-1">
          Card Rule Decision: <span className="font-mono text-sky-400">{snapshot.cardStatus}</span>
        </div>
        <div className="text-xs text-[#8b97ac]">
          {snapshot.cardReason}
        </div>
      </div>

      <MarketVarianceDrawerPanel
        variance={variance ?? getNflMarketVariance(snapshot)}
        sportLabel="NFL Receptions Prop"
        marketUnit="rec"
      />

      {teammates && teammates.length >= 2 && (
        <NflStackPanel snapshot={snapshot} teammates={teammates} />
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRecordBet(snapshot);
          }}
          className={`px-4 py-2 rounded-lg text-xs font-semibold font-display tracking-wider uppercase transition ${
            isBetPlaced
              ? 'bg-sky-600 hover:bg-sky-500 text-white'
              : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold'
          }`}
        >
          {isBetPlaced ? 'Edit Recorded Bet' : `Record Real Bet (${formatStake(1.0)})`}
        </button>
        <span className="text-[11px] text-[#8b97ac] font-mono">
          Strict pre-kickoff logging · Never rewrites previous logs
        </span>
      </div>
    </div>
  );
};
