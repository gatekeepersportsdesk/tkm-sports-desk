import React, { useMemo, useState } from 'react';
import { simJoint, DrawLeg } from '../../model/gamesim';
import { fairAmerican } from '../../model/sampler';

export interface SimLegOption {
  id: string;
  label: string;
  /** one value per simulated game */
  draws: ArrayLike<number>;
  defaultLine: number;
  /** same-team legs share simulated games; different teams are independent, so the key says which sim they came from */
  teamKey: string;
  /** set when this player's inputs are estimated or his availability is unconfirmed; shown next to the joint */
  caution?: string;
}

interface LegState { optionId: string; side: 'over' | 'under'; line: number }

interface Props {
  title: string;
  options: SimLegOption[];
  initial: LegState[];
  note?: string;
}

/**
 * Up to 3 legs from the game simulation. Legs on the same team come from the same simulated games (so teammate
 * dependence is real); legs on different teams are independent by construction.
 */
export const SimJointBuilder: React.FC<Props> = ({ title, options, initial, note }) => {
  const [legs, setLegs] = useState<LegState[]>(initial.filter(l => options.some(o => o.id === l.optionId)));
  const byId = useMemo(() => new Map(options.map(o => [o.id, o])), [options]);
  const sel = 'bg-[#0b0f14] border border-[#222d3e] rounded px-1.5 py-1 text-xs font-mono text-white outline-none';
  const valid = legs.filter(l => byId.has(l.optionId));
  const res = useMemo(() => {
    if (valid.length < 1) return null;
    // group legs by simulated team, then multiply the independent team groups
    const groups = new Map<string, DrawLeg[]>();
    valid.forEach(l => {
      const o = byId.get(l.optionId)!;
      (groups.get(o.teamKey) || groups.set(o.teamKey, []).get(o.teamKey)!).push({ draws: o.draws, line: l.line, side: l.side });
    });
    let p = 1, pIndep = 1, varSum = 0;
    const legP: number[] = [];
    groups.forEach(g => { const r = simJoint(g); p *= r.p; pIndep *= r.pIndep; varSum += r.p > 0 ? (r.se / r.p) ** 2 : 0; legP.push(...r.legP); });
    return { p, pIndep, se: p * Math.sqrt(varSum), legP };
  }, [valid.map(l => `${l.optionId}|${l.side}|${l.line}`).join(';'), byId]);
  const upd = (i: number, patch: Partial<LegState>) => setLegs(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cautions = valid.map(l => byId.get(l.optionId)).filter((o): o is SimLegOption => !!o && !!o.caution).map(o => `${o.label}: ${o.caution}`);
  const fa = res ? fairAmerican(res.p) : null;
  const fi = res ? fairAmerican(res.pIndep) : null;
  const fmt = (x: number | null) => (x === null ? '—' : x > 0 ? '+' + x : String(x));
  return (
    <div className="p-3 bg-[#0f1520] rounded-xl border border-[#222d3e] space-y-2">
      <div className="text-white font-bold">{title}</div>
      {legs.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select className={sel} value={l.optionId} onChange={e => upd(i, { optionId: e.target.value, line: byId.get(e.target.value)?.defaultLine ?? l.line })}>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select className={sel} value={l.side} onChange={e => upd(i, { side: e.target.value as 'over' | 'under' })}><option value="over">Over</option><option value="under">Under</option></select>
          <input className={sel + ' w-16'} type="number" step={0.5} min={0} value={l.line} onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) upd(i, { line: v }); }} />
          {legs.length > 1 && <button className="text-[#8b97ac] hover:text-white px-1" onClick={() => setLegs(prev => prev.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      {legs.length < 3 && options.length > 0 && (
        <button className={sel} onClick={() => setLegs(prev => [...prev, { optionId: options[0].id, side: 'over', line: options[0].defaultLine }])}>+ add leg</button>
      )}
      {res && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <div className="flex justify-between py-1 border-b border-[#222d3e]/50"><span className="text-[#8b97ac]">Joint P (simulated games)</span><span className="text-cyan-400 font-bold">{(res.p * 100).toFixed(1)}% ± {(res.se * 196).toFixed(1)} · fair {fmt(fa)}</span></div>
          <div className="flex justify-between py-1 border-b border-[#222d3e]/50"><span className="text-[#8b97ac]">If independent</span><span className="text-white font-medium">{(res.pIndep * 100).toFixed(1)}% · fair {fmt(fi)}</span></div>
          <div className="sm:col-span-2 text-[10px] text-[#556277] py-1">Each leg alone: {res.legP.map(x => (x * 100).toFixed(1) + '%').join(' · ')}</div>
        </div>
      )}
      {cautions.length > 0 && <div className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800 rounded px-2 py-1">⚠ {cautions.join(' · ')}. Treat this fair price as indicative only; it is not a bet signal.</div>}
      {note && <div className="text-[10px] text-[#556277]">{note}</div>}
    </div>
  );
};
