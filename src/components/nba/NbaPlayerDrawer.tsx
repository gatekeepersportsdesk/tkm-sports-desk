import React from 'react';
import { NbaMarket, NbaPlayerProjection, NBA_MARKET_LABEL, NBA_MARKET_UNIT } from '../../types/nba';
import { NbaJointPanel } from './NbaJointPanel';
import { NbaRowEval } from '../../lib/nba_board';
import { NBA_CONFIG } from '../../model/nba_engine';
import { MarketVarianceInfo, getNbaMarketVariance } from '../../lib/market_variance';
import { MarketVarianceDrawerPanel } from '../common/MarketVarianceDrawerPanel';

interface Props {
  projection: NbaPlayerProjection;
  market: NbaMarket;
  line: number;
  evalRow: NbaRowEval;
  gamePlayers: NbaPlayerProjection[];
  variance?: MarketVarianceInfo;
}

const Row = ({ k, v, strong }: { k: React.ReactNode; v: React.ReactNode; strong?: boolean }) => (
  <div className="flex justify-between py-1 border-b border-[#222d3e]/50">
    <span className="text-[#8b97ac]">{k}</span>
    <span className={strong ? 'text-cyan-400 font-bold' : 'text-white font-medium'}>{v}</span>
  </div>
);

export const NbaPlayerDrawer: React.FC<Props> = ({ projection, market, line, evalRow, gamePlayers, variance }) => {
  const mp = evalRow.mp;
  const d = evalRow.decision;
  const unit = NBA_MARKET_UNIT[market];
  const groupNote = projection.group === 'new' ? 'fewer than 20 games last season: leans on this season sooner, wider distribution (fitted)' : projection.group === 'changer' ? 'new team this season: leans on this season sooner, wider distribution (fitted)' : 'veteran on the same team';
  const srcNote = projection.oppSource === 'live' ? 'live team-allowed table (this season), shrunk toward 1.00 with 10 pseudo-games' : 'no opponent data (neutral 1.00)';
  const sd = Math.sqrt(mp.mu + (mp.mu * mp.mu) / mp.r);
  const recent = projection.recentMinutes;

  return (
    <div className="p-4 bg-[#182232] border-t border-[#222d3e] text-xs font-mono space-y-3">
      <div className="flex items-center justify-between border-b border-[#222d3e] pb-2">
        <span className="uppercase tracking-wider text-sm font-bold text-white">{NBA_MARKET_LABEL[market]} projection &amp; price</span>
        <span className="text-cyan-400">{NBA_CONFIG.version} &middot; NB r = {mp.r.toFixed(1)} (by minutes)</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        <Row k="Player type" v={`${projection.group}${mp.level !== 1 ? ` · level ${mp.level.toFixed(3)}×` : ''}`} />
        <Row k="Shrunk rate" v={`${mp.rate.toFixed(3)} ${unit}/min`} />
        {mp.priorWeight !== undefined && mp.priorWeight > 0 && (
          <Row
            k={`External Rate Prior (${mp.priorSource})`}
            v={`${mp.priorPerGame?.toFixed(1)} ${unit}/g (${mp.priorGp} GP, ${Math.round(mp.priorWeight * 100)}% wt)`}
          />
        )}
        <Row k="Projected minutes" v={`${mp.pm.toFixed(1)}`} />
        <Row k="Base expectation (rate × minutes)" v={`${mp.mu0.toFixed(2)} ${unit}`} />
        <Row k={`Opponent factor (${projection.opp})`} v={`${mp.oppFactor.toFixed(3)}×`} />
        <Row k="Teammate-absence factor" v={`${mp.absFactor.toFixed(3)}×${projection.lostRotation > 0 ? ` (${(projection.lostRotation * 100).toFixed(0)} rotation min out)` : ''}`} />
        <Row k="Final expected (μ) · sd" v={`${mp.mu.toFixed(2)} ${unit} · ${sd.toFixed(2)}`} strong />
        <Row k={`P(Over ${line})`} v={`${(evalRow.pOver * 100).toFixed(1)}%`} />
        <Row k={`P(Under ${line})`} v={`${(evalRow.pUnder * 100).toFixed(1)}%${evalRow.pPush > 0 ? ` · push ${(evalRow.pPush * 100).toFixed(1)}%` : ''}`} />
        <Row k="Fair over (de-vigged)" v={d.fairOver !== null ? `${(d.fairOver * 100).toFixed(1)}%${d.twoWay ? '' : ' (1-sided, assumed hold)'}` : '—'} />
        <Row k="EV over / under" v={`${d.evOver !== null ? (d.evOver * 100).toFixed(1) + '%' : '—'} / ${d.evUnder !== null ? (d.evUnder * 100).toFixed(1) + '%' : '—'}`} />
        <Row k="Games this / last season" v={`${projection.gp} / ${projection.priorGp}`} />
        <Row k="Inputs / availability" v={`${projection.inputsSource} / ${projection.availability}${projection.availabilityNote ? ` (${projection.availabilityNote})` : ''}`} />
      </div>
      <div className="text-[10px] text-[#556277]">Opponent factor source: {srcNote}. Player type: {groupNote}.</div>

      <div className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e]">
        <div className="text-[11px] text-[#8b97ac] uppercase mb-1.5 font-bold">Minutes, last games (oldest → newest):</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {recent.length ? recent.map((m, i) => (
            <span key={i} className="px-2 h-7 flex items-center justify-center rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">{m.toFixed(0)}</span>
          )) : <span className="text-[#556277]">No games played this season yet — priced from last season and the position prior</span>}
        </div>
        <div className="text-[10px] text-[#556277] mt-2">
          Minutes are the main uncertainty in basketball props, so the distribution's width widens as projected minutes fall (the fitted dispersion r depends on minutes). Blowout and foul-trouble risk are inside that width, not modelled separately. When teammates are Out, minutes and usage are redistributed through the fitted absence lift, which is larger in percentage terms for bench players than starters.
        </div>
      </div>

      <MarketVarianceDrawerPanel
        variance={variance ?? getNbaMarketVariance(projection, market, line, undefined)}
        sportLabel="NBA Player Prop"
        marketUnit={unit}
      />

      <NbaJointPanel projection={projection} market={market} line={line} gamePlayers={gamePlayers} />

      <div className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e]">
        <div className="text-white font-bold mb-1">
          Action: <span className={`px-1.5 py-0.5 rounded text-[10px] ${d.tag === 'STAB' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' : d.tag === 'FADE' ? 'bg-orange-950 text-orange-300 border border-orange-600' : 'bg-slate-800 text-slate-300'}`}>{d.tag}</span>
        </div>
        <div className="text-[#8b97ac]">{d.reason}</div>
      </div>
    </div>
  );
};
