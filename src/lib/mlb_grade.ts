/**
 * Real MLB grading from official box scores (no simulation).
 * A row is graded only when its game is Final. A batter with no plate
 * appearance (or absent from the box) is VOID, matching book rules for a
 * non-starter; a started batter with 0 hits is a loss.
 */
import { MlbLedgerRow } from '../types/mlb';
import { hitsNeeded } from '../model/mlb_engine';

export interface MlbBoxResult {
  final: boolean;
  voided: boolean; // postponed / cancelled
  players: Record<string, { hits: number; atBats: number; pa: number }>;
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : 0;
};

export function parseBoxscore(box: any, sched: any): MlbBoxResult {
  const g = sched?.dates?.[0]?.games?.[0];
  const abstract = g?.status?.abstractGameState;
  const detailed = String(g?.status?.detailedState || '');
  const voided = /postponed|cancel/i.test(detailed);
  const players: MlbBoxResult['players'] = {};
  for (const side of ['away', 'home'] as const) {
    const ps = box?.teams?.[side]?.players || {};
    for (const key of Object.keys(ps)) {
      const p = ps[key];
      const id = p?.person?.id ?? (key.startsWith('ID') ? Number(key.slice(2)) : undefined);
      const bat = p?.stats?.batting;
      if (!id || !bat || typeof bat !== 'object') continue;
      const hits = n(bat.hits), atBats = n(bat.atBats);
      const pa = bat.plateAppearances !== undefined ? n(bat.plateAppearances) : atBats + n(bat.baseOnBalls) + n(bat.hitByPitch) + n(bat.sacFlies) + n(bat.sacBunts);
      players[String(id)] = { hits, atBats, pa };
    }
  }
  return { final: abstract === 'Final' && !voided, voided, players };
}

export function gradeLedger(
  rows: MlbLedgerRow[],
  results: Record<string, MlbBoxResult | undefined>
): { rows: MlbLedgerRow[]; graded: number; pending: number; voided: number } {
  let graded = 0, pending = 0, voided = 0;
  const out = rows.map(r => {
    if (r.hit !== null || r.void || r.demo) return r;
    const res = results[String(r.gamePk)];
    if (!res) { pending++; return r; }
    if (res.voided) {
      voided++;
      return {
        ...r,
        void: true,
        result: 'POSTPONED',
        predictionHit: null,
        analysisReason: 'VOID: Game postponed or cancelled.'
      };
    }
    if (!res.final) { pending++; return r; }
    const line = r.line ?? 0.5;
    const need = hitsNeeded(line);
    if (need === null) { pending++; return r; }
    const p = res.players[String(r.id)];
    if (!p || p.pa <= 0) {
      voided++;
      return {
        ...r,
        void: true,
        result: 'DNP',
        predictionHit: null,
        analysisReason: `${r.name} did not record a plate appearance (DNP / Pinch hit only).`
      };
    }
    graded++;
    const hit = p.hits >= need ? 1 : 0;
    const modelLean: 'OVER' | 'UNDER' = r.modelLean ?? (r.call === 'PLAY' || r.modelP >= 0.5 ? 'OVER' : 'UNDER');
    const predictionHit = (hit === 1 && modelLean === 'OVER') || (hit === 0 && modelLean === 'UNDER');
    let analysisReason = '';
    if (predictionHit) {
      if (modelLean === 'OVER') {
        analysisReason = `WON (OVER): Projected OVER ${line} hits (${(r.modelP * 100).toFixed(0)}% P). Actual was ${p.hits}-for-${p.atBats} with ${p.pa} PA. Solid contact against starter.`;
      } else {
        analysisReason = `WON (UNDER): Projected UNDER ${line} hits (${((1 - r.modelP) * 100).toFixed(0)}% P). Actual was ${p.hits}-for-${p.atBats} with ${p.pa} PA. Starter held batter to weak contact.`;
      }
    } else {
      if (modelLean === 'OVER') {
        analysisReason = `LOST (OVER): Projected OVER ${line} hits (${(r.modelP * 100).toFixed(0)}% P). Actual was ${p.hits}-for-${p.atBats} in ${p.pa} PA. Suppressed by opposing pitching and strikeout rate.`;
      } else {
        analysisReason = `LOST (UNDER): Projected UNDER ${line} hits. Actual was ${p.hits}-for-${p.atBats}. Batter outperformed baseline with multi-hit or clean ball in play.`;
      }
    }
    return {
      ...r,
      hit,
      result: `${p.hits}-for-${p.atBats}`,
      modelLean,
      predictionHit,
      analysisReason
    };
  });
  return { rows: out, graded, pending, voided };
}

export async function fetchBoxResults(gamePks: number[]): Promise<Record<string, MlbBoxResult> | null> {
  if (!gamePks.length) return {};
  try {
    const res = await fetch(`/api/mlb/boxscores?gamePks=${gamePks.join(',')}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const out: Record<string, MlbBoxResult> = {};
    for (const [pk, v] of Object.entries<any>(data.games || {})) {
      if (v?.box && v?.sched) out[pk] = parseBoxscore(v.box, v.sched);
    }
    return out;
  } catch (e) {
    console.warn('MLB box fetch failed', e);
    return null;
  }
}
