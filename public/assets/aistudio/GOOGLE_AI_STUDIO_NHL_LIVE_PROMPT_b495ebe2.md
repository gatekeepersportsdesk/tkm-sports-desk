# Google AI Studio — NHL desk: real player names + live data

## Bug
The NHL SOG board shows fake roles like **"SJ Top Center"**, **"SJ Top Winger"**, **"1st Pair D"** instead of people (Macklin Celebrini, Will Smith, etc.).

Root cause: `getSkatersForNhlTeam()` invented placeholders for any team not in the tiny `NHL_SEED_PLAYERS` list.

## Required behavior
1. **Every row is a real NHL player name** (never "Top Center / Top Winger / Offensive D").
2. Pull **live roster + season SOG rates** from official NHL API for every team on today's slate.
3. Schedule uses NHL tricodes: **SJS, LAK, TBL, NJD, WSH, VGK, UTA** (not ESPN's SJ/LA/TB/NJ).
4. If roster fetch fails for a team, show empty + error — **do not** invent role placeholders.
5. Slip / screenshot import still adds any name on the book even if not on the morning board.

## Endpoints already added in this project (server.ts)
```
GET /api/nhl/schedule?date=YYYY-MM-DD
  → { games: [{ gameId, startTimeUtc, awayTeam, homeTeam, venue }] }
  source: https://api-web.nhle.com/v1/schedule/{date}

GET /api/nhl/skaters/:team
  → { team, skaters: [{ playerId, name, team, pos, mu0, toiAvg, recentShots, gamesPlayed, seasonShots }] }
  sources:
    roster: https://api-web.nhle.com/v1/roster/{TEAM}/20262027
    stats:  https://api-web.nhle.com/v1/club-stats/{TEAM}/20262027/2
  mu0 = season shots / gamesPlayed (clamped), real full names
```

Client helpers: `src/lib/live_nhl.ts` (`fetchNhlSchedule`, `loadNhlSkatersForGames`, `normalizeNhlTeam`).

## What you must verify / finish
1. On NHL tab load: fetch schedule for selected date → for each team call `/api/nhl/skaters/:team` → board shows **Celebrini, Smith, Toffoli…** not roles.
2. Matchup chips use NHL tricodes (SJS @ MTL, not SJ @ MTL).
3. Status text: "live rosters: N skaters".
4. Ban any code path that sets `name = \`${team} Top Center\``.
5. Keep negative-binomial SOG math; only replace the name/roster source.
6. CORS: browser must call **your** `/api/nhl/*` proxies, not api-web.nhle.com directly.

## Acceptance
- SJS @ MTL shows **Macklin Celebrini**, **Will Smith**, **Tyler Toffoli**, etc.
- Zero rows named "Top Center", "Top Winger", "2nd Line W", "1st Pair D", "Offensive D".
- Refresh still loads live names for every team on the slate.
