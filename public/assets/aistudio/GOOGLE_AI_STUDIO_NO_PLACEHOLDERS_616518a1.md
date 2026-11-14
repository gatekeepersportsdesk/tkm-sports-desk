# Google AI Studio — BAN role placeholders across ALL sports

## Absolute rule
**Never display or invent:**
- NFL: `NE WR1`, `CHI TE1`, `Team WR2`
- NHL: `SJ Top Center`, `Top Winger`, `1st Pair D`, `Offensive D`
- MLB: `BOS Leadoff`, `NYY Cleanup`, `Two-Hole`, `Five-Hitter`

Every row must be a **real person** from a live API, or absent.

## Data sources (server proxies — avoid CORS)
| Sport | Endpoint | Upstream |
|-------|----------|----------|
| NFL WR/TE | `GET /api/nfl/receivers/:team` | ESPN team roster |
| MLB games | `GET /api/mlb/schedule?date=` | statsapi.mlb.com (0 games → empty board) |
| NHL skaters | `GET /api/nhl/skaters/:team` | api-web.nhle.com roster + club-stats |
| NHL schedule | `GET /api/nhl/schedule?date=` | api-web.nhle.com schedule |

## Code already changed in this zip
1. `getPlayersForTeam` — returns seed only, **no WR1 invent**
2. `getProjectedLineupForTeam` — empty array if team unknown, **no Leadoff invent**
3. `getSkatersForNhlTeam` — seed only, **no Top Center invent**
4. `fetchLiveMlbGames` — returns `[]` when no official games (**not** MLB_SEEDED_SLATE)
5. App starts MLB empty; always `setMlbLiveGames(mlb || [])`
6. NflDesk uses `liveRosters` from ESPN
7. `getOrCreateNflPlayer` **throws** on role-shaped names

## Finish / verify
1. On load NFL: for each team on slate call `/api/nfl/receivers/:team` → board shows Hunter Henry, Rome Odunze, etc.
2. MLB off-day: empty Hit Board + message, **not** BOS@NYY seed.
3. NHL: Celebrini / real names only.
4. Grep the project: zero matches for creating `` `${team} WR1` `` or Leadoff/Top Center as names.
5. Screenshot import still adds **book names** (real players on the slip), never roles.

## Acceptance checklist
- [ ] No `WR1`/`TE1` anywhere on NFL board
- [ ] No `Top Center`/`Top Winger` on NHL board  
- [ ] No `Leadoff`/`Cleanup` on MLB board
- [ ] No seed MLB games when official schedule count is 0
- [ ] Slip import of a real name still creates a row and scores it
