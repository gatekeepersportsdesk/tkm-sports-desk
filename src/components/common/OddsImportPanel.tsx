import React, { useEffect, useRef, useState } from 'react';
import { OddsSport, ParsedPosted, Plan, PostedLine, parsePostedText } from '../../lib/odds_ingest';
import { recordOddsImport } from '../../lib/pick_of_the_day';
import { getDailyPickerSnapshot } from '../../lib/picker_grading';

interface Props {
  sport: OddsSport;
  label: string;
  date?: string;
  /** builds the plan against this sport's board (player matching, key format, model for EV) */
  buildPlan: (posted: PostedLine[], book: string) => Plan;
  /** writes the plan into the board's odds; `replace` clears this sport's odds first (only after the user confirmed) */
  onApply: (plan: Plan, replace: boolean) => string;
  existing: number;
}
const KEY = (s: string) => `gatekeep_posted_odds_v1_${s}`;

/** Structured odds import: paste or upload JSON / CSV. The app never fetches odds from book sites itself. */
export const OddsImportPanel: React.FC<Props> = ({ sport, label, date, buildPlan, onApply, existing }) => {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedPosted | null>(null);
  const [book, setBook] = useState('best');
  const [replace, setReplace] = useState(false);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [meta, setMeta] = useState<{ at: number; rows: number; books: Record<string, number> } | null>(() => { try { return JSON.parse(localStorage.getItem(KEY(sport)) || 'null'); } catch { return null; } });
  const fileRef = useRef<HTMLInputElement>(null);
  const plan = parsed && parsed.lines.length ? buildPlan(parsed.lines, book) : null;
  useEffect(() => { setMsg(''); }, [text, book]);

  const parse = (t: string) => setParsed(t.trim() ? parsePostedText(t, sport) : null);
  const books = parsed ? Array.from(new Set(parsed.lines.map(l => l.book))).sort() : [];
  const perBook = parsed ? parsed.lines.reduce<Record<string, number>>((a, l) => { a[l.book] = (a[l.book] ?? 0) + 1; return a; }, {}) : {};
  const apply = () => {
    if (!plan || !plan.matched) return;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const existingSnap = getDailyPickerSnapshot(sport, targetDate);
    if (existingSnap && existingSnap.plays.length > 0 && !replace) {
      if (!confirm(`An official card and picker snapshot for ${label} (${targetDate}) already exists. Overwrite with this new odds import?`)) {
        return;
      }
    } else if (replace && !confirm(`Replace ALL ${label} odds currently on the board (${existing} entries) with this import?`)) {
      return;
    }
    const r = onApply(plan, replace);
    const m = { at: Date.now(), rows: plan.matched, books: plan.byBook, date: targetDate };
    setMeta(m);
    try { localStorage.setItem(KEY(sport), JSON.stringify(m)); } catch { /* ignore */ }
    recordOddsImport(sport, targetDate, plan.matched, m.at);
    window.dispatchEvent(new CustomEvent('gatekeep_odds_imported', {
      detail: { sport, date: targetDate, rows: plan.matched, at: m.at, forceOverwrite: true }
    }));
    setMsg(r);
  };
  const pathHint = (
    <p className="text-[11px] font-mono text-slate-400 mb-2">Primary: load JSON from <span className="text-sky-300">scripts/odds</span> (Bet99 / Bet365), e.g. odds_{sport}_YYYY-MM-DD.json. Fallback: screenshot OCR.</p>
  );
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full text-[11px] font-mono cursor-pointer ${on ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#0f1520] text-[#8b97ac] border border-[#222d3e] hover:text-white'}`;
  return (
    <>
    {pathHint}
    <div className="bg-[#121824] rounded-2xl border border-[#222d3e]">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 p-3 text-left cursor-pointer">
        <span className="text-xs font-bold uppercase tracking-wide text-white">Odds import — {label}</span>
        <span className="text-[11px] font-mono text-[#8b97ac]">{meta ? `last import ${new Date(meta.at).toLocaleTimeString()} · ${meta.rows} lines · ${Object.entries(meta.books).map(([b, n]) => `${b} ${n}`).join(', ')}` : 'no import yet'} · {open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="p-3 pt-0 space-y-2">
          <p className="text-[11px] text-[#8b97ac]">Paste or upload JSON / CSV with <span className="font-mono">book, player, market, line, over, under</span> (sport, asOf optional). Several lines per player-market and several books are kept. Only prices are written: the import never changes the model and never grades anything. Typing a price on the board still works and overrides.</p>
          <p className="text-[11px] text-[#556277]">Primary: load the JSON your local script wrote (<span className="font-mono">scripts/odds</span>, e.g. <span className="font-mono">odds_{sport}_YYYY-MM-DD.json</span>; run it before the games, not live). Fallback: the screenshot upload. This page never contacts a sportsbook.</p>
          <textarea value={text} onChange={e => { setText(e.target.value); parse(e.target.value); }} rows={5} placeholder={'book,player,market,line,over,under\nbet365,Jamal Murray,Points,22.5,-105,-125\nbet365,Jamal Murray,Points,24.5,+150,-185'}
            className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-lg p-2 text-xs font-mono text-white outline-none focus:border-cyan-400" />
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#8b97ac]">
            <input ref={fileRef} type="file" accept=".json,.csv,.txt" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { const t = await f.text(); setText(t); parse(t); } e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} className="px-2 py-1 rounded border border-[#222d3e] hover:text-white cursor-pointer">Load odds file…</button>
            <span>use:</span>
            <button onClick={() => setBook('best')} className={chip(book === 'best')}>best of all books</button>
            {books.map(b => <button key={b} onClick={() => setBook(b)} className={chip(book === b)}>{b} only</button>)}
            <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} className="accent-cyan-400" />replace existing odds</label>
            <button onClick={apply} disabled={!plan || !plan.matched} className="px-3 py-1 rounded bg-emerald-900/60 text-emerald-200 border border-emerald-500/40 disabled:opacity-40 cursor-pointer">Apply to board{plan ? ` (${plan.matched})` : ''}</button>
          </div>
          {parsed && (
            <div className="text-[11px] font-mono text-[#8b97ac] space-y-0.5">
              <div>{parsed.lines.length} readable line(s){Object.keys(perBook).length ? ` — ${Object.entries(perBook).map(([b, n]) => `${b}: ${n}`).join(' · ')}` : ''}{parsed.otherSport ? ` · ${parsed.otherSport} row(s) for another sport ignored` : ''}</div>
              {plan && <div>{plan.matched} matched to players on today's board{plan.unmatched.length ? `; ${plan.unmatched.length} not found: ${plan.unmatched.slice(0, 6).join(', ')}${plan.unmatched.length > 6 ? '…' : ''}` : ''}</div>}
              {parsed.errors.length > 0 && <details className="text-amber-300"><summary className="cursor-pointer">{parsed.errors.length} row(s) rejected</summary><ul className="list-disc pl-5">{parsed.errors.slice(0, 40).map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
              {parsed.lines.length === 0 && parsed.errors.length > 0 && <div className="text-rose-300">Nothing imported; existing odds are untouched.</div>}
            </div>
          )}
          {msg && <div className="text-[11px] font-mono text-cyan-300">{msg}</div>}
        </div>
      )}
    </div>
    </>
  );
};
