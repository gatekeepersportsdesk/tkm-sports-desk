/**
 * NHL Context Priors & Adjustment Factor Engine
 *
 * Implements context adjustments for NHL player props (shots on goal + points) using:
 * 1. nhl_goalie_rates.csv — opposing goalie quality (save %, xGA, shots against)
 * 2. nhl_team_defense.csv — team shot and goal suppression
 * 3. nhl_pp_usage.csv — power-play TOI and production
 * 4. nhl_es_usage.csv — even-strength TOI and production
 * 5. nhl_shot_quality.csv — shot danger and volume
 *
 * Rules:
 *  - Existing MoneyPuck skater season prior and shrinkage logic remain completely unchanged.
 *  - Factors adjust expected shots and points contextually and are surfaced in player views.
 *  - Missing players/teams fall back gracefully with 1.0 (neutral) factor.
 */

import {
  getNhl2026GoalieForTeam,
  getNhl2026PpForPlayer,
  getNhl2026EsForPlayer,
  getNhl2026ShotQualityForPlayer
} from './nhl_2026_priors';

export interface NhlGoalieRate {
  goalieName: string;
  team: string;
  games: number;
  savePct: number;
  xgaPer60: number;
  shotsAgainstPerGame: number;
  tier: 'elite' | 'above_average' | 'average' | 'below_average';
}

export interface NhlTeamDefense {
  team: string;
  games: number;
  shotsAgainstPer60: number;
  xgaPer60: number;
  highDangerAgainstPer60: number;
  suppressionFactor: number; // < 1.0 = suppresses, > 1.0 = yields more
}

export interface NhlPpUsage {
  playerName: string;
  team: string;
  ppUnit: 'PP1' | 'PP2' | 'NONE';
  ppToiPerGame: number;
  ppShotsPer60: number;
  ppPointsPer60: number;
}

export interface NhlEsUsage {
  playerName: string;
  team: string;
  esLine: string;
  esToiPerGame: number;
  esRank: number; // 1 = top line / pair, 2 = second line / pair, 3+ = depth
}

export interface NhlShotQuality {
  playerName: string;
  team: string;
  highDangerShotsPer60: number;
  rushShotsPer60: number;
  ixgPerShot: number;
}

export interface NhlContextAdjustment {
  label: string;
  impactPct: number; // e.g. -8 for -8%, +12 for +12%
}

export interface NhlContextResult {
  totalFactor: number;
  adjustments: NhlContextAdjustment[];
  summary: string;
}

// In-memory lookup tables
const goalieByTeam = new Map<string, NhlGoalieRate>();
const goalieByName = new Map<string, NhlGoalieRate>();
const defenseByTeam = new Map<string, NhlTeamDefense>();
const ppByPlayer = new Map<string, NhlPpUsage>();
const esByPlayer = new Map<string, NhlEsUsage>();
const shotQualityByPlayer = new Map<string, NhlShotQuality>();

let initialized = false;

export function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[.'’\-]/g, '')
    .replace(/\s+(jr|sr|iii|ii|iv|v)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTeam(team: string): string {
  return (team || '').toUpperCase().trim();
}

function parseCsvLines(csv: string): string[][] {
  return csv
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
    .map(l => l.split(',').map(c => c.trim().replace(/^["']|["']$/g, '')));
}

export function parseGoalieRates(csv: string): void {
  const rows = parseCsvLines(csv);
  if (rows.length < 2) return;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 5) continue;
    const goalie: NhlGoalieRate = {
      goalieName: r[0],
      team: normalizeTeam(r[1]),
      games: parseInt(r[2], 10) || 0,
      savePct: parseFloat(r[3]) || 0.905,
      xgaPer60: parseFloat(r[4]) || 2.70,
      shotsAgainstPerGame: parseFloat(r[5]) || 30.0,
      tier: (r[6] as any) || 'average'
    };
    goalieByName.set(normalizeName(goalie.goalieName), goalie);
    goalieByTeam.set(goalie.team, goalie);
  }
}

export function parseTeamDefense(csv: string): void {
  const rows = parseCsvLines(csv);
  if (rows.length < 2) return;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 4) continue;
    const def: NhlTeamDefense = {
      team: normalizeTeam(r[0]),
      games: parseInt(r[1], 10) || 0,
      shotsAgainstPer60: parseFloat(r[2]) || 30.0,
      xgaPer60: parseFloat(r[3]) || 2.65,
      highDangerAgainstPer60: parseFloat(r[4]) || 11.0,
      suppressionFactor: parseFloat(r[5]) || 1.0
    };
    defenseByTeam.set(def.team, def);
  }
}

export function parsePpUsage(csv: string): void {
  const rows = parseCsvLines(csv);
  if (rows.length < 2) return;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 4) continue;
    const pp: NhlPpUsage = {
      playerName: r[0],
      team: normalizeTeam(r[1]),
      ppUnit: (r[2] as any) || 'NONE',
      ppToiPerGame: parseFloat(r[3]) || 0,
      ppShotsPer60: parseFloat(r[4]) || 0,
      ppPointsPer60: parseFloat(r[5]) || 0
    };
    ppByPlayer.set(normalizeName(pp.playerName), pp);
  }
}

export function parseEsUsage(csv: string): void {
  const rows = parseCsvLines(csv);
  if (rows.length < 2) return;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 4) continue;
    const es: NhlEsUsage = {
      playerName: r[0],
      team: normalizeTeam(r[1]),
      esLine: r[2] || 'Line 2',
      esToiPerGame: parseFloat(r[3]) || 14.0,
      esRank: parseInt(r[4], 10) || 2
    };
    esByPlayer.set(normalizeName(es.playerName), es);
  }
}

export function parseShotQuality(csv: string): void {
  const rows = parseCsvLines(csv);
  if (rows.length < 2) return;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 4) continue;
    const sq: NhlShotQuality = {
      playerName: r[0],
      team: normalizeTeam(r[1]),
      highDangerShotsPer60: parseFloat(r[2]) || 3.0,
      rushShotsPer60: parseFloat(r[3]) || 2.0,
      ixgPerShot: parseFloat(r[4]) || 0.11
    };
    shotQualityByPlayer.set(normalizeName(sq.playerName), sq);
  }
}

/**
 * Node.js filesystem loader (synchronous).
 */
export function loadNhlContextPriorsSync(): boolean {
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

      const findAndRead = (filename: string): string | null => {
        const candidates = [
          path.resolve(process.cwd(), 'src/model/fixtures', filename),
          path.resolve(process.cwd(), 'public/data', filename),
          path.resolve(process.cwd(), 'public/fixtures', filename)
        ];
        for (const c of candidates) {
          try {
            if (fs.existsSync(c)) return fs.readFileSync(c, 'utf8');
          } catch { /* ignore */ }
        }
        return null;
      };

      const g = findAndRead('nhl_goalie_rates.csv');
      if (g) parseGoalieRates(g);
      const d = findAndRead('nhl_team_defense.csv');
      if (d) parseTeamDefense(d);
      const pp = findAndRead('nhl_pp_usage.csv');
      if (pp) parsePpUsage(pp);
      const es = findAndRead('nhl_es_usage.csv');
      if (es) parseEsUsage(es);
      const sq = findAndRead('nhl_shot_quality.csv');
      if (sq) parseShotQuality(sq);

      initialized = true;
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

// Auto-run synchronous loader in Node
loadNhlContextPriorsSync();

/**
 * Browser asynchronous loader that fetches context CSVs.
 */
export async function loadNhlContextPriorsClient(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const [gRes, dRes, ppRes, esRes, sqRes] = await Promise.all([
      fetch('/data/nhl_goalie_rates.csv').catch(() => null),
      fetch('/data/nhl_team_defense.csv').catch(() => null),
      fetch('/data/nhl_pp_usage.csv').catch(() => null),
      fetch('/data/nhl_es_usage.csv').catch(() => null),
      fetch('/data/nhl_shot_quality.csv').catch(() => null)
    ]);

    if (gRes && gRes.ok) parseGoalieRates(await gRes.text());
    if (dRes && dRes.ok) parseTeamDefense(await dRes.text());
    if (ppRes && ppRes.ok) parsePpUsage(await ppRes.text());
    if (esRes && esRes.ok) parseEsUsage(await esRes.text());
    if (sqRes && sqRes.ok) parseShotQuality(await sqRes.text());

    initialized = true;
  } catch (err) {
    console.warn('[nhl_context_priors] Client load failed, using fallback:', err);
  }
}

/**
 * Computes context adjustments for a given skater facing an opponent.
 */
export function getNhlContextAdjustments(
  skaterName: string,
  skaterTeam: string,
  oppTeam: string,
  pos: 'F' | 'D' = 'F'
): NhlContextResult {
  if (!initialized) loadNhlContextPriorsSync();

  const normSkater = normalizeName(skaterName);
  const normOpp = normalizeTeam(oppTeam);
  const adjustments: NhlContextAdjustment[] = [];
  let factor = 1.0;

  // 1. Opposing Goalie Quality (2026 league-wide starter layer, fallback to base table)
  const oppGoalie = getNhl2026GoalieForTeam(normOpp) ?? goalieByTeam.get(normOpp);
  if (oppGoalie) {
    if (oppGoalie.tier === 'elite' || oppGoalie.savePct >= 0.915) {
      factor *= 0.92;
      adjustments.push({ label: 'Opp goalie: strong −8%', impactPct: -8 });
    } else if (oppGoalie.tier === 'above_average' || oppGoalie.savePct >= 0.910) {
      factor *= 0.96;
      adjustments.push({ label: 'Opp goalie: above avg −4%', impactPct: -4 });
    } else if (oppGoalie.tier === 'below_average' || oppGoalie.savePct <= 0.899) {
      factor *= 1.08;
      adjustments.push({ label: 'Opp goalie: weak +8%', impactPct: 8 });
    }
  }

  // 2. Team Defense Suppression
  const oppDef = defenseByTeam.get(normOpp);
  if (oppDef && oppDef.suppressionFactor) {
    const sf = oppDef.suppressionFactor;
    if (sf < 0.96) {
      const drop = Math.round((1 - sf) * 100);
      factor *= sf;
      adjustments.push({ label: `Opp defense: stingy −${drop}%`, impactPct: -drop });
    } else if (sf > 1.04) {
      const boost = Math.round((sf - 1) * 100);
      factor *= sf;
      adjustments.push({ label: `Opp defense: soft +${boost}%`, impactPct: boost });
    }
  }

  // 3. Power-Play Usage (2026 skaters layer, fallback to static table)
  const pp = getNhl2026PpForPlayer(skaterName) ?? ppByPlayer.get(normSkater);
  if (pp) {
    if (pp.ppUnit === 'PP1' || pp.ppToiPerGame >= 3.0) {
      factor *= 1.12;
      adjustments.push({ label: 'PP1 +12%', impactPct: 12 });
    } else if (pp.ppUnit === 'PP2' || pp.ppToiPerGame >= 1.5) {
      factor *= 1.03;
      adjustments.push({ label: 'PP2 +3%', impactPct: 3 });
    } else if (pp.ppToiPerGame < 0.5) {
      factor *= 0.95;
      adjustments.push({ label: 'No PP −5%', impactPct: -5 });
    }
  }

  // 4. Even-Strength Usage (2026 skaters layer, fallback to static table)
  const es = getNhl2026EsForPlayer(skaterName) ?? esByPlayer.get(normSkater);
  if (es) {
    if (es.esRank === 1 || es.esToiPerGame >= (pos === 'D' ? 19.0 : 15.5)) {
      factor *= 1.05;
      adjustments.push({ label: pos === 'D' ? 'Top pair +5%' : 'Top line +5%', impactPct: 5 });
    } else if (es.esToiPerGame <= 12.0) {
      factor *= 0.94;
      adjustments.push({ label: 'Depth line −6%', impactPct: -6 });
    }
  }

  // 5. Shot Quality (2026 skaters layer, fallback to static table)
  const sq = getNhl2026ShotQualityForPlayer(skaterName) ?? shotQualityByPlayer.get(normSkater);
  if (sq) {
    if (sq.highDangerShotsPer60 >= 4.0 || sq.ixgPerShot >= 0.135) {
      factor *= 1.04;
      adjustments.push({ label: 'High danger +4%', impactPct: 4 });
    }
  }

  // Clamp total context adjustment safely within [0.75, 1.30]
  const clampedFactor = Math.min(1.30, Math.max(0.75, factor));
  const summary = adjustments.map(a => a.label).join(' · ');

  return {
    totalFactor: clampedFactor,
    adjustments,
    summary
  };
}
