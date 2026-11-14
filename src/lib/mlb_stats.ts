/**
 * MLB live inputs. Pure parsers over statsapi.mlb.com payloads (so they can be
 * tested against recorded/mocked JSON) + the schedule -> matchup mapper.
 *
 * Rules:
 *  - never fabricate a stat. A field we cannot parse stays undefined, the engine
 *    reports inputsReal=false, and the row is EST (cannot be PLAY).
 *  - batting order comes from the official lineup card only; no projected lineups.
 *  - the API payload shapes below follow statsapi's documented stats endpoint
 *    (stats=season,gameLog,statSplits). They are parsed defensively; if MLB
 *    changes a field the row degrades to EST instead of silently using a default.
 */
import { MlbBatterInput, MlbGameMatchup, MlbPitcherInput } from '../types/mlb';
import { MLB_PARK_FACTORS } from '../model/mlb_engine';

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};

/** "5.1" innings-pitched notation (thirds) -> 5.333 */
export function ipToNumber(ip: unknown): number | undefined {
  if (ip === null || ip === undefined || ip === '') return undefined;
  const s = String(ip);
  const [w, f = '0'] = s.split('.');
  const whole = parseInt(w, 10);
  const frac = parseInt(f, 10);
  if (!Number.isFinite(whole) || !Number.isFinite(frac) || frac > 2) return undefined;
  return whole + frac / 3;
}

interface StatBlock { type?: { displayName?: string }; group?: { displayName?: string }; splits?: any[] }
const blocks = (j: any): StatBlock[] => (Array.isArray(j?.stats) ? j.stats : []);
const findBlock = (j: any, type: string): StatBlock | undefined =>
  blocks(j).find(b => (b.type?.displayName || '').toLowerCase() === type.toLowerCase());

export interface RawPlayerPayload {
  /** /people/{id} */
  person?: any;
  /** /people/{id}/stats?stats=season,gameLog,statSplits&group=... */
  stats?: any;
}

export interface BatterReal {
  hand?: string;
  seasonBa?: number;
  seasonPa?: number;
  seasonAb?: number;
  bbPct?: number;
  recentBa?: number;
  recentAb?: number;
  recentReal: boolean;
  vsLBa?: number; vsLAb?: number; vsRBa?: number; vsRAb?: number;
}

/** last N games from a game log (by date), summed hits/AB */
function recentFromGameLog(splits: any[], games = 15): { ba?: number; ab: number } {
  const rows = splits
    .map(s => ({ date: String(s.date || ''), h: num(s.stat?.hits), ab: num(s.stat?.atBats) }))
    .filter(r => r.date && r.h !== undefined && r.ab !== undefined)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, games);
  const ab = rows.reduce((s, r) => s + (r.ab as number), 0);
  const h = rows.reduce((s, r) => s + (r.h as number), 0);
  return { ba: ab > 0 ? h / ab : undefined, ab };
}

export function parseBatter(raw: RawPlayerPayload): BatterReal {
  const out: BatterReal = { recentReal: false };
  const side = raw.person?.people?.[0]?.batSide?.code ?? raw.person?.batSide?.code;
  if (side === 'L' || side === 'R' || side === 'S') out.hand = side;

  const season = findBlock(raw.stats, 'season')?.splits?.[0]?.stat;
  if (season) {
    const ab = num(season.atBats);
    const pa = num(season.plateAppearances);
    const hits = num(season.hits);
    out.seasonAb = ab;
    out.seasonPa = pa;
    // compute BA from counting stats; the pre-formatted ".285" string is only a fallback
    out.seasonBa = ab && ab > 0 && hits !== undefined ? hits / ab : num(season.avg);
    const bb = num(season.baseOnBalls);
    if (pa && pa > 0 && bb !== undefined) out.bbPct = bb / pa;
  }

  const log = findBlock(raw.stats, 'gameLog')?.splits;
  if (Array.isArray(log) && log.length) {
    const r = recentFromGameLog(log);
    out.recentBa = r.ba;
    out.recentAb = r.ab;
    out.recentReal = r.ab >= 20;
  }

  const splits = findBlock(raw.stats, 'statSplits')?.splits;
  if (Array.isArray(splits)) {
    for (const sp of splits) {
      const code = String(sp.split?.code || '').toLowerCase();
      const ab = num(sp.stat?.atBats);
      const h = num(sp.stat?.hits);
      const ba = ab && ab > 0 && h !== undefined ? h / ab : num(sp.stat?.avg);
      if (code === 'vl') { out.vsLBa = ba; out.vsLAb = ab; }
      if (code === 'vr') { out.vsRBa = ba; out.vsRAb = ab; }
    }
  }
  return out;
}

export interface PitcherReal {
  hand?: string;
  kPct?: number;
  kBf?: number;
  recentIp?: number;
  starts?: number;
}

export function parsePitcher(raw: RawPlayerPayload): PitcherReal {
  const out: PitcherReal = {};
  const code = raw.person?.people?.[0]?.pitchHand?.code ?? raw.person?.pitchHand?.code;
  if (code === 'L') out.hand = 'LHP';
  else if (code === 'R') out.hand = 'RHP';

  const season = findBlock(raw.stats, 'season')?.splits?.[0]?.stat;
  if (season) {
    const bf = num(season.battersFaced);
    const so = num(season.strikeOuts);
    if (bf && bf >= 30 && so !== undefined) { out.kPct = (so / bf) * 100; out.kBf = bf; }
  }

  const log = findBlock(raw.stats, 'gameLog')?.splits;
  if (Array.isArray(log)) {
    const starts = log
      .filter(s => num(s.stat?.gamesStarted) === 1)
      .map(s => ({ date: String(s.date || ''), ip: ipToNumber(s.stat?.inningsPitched) }))
      .filter(s => s.date && s.ip !== undefined)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 5);
    out.starts = starts.length;
    if (starts.length >= 3) out.recentIp = starts.reduce((s, r) => s + (r.ip as number), 0) / starts.length;
  }
  return out;
}

export const ROUND_TYPES = new Set(['F', 'D', 'L', 'W']);
export const roundOf = (gameType?: string): string | undefined => (gameType && ROUND_TYPES.has(gameType) ? gameType : undefined);

/** statsapi schedule game -> matchup skeleton (batters carry NO stats yet). */
export function parseScheduleGame(g: any, dateStr: string): MlbGameMatchup | null {
  const away = g?.teams?.away?.team;
  const home = g?.teams?.home?.team;
  if (!g?.gamePk || !away?.abbreviation || !home?.abbreviation) return null;
  const awayCode: string = away.abbreviation;
  const homeCode: string = home.abbreviation;
  const park = MLB_PARK_FACTORS[homeCode] ?? 1.0;

  const sp = (side: any): MlbPitcherInput => ({
    id: side?.probablePitcher?.id,
    name: side?.probablePitcher?.fullName || 'TBD',
    hand: '',
    kPct: 0
  });
  const awaySp = sp(g.teams.away);
  const homeSp = sp(g.teams.home);

  const mk = (players: any[] | undefined, team: string, isHome: boolean, opp: MlbPitcherInput): MlbBatterInput[] =>
    (players || []).slice(0, 9).map((p: any, i: number) => ({
      id: p.id,
      name: p.fullName,
      team,
      slot: i + 1,
      isHome,
      hand: '',
      seasonBa: NaN, // unknown until stats are merged; engine treats NaN-free path via seasonPa
      confirmed: true,
      availability: 'ACTIVE' as const,
      inputsSource: 'ESTIMATED' as const,
      park,
      gamePk: g.gamePk,
      oppSp: opp.name,
      oppHand: opp.hand
    }));

  const aw = g.lineups?.awayPlayers;
  const hm = g.lineups?.homePlayers;
  const official = Boolean(aw?.length && hm?.length);
  const state = g.status?.detailedState || '';

  return {
    gamePk: g.gamePk,
    away: awayCode,
    home: homeCode,
    status: official ? state || 'Lineups confirmed' : 'Lineups not posted',
    live: g.status?.abstractGameState === 'Live',
    inning: g.linescore?.currentInning || 0,
    park,
    confirmed: official,
    awaySp,
    homeSp,
    batters: official ? [...mk(aw, awayCode, false, homeSp), ...mk(hm, homeCode, true, awaySp)] : [],
    gameType: g.gameType,
    date: dateStr,
    note: official ? undefined : 'Official lineup card not posted yet — nothing is priced from projected lineups.'
  };
}

export interface RawStatsBundle {
  batters: Record<string, RawPlayerPayload>;
  pitchers: Record<string, RawPlayerPayload>;
}

/** Merge real stats into a skeleton slate. Missing data stays missing (-> EST). */
export function enrichGames(games: MlbGameMatchup[], bundle: RawStatsBundle): MlbGameMatchup[] {
  const pit = (sp: MlbPitcherInput): MlbPitcherInput => {
    const raw = sp.id !== undefined ? bundle.pitchers[String(sp.id)] : undefined;
    if (!raw) return sp;
    const r = parsePitcher(raw);
    return { ...sp, hand: r.hand ?? sp.hand, kPct: r.kPct ?? 0, kBf: r.kBf, recentIp: r.recentIp };
  };
  return games.map(g => {
    const awaySp = pit(g.awaySp);
    const homeSp = pit(g.homeSp);
    const batters = g.batters.map(b => {
      const raw = bundle.batters[String(b.id)];
      const r = raw ? parseBatter(raw) : undefined;
      const opp = b.isHome ? awaySp : homeSp;
      const have = Boolean(r && r.seasonPa && r.seasonPa > 0 && r.seasonBa !== undefined);
      const merged: MlbBatterInput = {
        ...b,
        hand: r?.hand ?? b.hand,
        seasonBa: r?.seasonBa ?? NaN,
        seasonPa: r?.seasonPa,
        seasonAb: r?.seasonAb,
        bbPct: r?.bbPct,
        recentBa: r?.recentBa,
        recentAb: r?.recentAb,
        recentReal: r?.recentReal ?? false,
        vsLBa: r?.vsLBa, vsLAb: r?.vsLAb, vsRBa: r?.vsRBa, vsRAb: r?.vsRAb,
        oppSp: opp.name,
        oppHand: opp.hand
      };
      const pitcherOk = Boolean(opp.kPct && opp.recentIp && opp.hand);
      merged.inputsSource = have && merged.recentReal && merged.hand && pitcherOk ? 'REAL' : 'ESTIMATED';
      return merged;
    });
    return { ...g, awaySp, homeSp, batters };
  });
}

/** Engine wants undefined, not NaN, for "unknown". */
export function batterForEngine(b: MlbBatterInput) {
  return { ...b, seasonBa: Number.isFinite(b.seasonBa) ? b.seasonBa : undefined };
}
