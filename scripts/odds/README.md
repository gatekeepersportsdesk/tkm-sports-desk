# Gatekeep drop-in: Bet99/Bet365 odds tools + gap fixes

Drop this folder’s contents into your Google AI Studio Gatekeep project.

## What this is

| Path | Purpose |
|------|---------|
| `scripts/odds/` | Local Python tools: parse tables, write Gatekeep JSON, optional Playwright fetch skeleton |
| `docs/GAPS_AND_MERGE.md` | NFL parlay priced-legs fix + CHANGELOG blurb (apply in Studio / Claude) |
| `src_patches/nfl_parlay_priced_legs.md` | Exact App.tsx behaviour to implement for NFL Edge/Safe priced pool |

**The web app must stay scrape-free.** These scripts run on *your* machine only.

## Daily workflow (target)

```bash
cd scripts/odds
# Option A — fastest once selectors work:
python fetch_books.py --sport nba --book both --out out

# Option B — always works: save page or copy table from browser, then:
python parse_table.py --text copied.txt --book bet99 --sport nba --out raw_bet99.json
python parse_table.py --html saved_bet365.html --book bet365 --sport nba --out raw_bet365.json
python write_gatekeep_json.py --in raw_bet99.json --in raw_bet365.json --out out

# Then in Gatekeep: Odds import → Load out/odds_nba_YYYY-MM-DD.json → Apply
```

Cadence: **2–3 times per day pre-match only** (line open + near lock). Not live polling.

## Setup

```bash
cd scripts/odds
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# only needed for fetch_books.py:
playwright install chromium
cp config.example.json config.local.json
# edit config.local.json with the prop page URLs you use
```

## Tests (offline)

```bash
cd scripts/odds
python -m unittest test_odds_tools.py -v
```

## Legal / ToS

Automated access to sportsbook sites may violate their terms of use. You run any fetcher at your own risk. Prefer official exports/APIs when available. This package does not include login, stealth, or ban-evasion features.
