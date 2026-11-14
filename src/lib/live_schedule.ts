import { MlbGameMatchup } from '../types/mlb';
import { parseScheduleGame, enrichGames, RawStatsBundle } from './mlb_stats';
import { getTodayIsoDate } from './dates';

export async function fetchLiveMlbGames(dateStr: string = getTodayIsoDate()): Promise<MlbGameMatchup[]> {
  try {
    const res = await fetch(`/api/mlb/schedule?date=${dateStr}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const skeleton = (data.games || [])
      .map((g: any) => parseScheduleGame(g, dateStr))
      .filter(Boolean) as MlbGameMatchup[];
    if (!skeleton.length) return [];

    // real stats for every posted batter and probable starter (degrades to EST on failure)
    const batters = Array.from(new Set(skeleton.flatMap(g => g.batters.map(b => b.id)))).filter(Boolean);
    const pitchers = Array.from(new Set(skeleton.flatMap(g => [g.awaySp.id, g.homeSp.id]))).filter(Boolean) as number[];
    let bundle: RawStatsBundle = { batters: {}, pitchers: {} };
    try {
      const sr = await fetch(`/api/mlb/stats?batters=${batters.join(',')}&pitchers=${pitchers.join(',')}&season=${dateStr.slice(0, 4)}`);
      if (sr.ok) {
        const j = await sr.json();
        bundle = { batters: j.batters || {}, pitchers: j.pitchers || {} };
      }
    } catch (e) {
      console.warn('MLB stats fetch failed — rows stay ESTIMATED', e);
    }
    return enrichGames(skeleton, bundle);
  } catch (err) {
    console.warn('Could not fetch the MLB schedule:', err);
    return [];
  }
}

// NHL slate comes ONLY from the official NHL API (src/lib/nhl_data.ts): ESPN event ids are not NHL game ids,
// so ESPN games could never be graded from a box score.
