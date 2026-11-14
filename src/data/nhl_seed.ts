import { NhlPlayerSnapshot } from '../types/nhl';

/**
 * There is deliberately NO hand-typed roster here any more. The old seed held
 * 2024 rosters (players who have since changed teams), hand-typed shot rates
 * and pre-filled odds, so an offline desk showed stale names with confident
 * numbers. If the live feed is down the board is empty and says so.
 *
 * The one thing this file still does: build an ESTIMATED skater for a player a
 * screenshot priced but the live roster did not contain. It has no games, so
 * the engine prices it from the position prior only and the gate refuses to
 * qualify it. The line is NEVER used to infer the rate (that would price the
 * book's number against itself).
 */
export function buildEstimatedNhlSkater(
  name: string,
  team: string,
  pos: 'F' | 'D' = 'F'
): NhlPlayerSnapshot {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return {
    playerId: 9300000 + (Math.abs(hash) % 100000),
    name,
    team,
    pos,
    toiAvg: pos === 'D' ? 19.5 : 16.0,
    gp: 0,
    shots: 0,
    points: null,
    priorGp: 0,
    priorShots: 0,
    priorPoints: null,
    recentShots: [],
    recentPoints: [],
    availability: 'UNKNOWN',
    inputsSource: 'ESTIMATED'
  };
}
