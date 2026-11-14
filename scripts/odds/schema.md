# Gatekeep odds JSON schema

Each file is a JSON **array** of objects (or `{ "lines": [ ... ] }`).

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| book | string | yes | `bet99`, `bet365`, or `other` |
| sport | string | yes | `nba` \| `nhl` \| `nfl` \| `mlb` |
| player | string | yes | Full name as on the board when possible |
| market | string | yes | See markets below (aliases accepted by writer + app) |
| line | number | yes | e.g. 21.5, 0.5 |
| over | number \| null | one side required | American odds |
| under | number \| null | one side required | American odds |
| asOf | string | no | ISO-8601 timestamp |

## Markets (normalized)

**NBA:** `pts`, `reb`, `ast`, `tpm`, `pra`, `stl`, `blk`  
Aliases: points, rebounds, assists, 3PM, 3-Pointers Made, threes, steals, blocks, PRA, …

**NHL:** `sog`, `pts`  
Aliases: shots, shots on goal, points, …

**NFL:** `rec`  
Aliases: receptions, …

**MLB:** `hit` (line 0.5 for the desk)  
Aliases: hits, player hits, …

## Example

```json
[
  {
    "book": "bet99",
    "sport": "nba",
    "player": "Jalen Johnson",
    "market": "points",
    "line": 21.5,
    "over": -115,
    "under": -105,
    "asOf": "2026-10-30T18:00:00Z"
  },
  {
    "book": "bet365",
    "sport": "nba",
    "player": "Jalen Johnson",
    "market": "points",
    "line": 22.5,
    "over": -110,
    "under": -110,
    "asOf": "2026-10-30T18:00:00Z"
  }
]
```
