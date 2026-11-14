import React from 'react';
import { CardSummary } from '../../lib/card_core';

export interface BaselineRowIn { sport: string; summary: CardSummary; /** the baseline that is the relevant hurdle for this sport */ hurdle: 'UNDER' | 'OVER' }
interface Props { rows: BaselineRowIn[]; current?: string }

const MIN_N = 30;
const pct = (x: number | null, d = 1) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);
const pt = (x: number | null) => (x === null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`);

/** One table, every sport: model win rate beside BOTH blind baselines, with sampling noise. Reads the card summaries; grades nothing itself. */
export const BaselineStrip: React.FC<Props> = ({ rows, current }) => {
  const tot = rows.reduce((a, r) => {
    const d = r.summary.decided;
    return { n: a.n + d, hits: a.hits + r.summary.hits, u: a.u + (r.summary.alwaysUnder ?? 0) * d, o: a.o + (r.summary.alwaysOver ?? 0) * d };
  }, { n: 0, hits: 0, u: 0, o: 0 });
  const line = (label: string, d: number, hits: number, under: number | null, over: number | null, hurdle: string, hi: boolean) => {
    const few = d < MIN_N;
    const w = d ? hits / d : null;
    const noise = w !== null && d ? Math.sqrt(w * (1 - w) / d) : null;
    return (
      <tr key={label} className={`border-b border-[#222d3e]/50 ${hi ? 'text-white bg-[#182232]/50' : 'text-[#c5cddb]'}`}>
        <td className="py-1.5 px-2 font-bold">{label}</td>
        <td className="py-1.5 px-2 text-right">{d}</td>
        {few ? <td colSpan={5} className="py-1.5 px-2 text-center text-amber-400">n={d}: too few to read (need {MIN_N}+ graded rows)</td> : <>
          <td className="py-1.5 px-2 text-right text-cyan-400 font-bold">{pct(w)} <span className="text-[#556277] font-normal">±{(noise! * 100).toFixed(1)}</span></td>
          <td className="py-1.5 px-2 text-right">{pct(under)}</td>
          <td className="py-1.5 px-2 text-right">{pct(over)}</td>
          <td className="py-1.5 px-2 text-right">{pt(w !== null && under !== null ? w - under : null)}</td>
          <td className="py-1.5 px-2 text-right">{pt(w !== null && over !== null ? w - over : null)}</td>
        </>}
        <td className="py-1.5 px-2 text-[#8b97ac]">{hurdle}</td>
      </tr>
    );
  };
  return (
    <div className="bg-[#121824] p-4 rounded-2xl border border-[#222d3e] space-y-2">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-white">Model vs blind baselines — all sports</h3>
        <p className="text-[11px] text-[#8b97ac]">Headline rows only (REAL inputs, known availability), HIT / MISS only. Each baseline is the win rate of leaning that side on every one of the same rows. A raw win rate means nothing until it clears the relevant hurdle by more than its noise.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-[#222d3e] text-[#8b97ac] uppercase text-[11px]">
              <th className="py-1.5 px-2">Sport</th><th className="py-1.5 px-2 text-right">Decided</th><th className="py-1.5 px-2 text-right">Model win %</th>
              <th className="py-1.5 px-2 text-right">Always UNDER</th><th className="py-1.5 px-2 text-right">Always OVER</th>
              <th className="py-1.5 px-2 text-right">Model − UNDER (pts)</th><th className="py-1.5 px-2 text-right">Model − OVER (pts)</th><th className="py-1.5 px-2">Hurdle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => line(r.sport, r.summary.decided, r.summary.hits, r.summary.alwaysUnder, r.summary.alwaysOver, r.hurdle === 'UNDER' ? 'UNDER (skewed counts)' : 'OVER (0.5 hits)', r.sport === current))}
            {rows.length > 1 && line('All sports', tot.n, tot.hits, tot.n ? tot.u / tot.n : null, tot.n ? tot.o / tot.n : null, 'mixed — read per sport', false)}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-[#556277]">The noise is one standard error of the model's win rate; a gap under about two of them is not a result. Rows from the same day share games, so the true noise is a little larger.</p>
    </div>
  );
};
