/**
 * NHL 2026 Current-Season League-Wide Priors Layer
 *
 * Loads MoneyPuck 2026 CSVs as a current-season layer ONLY (older shrinkage priors remain frozen):
 *  - nhl_2026_skaters_season.csv (skater totals, TOI, PP 5on4, ES 5on5, shot quality)
 *  - nhl_2026_goalies_season.csv (league-wide goalie save%, xGA, games played)
 *  - nhl_2026_lines_season.csv (5on5 / PP line combinations and team ranks)
 *  - nhl_2026_gbg_sog_form.csv (game-by-game SOG + Points form logs, most recent first)
 *  - nhl_2026_gbg_goalies.csv (game-by-game goalie starts & form)
 *
 * Rules:
 *  - Never fabricate game logs: if a player has no rows in gbg CSVs, return [] (missing form -> null/--).
 *  - Team abbreviations are normalized consistently (LAK, NJD, SJS, TBL, UTA, VGK, etc.).
 */

import { NhlPlayerSnapshot } from '../types/nhl';
import {
  normalizeName,
  normalizeTeam,
  NhlGoalieRate,
  NhlPpUsage,
  NhlEsUsage,
  NhlShotQuality
} from './nhl_context_priors';

export interface Nhl2026SkaterPrior {
  playerId: number;
  name: string;
  team: string;
  position: string;
  gp: number;
  icetimeSec: number;
  toiAvg: number;
  shotsOnGoal: number;
  points: number;
  goals: number;
  xOnGoal: number;
  highDangerShotsPer60: number;
  ixgPerShot: number;
  ppToiPerGame: number;
  ppShotsPer60: number;
  ppPointsPer60: number;
  esToiPerGame: number;
}

export interface Nhl2026SkaterForm {
  playerId: number;
  name: string;
  team: string;
  /** Shots on goal ordered newest-first */
  recentShots: number[];
  /** Points ordered newest-first */
  recentPoints: number[];
  /** Game dates YYYYMMDD ordered newest-first */
  gameDates: number[];
}

export interface Nhl2026GoalieGbgSummary {
  playerId: number;
  name: string;
  team: string;
  recentSavePctL5: number | null;
  recentGames: number;
  lastGameDate: number | null;
}

export interface Nhl2026LineCombo {
  lineId: string;
  name: string;
  team: string;
  position: string;
  situation: string;
  gamesPlayed: number;
  icetime: number;
  iceTimeRank: number;
  xGoalsPct: number;
}

const skaterById = new Map<number, Nhl2026SkaterPrior>();
const skaterByName = new Map<string, Nhl2026SkaterPrior>();
const skaterFormById = new Map<number, Nhl2026SkaterForm>();
const skaterFormByName = new Map<string, Nhl2026SkaterForm>();
const goalie2026ByTeam = new Map<string, NhlGoalieRate>();
const goalie2026ByName = new Map<string, NhlGoalieRate>();
const goalie2026GbgByName = new Map<string, Nhl2026GoalieGbgSummary>();
const lines2026ByTeam = new Map<string, Nhl2026LineCombo[]>();
const es2026ByPlayer = new Map<string, NhlEsUsage>();
const pp2026ByPlayer = new Map<string, NhlPpUsage>();
const sq2026ByPlayer = new Map<string, NhlShotQuality>();

let loaded = false;
let clientPromise: Promise<boolean> | null = null;

function parseSimpleCsv(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0 && !l.startsWith('#'));
  if (lines.length === 0) return { header: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const header = parseLine(lines[0]);
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    rows.push(parseLine(lines[i]));
  }
  return { header, rows };
}

function colIndex(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => { map[h] = i; });
  return map;
}

export function parseNhl2026SkatersSeason(csv: string): void {
  const { header, rows } = parseSimpleCsv(csv);
  if (!rows.length) return;
  const c = colIndex(header);
  const sitIdx = c.situation ?? 5;

  const byPid = new Map<number, {
    base?: Nhl2026SkaterPrior;
    ppSec: number; ppSog: number; ppPts: number; ppGp: number;
    esSec: number; esGp: number;
  }>();

  for (const r of rows) {
    const sit = r[sitIdx];
    if (sit !== 'all' && sit !== '5on4' && sit !== '5on5') continue;
    const pid = parseInt(r[c.playerId ?? 0], 10);
    if (!Number.isFinite(pid)) continue;
    const rec = byPid.get(pid) || { ppSec: 0, ppSog: 0, ppPts: 0, ppGp: 0, esSec: 0, esGp: 0 };

    const gp = parseInt(r[c.games_played ?? 6], 10) || 0;
    const ice = parseFloat(r[c.icetime ?? 7]) || 0;

    if (sit === 'all') {
      const sog = parseFloat(r[c.I_F_shotsOnGoal]) || 0;
      const pts = parseFloat(r[c.I_F_points]) || 0;
      const goals = parseFloat(r[c.I_F_goals]) || 0;
      const xog = parseFloat(r[c.I_F_xOnGoal]) || 0;
      const hdShots = parseFloat(r[c.I_F_highDangerShots]) || 0;
      const xg = parseFloat(r[c.I_F_xGoals]) || 0;
      const iceMin = ice / 60;

      rec.base = {
        playerId: pid,
        name: r[c.name ?? 2] || '',
        team: normalizeTeam(r[c.team ?? 3] || ''),
        position: r[c.position ?? 4] || 'F',
        gp,
        icetimeSec: ice,
        toiAvg: gp > 0 ? iceMin / gp : 0,
        shotsOnGoal: sog,
        points: pts,
        goals,
        xOnGoal: xog,
        highDangerShotsPer60: iceMin > 0 ? (hdShots / iceMin) * 60 : 0,
        ixgPerShot: sog > 0 ? xg / sog : 0,
        ppToiPerGame: 0,
        ppShotsPer60: 0,
        ppPointsPer60: 0,
        esToiPerGame: 0
      };
    } else if (sit === '5on4') {
      rec.ppSec = ice;
      rec.ppGp = gp;
      rec.ppSog = parseFloat(r[c.I_F_shotsOnGoal]) || 0;
      rec.ppPts = parseFloat(r[c.I_F_points]) || 0;
    } else if (sit === '5on5') {
      rec.esSec = ice;
      rec.esGp = gp;
    }
    byPid.set(pid, rec);
  }

  for (const rec of byPid.values()) {
    if (!rec.base) continue;
    const b = rec.base;
    const gp = Math.max(1, b.gp);
    const ppMin = rec.ppSec / 60;
    const esMin = rec.esSec / 60;
    b.ppToiPerGame = ppMin / gp;
    b.ppShotsPer60 = ppMin > 0 ? (rec.ppSog / ppMin) * 60 : 0;
    b.ppPointsPer60 = ppMin > 0 ? (rec.ppPts / ppMin) * 60 : 0;
    b.esToiPerGame = esMin / gp;

    skaterById.set(b.playerId, b);
    const nk = normalizeName(b.name);
    if (nk) skaterByName.set(nk, b);

    if (nk) {
      const ppUnit: NhlPpUsage['ppUnit'] = b.ppToiPerGame >= 2.6 ? 'PP1' : b.ppToiPerGame >= 1.1 ? 'PP2' : 'NONE';
      pp2026ByPlayer.set(nk, {
        playerName: b.name,
        team: b.team,
        ppUnit,
        ppToiPerGame: b.ppToiPerGame,
        ppShotsPer60: b.ppShotsPer60,
        ppPointsPer60: b.ppPointsPer60
      });

      const isD = b.position.toUpperCase().startsWith('D');
      const esRank = isD
        ? (b.esToiPerGame >= 18.0 ? 1 : b.esToiPerGame >= 14.5 ? 2 : 3)
        : (b.esToiPerGame >= 14.8 ? 1 : b.esToiPerGame >= 12.2 ? 2 : 3);
      es2026ByPlayer.set(nk, {
        playerName: b.name,
        team: b.team,
        esLine: isD ? `Pair ${esRank}` : `Line ${esRank}`,
        esToiPerGame: b.esToiPerGame,
        esRank
      });

      sq2026ByPlayer.set(nk, {
        playerName: b.name,
        team: b.team,
        highDangerShotsPer60: b.highDangerShotsPer60,
        rushShotsPer60: 0,
        ixgPerShot: b.ixgPerShot
      });
    }
  }
}

export function parseNhl2026GoaliesSeason(csv: string): void {
  const { header, rows } = parseSimpleCsv(csv);
  if (!rows.length) return;
  const c = colIndex(header);
  const sitIdx = c.situation ?? 5;

  const starterCandidate = new Map<string, NhlGoalieRate>();
  for (const r of rows) {
    if (r[sitIdx] !== 'all') continue;
    const name = r[c.name ?? 2] || '';
    const team = normalizeTeam(r[c.team ?? 3] || '');
    const gp = parseInt(r[c.games_played ?? 6], 10) || 0;
    const iceSec = parseFloat(r[c.icetime ?? 7]) || 0;
    const xGoals = parseFloat(r[c.xGoals ?? 8]) || 0;
    const goals = parseFloat(r[c.goals ?? 9]) || 0;
    const ongoal = parseFloat(r[c.ongoal]) || 0;
    if (!name || !team || gp <= 0) continue;

    const svPct = ongoal > 0 ? (ongoal - goals) / ongoal : 0.905;
    const iceHours = Math.max(0.1, iceSec / 3600);
    const xgaPer60 = xGoals / iceHours;
    const shotsAgainstPerGame = ongoal / gp;
    const tier: NhlGoalieRate['tier'] =
      svPct >= 0.916 ? 'elite' :
      svPct >= 0.908 ? 'above_average' :
      svPct <= 0.899 ? 'below_average' : 'average';

    const rate: NhlGoalieRate = {
      goalieName: name,
      team,
      games: gp,
      savePct: svPct,
      xgaPer60,
      shotsAgainstPerGame,
      tier
    };

    const nk = normalizeName(name);
    if (nk) goalie2026ByName.set(nk, rate);
    const cur = starterCandidate.get(team);
    if (!cur || rate.games > cur.games) {
      starterCandidate.set(team, rate);
    }
  }

  for (const [team, rate] of starterCandidate.entries()) {
    goalie2026ByTeam.set(team, rate);
  }
}

export function parseNhl2026GbgGoalies(csv: string): void {
  const { header, rows } = parseSimpleCsv(csv);
  if (!rows.length) return;
  const c = colIndex(header);
  const sitIdx = c.situation ?? 9;

  const grouped = new Map<string, { id: number; name: string; team: string; date: number; og: number; ga: number }[]>();
  for (const r of rows) {
    if (r[sitIdx] !== 'all') continue;
    const pid = parseInt(r[c.playerId ?? 0], 10) || 0;
    const name = r[c.name ?? 1] || '';
    const team = normalizeTeam(r[c.playerTeam ?? 4] || '');
    const date = parseInt(r[c.gameDate ?? 7], 10) || 0;
    const ga = parseFloat(r[c.goals]) || 0;
    const og = parseFloat(r[c.ongoal]) || 0;
    const nk = normalizeName(name);
    if (!nk) continue;
    const arr = grouped.get(nk) || [];
    arr.push({ id: pid, name, team, date, og, ga });
    grouped.set(nk, arr);
  }

  for (const [nk, list] of grouped.entries()) {
    list.sort((a, b) => b.date - a.date);
    const l5 = list.slice(0, 5);
    const totalOg = l5.reduce((s, x) => s + x.og, 0);
    const totalGa = l5.reduce((s, x) => s + x.ga, 0);
    goalie2026GbgByName.set(nk, {
      playerId: list[0].id,
      name: list[0].name,
      team: list[0].team,
      recentSavePctL5: totalOg > 0 ? (totalOg - totalGa) / totalOg : null,
      recentGames: l5.length,
      lastGameDate: list[0]?.date ?? null
    });
  }
}

export function parseNhl2026LinesSeason(csv: string): void {
  const { header, rows } = parseSimpleCsv(csv);
  if (!rows.length) return;
  const c = colIndex(header);
  for (const r of rows) {
    const team = normalizeTeam(r[c.team ?? 3] || '');
    if (!team) continue;
    const combo: Nhl2026LineCombo = {
      lineId: r[c.lineId ?? 0] || '',
      name: r[c.name ?? 2] || '',
      team,
      position: r[c.position ?? 4] || '',
      situation: r[c.situation ?? 5] || '',
      gamesPlayed: parseInt(r[c.games_played ?? 6], 10) || 0,
      icetime: parseFloat(r[c.icetime ?? 7]) || 0,
      iceTimeRank: parseFloat(r[c.iceTimeRank ?? 8]) || 99,
      xGoalsPct: parseFloat(r[c.xGoalsPercentage ?? 9]) || 0.5
    };
    const arr = lines2026ByTeam.get(team) || [];
    arr.push(combo);
    lines2026ByTeam.set(team, arr);
  }
}

export function parseNhl2026GbgSogForm(csv: string): void {
  const { header, rows } = parseSimpleCsv(csv);
  if (!rows.length) return;
  const c = colIndex(header);
  const sitIdx = c.situation ?? 8;

  const grouped = new Map<number, {
    playerId: number; name: string; team: string;
    games: { gameDate: number; gameId: number; sog: number; pts: number }[];
  }>();

  for (const r of rows) {
    if (r[sitIdx] && r[sitIdx] !== 'all') continue;
    const pid = parseInt(r[c.playerId ?? 0], 10);
    if (!Number.isFinite(pid)) continue;
    const name = r[c.name ?? 1] || '';
    const team = normalizeTeam(r[c.playerTeam ?? 4] || '');
    const gameId = parseInt(r[c.gameId ?? 2], 10) || 0;
    const gameDate = parseInt(r[c.gameDate ?? 6], 10) || 0;
    const sog = parseFloat(r[c.I_F_shotsOnGoal ?? 10]);
    const pts = parseFloat(r[c.I_F_points ?? 11]);
    if (!Number.isFinite(sog) && !Number.isFinite(pts)) continue;

    const entry = grouped.get(pid) || { playerId: pid, name, team, games: [] };
    entry.games.push({
      gameDate,
      gameId,
      sog: Number.isFinite(sog) ? sog : 0,
      pts: Number.isFinite(pts) ? pts : 0
    });
    grouped.set(pid, entry);
  }

  for (const rec of grouped.values()) {
    // Most recent game first!
    rec.games.sort((a, b) => (b.gameDate - a.gameDate) || (b.gameId - a.gameId));
    const form: Nhl2026SkaterForm = {
      playerId: rec.playerId,
      name: rec.name,
      team: rec.team,
      recentShots: rec.games.map(g => g.sog),
      recentPoints: rec.games.map(g => g.pts),
      gameDates: rec.games.map(g => g.gameDate)
    };
    skaterFormById.set(rec.playerId, form);
    const nk = normalizeName(rec.name);
    if (nk) skaterFormByName.set(nk, form);
  }
}

export function loadNhl2026PriorsSync(): boolean {
  if (typeof window !== 'undefined') return false;
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      let fs: any = null;
      let path: any = null;
      if (typeof (process as any).getBuiltinModule === 'function') {
        fs = (process as any).getBuiltinModule('fs');
        path = (process as any).getBuiltinModule('path');
      } else {
        const req = (eval)('require');
        fs = req('fs');
        path = req('path');
      }
      if (!fs || !path) return false;

      const readData = (filename: string): string | null => {
        for (const dir of ['public/data', 'public/fixtures', 'src/model/fixtures']) {
          const p = path.resolve(process.cwd(), dir, filename);
          try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch { /* ignore */ }
        }
        return null;
      };

      const sk = readData('nhl_2026_skaters_season.csv');
      if (sk) parseNhl2026SkatersSeason(sk);
      const gl = readData('nhl_2026_goalies_season.csv');
      if (gl) parseNhl2026GoaliesSeason(gl);
      const ln = readData('nhl_2026_lines_season.csv');
      if (ln) parseNhl2026LinesSeason(ln);
      const gbg = readData('nhl_2026_gbg_sog_form.csv');
      if (gbg) parseNhl2026GbgSogForm(gbg);
      const glGbg = readData('nhl_2026_gbg_goalies.csv');
      if (glGbg) parseNhl2026GbgGoalies(glGbg);

      loaded = true;
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

loadNhl2026PriorsSync();

export async function loadNhl2026PriorsClient(): Promise<boolean> {
  if (typeof window === 'undefined') return loaded;
  if (loaded) return true;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    try {
      const [skRes, glRes, lnRes, gbgRes, glGbgRes] = await Promise.all([
        fetch('/data/nhl_2026_skaters_season.csv').catch(() => null),
        fetch('/data/nhl_2026_goalies_season.csv').catch(() => null),
        fetch('/data/nhl_2026_lines_season.csv').catch(() => null),
        fetch('/data/nhl_2026_gbg_sog_form.csv').catch(() => null),
        fetch('/data/nhl_2026_gbg_goalies.csv').catch(() => null)
      ]);
      if (skRes?.ok) parseNhl2026SkatersSeason(await skRes.text());
      if (glRes?.ok) parseNhl2026GoaliesSeason(await glRes.text());
      if (lnRes?.ok) parseNhl2026LinesSeason(await lnRes.text());
      if (gbgRes?.ok) parseNhl2026GbgSogForm(await gbgRes.text());
      if (glGbgRes?.ok) parseNhl2026GbgGoalies(await glGbgRes.text());
      loaded = true;
      return true;
    } catch (e) {
      console.warn('[nhl_2026_priors] Client load failed:', e);
      return false;
    }
  })();

  return clientPromise;
}

export function isNhl2026PriorsLoaded(): boolean {
  return loaded;
}

export function getNhl2026SkaterForm(playerId?: number, name?: string): Nhl2026SkaterForm | null {
  if (!loaded) loadNhl2026PriorsSync();
  if (playerId != null && skaterFormById.has(playerId)) return skaterFormById.get(playerId)!;
  if (name) {
    const nk = normalizeName(name);
    if (skaterFormByName.has(nk)) return skaterFormByName.get(nk)!;
  }
  return null;
}

export function getNhl2026SkaterPrior(playerId?: number, name?: string): Nhl2026SkaterPrior | null {
  if (!loaded) loadNhl2026PriorsSync();
  if (playerId != null && skaterById.has(playerId)) return skaterById.get(playerId)!;
  if (name) {
    const nk = normalizeName(name);
    if (skaterByName.has(nk)) return skaterByName.get(nk)!;
  }
  return null;
}

export function getNhl2026GoalieForTeam(team: string): NhlGoalieRate | undefined {
  if (!loaded) loadNhl2026PriorsSync();
  return goalie2026ByTeam.get(normalizeTeam(team));
}

export function getNhl2026GoalieGbg(name: string): Nhl2026GoalieGbgSummary | undefined {
  if (!loaded) loadNhl2026PriorsSync();
  return goalie2026GbgByName.get(normalizeName(name));
}

export function getNhl2026PpForPlayer(name: string): NhlPpUsage | undefined {
  if (!loaded) loadNhl2026PriorsSync();
  return pp2026ByPlayer.get(normalizeName(name));
}

export function getNhl2026EsForPlayer(name: string): NhlEsUsage | undefined {
  if (!loaded) loadNhl2026PriorsSync();
  return es2026ByPlayer.get(normalizeName(name));
}

export function getNhl2026ShotQualityForPlayer(name: string): NhlShotQuality | undefined {
  if (!loaded) loadNhl2026PriorsSync();
  return sq2026ByPlayer.get(normalizeName(name));
}

export function getNhl2026TeamLines(team: string): Nhl2026LineCombo[] {
  if (!loaded) loadNhl2026PriorsSync();
  return lines2026ByTeam.get(normalizeTeam(team)) || [];
}

/**
 * Enrich an NHL API skater snapshot with the 2026 MoneyPuck current-season layer:
 *  - Fills recentShots / recentPoints from nhl_2026_gbg_sog_form.csv when API game logs are empty/missing.
 *  - Keeps missing logs as [] if player is absent from both API and 2026 GBG CSV (never invents 0%).
 *  - Supplementation of season counts if live snapshot has gp === 0 and 2026 prior exists.
 */
export function enrichNhlSkaterWith2026Priors(p: NhlPlayerSnapshot): NhlPlayerSnapshot {
  const form = getNhl2026SkaterForm(p.playerId, p.name);
  const seasonPrior = getNhl2026SkaterPrior(p.playerId, p.name);

  let next = p;
  if (form) {
    const hasShots = Array.isArray(p.recentShots) && p.recentShots.length > 0;
    const hasPts = Array.isArray(p.recentPoints) && p.recentPoints.length > 0;
    if (!hasShots || !hasPts) {
      next = {
        ...next,
        recentShots: hasShots ? p.recentShots : form.recentShots,
        recentPoints: hasPts ? p.recentPoints : form.recentPoints
      };
    }
  }

  if (seasonPrior && next.gp === 0 && seasonPrior.gp > 0) {
    next = {
      ...next,
      gp: seasonPrior.gp,
      shots: seasonPrior.shotsOnGoal,
      points: seasonPrior.points,
      toiAvg: next.toiAvg > 0 ? next.toiAvg : seasonPrior.toiAvg
    };
  }

  return next;
}

export function getNhl2026Counts(): { skaters: number; forms: number; goalies: number; lines: number } {
  return {
    skaters: skaterById.size,
    forms: skaterFormById.size,
    goalies: goalie2026ByName.size,
    lines: lines2026ByTeam.size
  };
}
