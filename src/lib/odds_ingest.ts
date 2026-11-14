/**
 * Structured odds import. Paste or upload JSON / CSV of posted props; every posted line keeps its book. Nothing is invented:
 * a blank or unreadable price is null, a row with neither side is rejected, and the import never touches μ / r or grades anything.
 *
 * Accepted columns / keys (case-insensitive):  book, sport, player, market, line, over / overOdds, under / underOdds, asOf.
 * JSON may be an array of such objects or { lines | props | rows | data: [...] }.
 */
import { fuzzyMatchName, normalizeName } from './availability';
import { parseOdds, americanToDecimal } from './odds';

export type OddsSport = 'nba' | 'nhl' | 'nfl' | 'mlb';
export interface PostedLine { sport?: string; book: string; player: string; market: string; line: number; overOdds: number | null; underOdds: number | null; asOf?: string }
export interface ParsedPosted { lines: PostedLine[]; errors: string[]; otherSport: number }

const BOOK_ALIASES: Record<string, string> = { bet365: 'bet365', 'bet 365': 'bet365', bet99: 'bet99', 'bet 99': 'bet99' };
export const normBook = (b: unknown): string => { const s = String(b ?? '').trim().toLowerCase(); return BOOK_ALIASES[s] ?? (s || 'other'); };

const MARKETS: Record<OddsSport, Record<string, string>> = {
  nba: { pts: 'pts', points: 'pts', point: 'pts', reb: 'reb', rebs: 'reb', rebounds: 'reb', ast: 'ast', assists: 'ast', tpm: 'tpm', '3pm': 'tpm', '3pt': 'tpm', threes: 'tpm', '3-pointers': 'tpm', '3-pointers made': 'tpm', '3 pointers made': 'tpm', 'three pointers made': 'tpm', 'threes made': 'tpm', pra: 'pra', 'pts+reb+ast': 'pra', 'points + rebounds + assists': 'pra', 'pts + reb + ast': 'pra', stl: 'stl', steals: 'stl', blk: 'blk', blocks: 'blk' },
  nhl: { sog: 'sog', shots: 'sog', 'shots on goal': 'sog', 'player shots on goal': 'sog', pts: 'pts', points: 'pts', 'player points': 'pts' },
  nfl: { rec: 'rec', receptions: 'rec', 'player receptions': 'rec', 'receptions made': 'rec' },
  mlb: { hit: 'hit', hits: 'hit', 'player hits': 'hit', 'to record a hit': 'hit', h: 'hit' }
};
export function normalizeMarket(sport: OddsSport, raw: unknown): string | null {
  const k = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const t = MARKETS[sport];
  return t[k] ?? t[k.replace(/^(player|total)\s+/, '')] ?? null;
}

function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',' || c === '\t') { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}
const pick = (o: Record<string, any>, keys: string[]) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== '') return o[k]; return undefined; };

export function parsePostedText(text: string, sport: OddsSport): ParsedPosted {
  const errors: string[] = [];
  let objs: Record<string, any>[] = [];
  const t = (text || '').trim();
  if (!t) return { lines: [], errors: ['Nothing to import: the text is empty.'], otherSport: 0 };
  if (t[0] === '[' || t[0] === '{') {
    try {
      const j = JSON.parse(t);
      const arr = Array.isArray(j) ? j : ['lines', 'props', 'rows', 'data'].map(k => j?.[k]).find(Array.isArray);
      if (!arr) return { lines: [], errors: ['JSON must be an array of props or an object with a lines / props / rows / data array.'], otherSport: 0 };
      objs = arr.map((o: any) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.toLowerCase().replace(/[\s_-]/g, ''), v])));
    } catch (e: any) { return { lines: [], errors: [`Invalid JSON: ${e.message}`], otherSport: 0 }; }
  } else {
    const rows = t.split(/\r?\n/).filter(r => r.trim());
    const head = splitCsv(rows[0]).map(h => h.toLowerCase().replace(/[\s_-]/g, ''));
    if (!head.includes('player') && !head.includes('name')) return { lines: [], errors: ['CSV needs a header row with at least: player, market, line, over, under (book optional).'], otherSport: 0 };
    objs = rows.slice(1).map(r => { const c = splitCsv(r); return Object.fromEntries(head.map((h, i) => [h, c[i]])); });
  }
  const lines: PostedLine[] = []; let otherSport = 0;
  objs.forEach((o, i) => {
    const where = `row ${i + 1}`;
    const sp = pick(o, ['sport', 'league']);
    if (sp && String(sp).trim().toLowerCase() !== sport) { otherSport++; return; }
    const player = String(pick(o, ['player', 'name', 'playername']) ?? '').trim();
    const market = normalizeMarket(sport, pick(o, ['market', 'prop', 'stat']));
    const line = Number(pick(o, ['line', 'point', 'handicap', 'total']));
    if (!player) { errors.push(`${where}: no player`); return; }
    if (!market) { errors.push(`${where} (${player}): market "${pick(o, ['market', 'prop', 'stat']) ?? ''}" is not a ${sport.toUpperCase()} market this desk prices`); return; }
    if (!Number.isFinite(line) || line < 0) { errors.push(`${where} (${player}): line is not a number`); return; }
    const over = parseOdds(pick(o, ['over', 'overodds', 'o']) as any)?.us ?? null;
    const under = parseOdds(pick(o, ['under', 'underodds', 'u']) as any)?.us ?? null;
    if (over === null && under === null) { errors.push(`${where} (${player}): no readable price on either side`); return; }
    lines.push({ sport, book: normBook(pick(o, ['book', 'sportsbook', 'source'])), player, market, line, overOdds: over, underOdds: under, asOf: pick(o, ['asof', 'timestamp', 'time']) as string | undefined });
  });
  return { lines, errors, otherSport };
}

export interface Candidate { id: number | string; name: string }
export interface PlanOpts {
  /** 'best' picks, per line, the book with the best EV (model) else the tighter two-way price; otherwise only that book */
  book: string;
  candidates: Candidate[];
  keyFor: (market: string, id: number | string, line: number) => string;
  model?: (market: string, id: number | string, line: number) => { pOver: number; pUnder: number } | null;
  addMissing?: boolean;
}
export interface PlannedEntry { over: number | null; under: number | null; book: string; market: string; id: number | string; line: number }
export interface Plan { entries: Record<string, PlannedEntry>; matched: number; unmatched: string[]; byBook: Record<string, number>; considered: number }

export function resolveCandidate(name: string, cands: Candidate[]): Candidate | undefined {
  const k = normalizeName(name);
  const exact = cands.filter(c => normalizeName(c.name) === k);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined; // ambiguous: never guess
  const fz = cands.filter(c => fuzzyMatchName(name, c.name));
  return new Set(fz.map(c => normalizeName(c.name))).size === 1 ? fz[0] : undefined;
}

const ev = (p: number, us: number | null) => (us == null ? null : p * americanToDecimal(us) - 1);
const hold = (o: number | null, u: number | null) => (o != null && u != null ? (o < 0 ? -o / (-o + 100) : 100 / (o + 100)) + (u < 0 ? -u / (-u + 100) : 100 / (u + 100)) : Infinity);
const BOOK_ORDER = ['bet99', 'bet365'];

export function planApply(posted: PostedLine[], opts: PlanOpts): Plan {
  const unmatched = new Set<string>();
  const groups = new Map<string, { id: number | string; market: string; line: number; cands: PostedLine[] }>();
  let considered = 0;
  const candidates = [...opts.candidates];

  for (const p of posted) {
    if (opts.book !== 'best' && p.book !== opts.book) continue;
    considered++;
    let c = resolveCandidate(p.player, candidates);
    if (!c && opts.addMissing) {
      c = { id: p.player, name: p.player };
      candidates.push(c);
    }
    if (!c) { unmatched.add(p.player); continue; }
    const key = opts.keyFor(p.market, c.id, p.line);
    const g = groups.get(key) ?? { id: c.id, market: p.market, line: p.line, cands: [] };
    g.cands.push(p); groups.set(key, g);
  }
  const entries: Plan['entries'] = {}; const byBook: Record<string, number> = {};
  for (const [key, g] of groups) {
    const m = opts.model?.(g.market, g.id, g.line) ?? null;
    const score = (p: PostedLine) => {
      const two = p.overOdds != null && p.underOdds != null ? 1 : 0;
      const e = m ? Math.max(ev(m.pOver, p.overOdds) ?? -Infinity, ev(m.pUnder, p.underOdds) ?? -Infinity) : -Infinity;
      return [two, e, -hold(p.overOdds, p.underOdds), -(BOOK_ORDER.indexOf(p.book) < 0 ? 9 : BOOK_ORDER.indexOf(p.book))];
    };
    const best = [...g.cands].sort((a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return a.book.localeCompare(b.book); })[0];
    entries[key] = { over: best.overOdds, under: best.underOdds, book: best.book, market: g.market, id: g.id, line: g.line };
    byBook[best.book] = (byBook[best.book] ?? 0) + 1;
  }
  return { entries, matched: Object.keys(entries).length, unmatched: [...unmatched].sort(), byBook, considered };
}

/** Merge a plan into an odds map. Existing keys are overwritten only where the import has a value; nothing is cleared unless `replace`. */
export function mergeOddsMap<E extends { over?: number | null; under?: number | null }>(existing: Record<string, E>, plan: Plan, replace = false): Record<string, E> {
  const out: Record<string, any> = replace ? {} : { ...existing };
  for (const [k, e] of Object.entries(plan.entries)) out[k] = { ...(out[k] ?? {}), over: e.over, under: e.under };
  return out;
}
