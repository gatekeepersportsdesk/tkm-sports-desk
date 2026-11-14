/**
 * NFL line import + baseline rows. Pure functions (no React, no globals) so the
 * whole flow is unit-tested. Rules:
 *   - a player must exist in the receiver pool (live nflverse inputs); we never
 *     invent a player, a team, or a stat line for a name we can't resolve
 *   - a game must exist for that team in the requested week (no random fallback)
 *   - availability comes from the official injury report; if no report was loaded
 *     it is UNKNOWN and the row cannot qualify as BET
 *   - at most `game_cap` BETs per game, ranked by edge
 */
import { NflPlayerStats, NflGameContext, NflPropSnapshot } from '../types/nfl';
import { AvailabilityStatus, fuzzyMatchName } from './availability';
import { NflInjuryInfo, normalizePlayerName } from './nflverse';
import { calculateNflSnapshotFromInputs, inputsSourceFor } from '../data/nfl_seed';
import { applyGameCap } from '../model/nfl_engine';

export interface NflImportContext {
  games: Record<string, NflGameContext>;
  players: NflPlayerStats[];
  injuries: Record<string, NflInjuryInfo>;
  injuriesAvailable: boolean;
}

export interface ParsedLine { player: string; line: number; over: string; under: string }
export interface ImportSkip { text: string; reason: string }

export function parseImportText(text: string): { lines: ParsedLine[]; skipped: ImportSkip[] } {
  const lines: ParsedLine[] = [];
  const skipped: ImportSkip[] = [];
  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    const parts = t.split(/[\t|,]/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) { skipped.push({ text: t, reason: 'needs: player, line, over, under' }); continue; }
    const line = parseFloat(parts[1]);
    if (!Number.isFinite(line) || line < 0) { skipped.push({ text: t, reason: 'line is not a number' }); continue; }
    // odds are optional: a line with no odds is still a row (model-only, never BET)
    lines.push({ player: parts[0], line, over: parts[2] || '', under: parts[3] || '' });
  }
  return { lines, skipped };
}

export function availabilityFor(
  name: string,
  ctx: Pick<NflImportContext, 'injuries' | 'injuriesAvailable'>
): { status: AvailabilityStatus; note?: string } {
  if (!ctx.injuriesAvailable) return { status: 'UNKNOWN' };
  const hit = ctx.injuries[normalizePlayerName(name)];
  if (!hit) return { status: 'ACTIVE' };
  return { status: hit.status, note: hit.detail };
}

export function resolveReceiver(name: string, pool: NflPlayerStats[]): NflPlayerStats | undefined {
  const key = normalizePlayerName(name);
  const exact = pool.filter(p => normalizePlayerName(p.name) === key);
  const pick = (arr: NflPlayerStats[]) => arr.find(p => p.source === 'nflverse') || arr[0];
  if (exact.length) return pick(exact);
  const fuzzy = pool.filter(p => fuzzyMatchName(name, p.name));
  // an ambiguous fuzzy hit (two different players) must not be guessed
  const names = new Set(fuzzy.map(p => normalizePlayerName(p.name)));
  return names.size === 1 ? pick(fuzzy) : undefined;
}

export function findGameFor(team: string, season: number, week: number, games: Record<string, NflGameContext>): NflGameContext | undefined {
  return Object.values(games).find(g => g.season === season && g.week === week && (g.home === team || g.away === team));
}

export function snapshotFor(
  p: NflPlayerStats, game: NflGameContext, line: number, over: string, under: string,
  ctx: Pick<NflImportContext, 'injuries' | 'injuriesAvailable'>
): NflPropSnapshot {
  const av = availabilityFor(p.name, ctx);
  const snap = calculateNflSnapshotFromInputs(p, game, line, over, under, inputsSourceFor(p, game.week), av.status);
  if (av.note && av.status !== 'ACTIVE') snap.availabilityNote = av.note;
  return snap;
}

/** A model-only row: no odds, never BET. Used for the desk's baseline board. */
export function baselineSnapshot(
  p: NflPlayerStats, game: NflGameContext, ctx: Pick<NflImportContext, 'injuries' | 'injuriesAvailable'>
): NflPropSnapshot {
  const line = Math.max(0.5, Math.round(p.season_avg * 2) / 2);
  return snapshotFor(p, game, line, '', '', ctx);
}

export function importNflLines(
  text: string, season: number, week: number, book: string, kind: 'pre' | 'open' | 'close',
  ctx: NflImportContext, existing: NflPropSnapshot[]
): { snapshots: NflPropSnapshot[]; imported: number; skipped: ImportSkip[] } {
  const parsed = parseImportText(text);
  const skipped = [...parsed.skipped];
  let next = [...existing];
  let imported = 0;

  for (const l of parsed.lines) {
    const p = resolveReceiver(l.player, ctx.players);
    if (!p) { skipped.push({ text: l.player, reason: 'not in this week\'s WR/TE pool — not priced (no inputs to price from)' }); continue; }
    const game = findGameFor(p.team, season, week, ctx.games);
    if (!game) { skipped.push({ text: l.player, reason: `${p.team} has no game in week ${week}` }); continue; }
    const snap = snapshotFor(p, game, l.line, l.over, l.under, ctx);
    snap.book = book;
    snap.kind = kind;
    const idx = next.findIndex(s => s.id === snap.id);
    if (idx >= 0) next[idx] = snap; else next.push(snap);
    imported++;
  }
  next = applyGameCap(next);
  return { snapshots: next, imported, skipped };
}
