"""Shared NBA data builder for the fit / backtest scripts.
Source: sportsdataverse ESPN NBA box scores (free GitHub releases). Season label = ENDING year (2026 = 2025-26).
Only regular-season rows where the player actually played (minutes > 0, did_not_play == False) are modelled;
a DNP is a VOID in the app, never a zero.
"""
import numpy as np, pandas as pd

STATS = {'pts': 'points', 'reb': 'rebounds', 'ast': 'assists', 'tpm': 'three_point_field_goals_made', 'pra': None, 'stl': 'steals', 'blk': 'blocks'}


def load(dir_, seasons):
    parts = []
    for y in seasons:
        d = pd.read_csv(f'{dir_}/pbox_{y}.csv', low_memory=False)
        d['season'] = y
        parts.append(d)
    raw = pd.concat(parts, ignore_index=True)
    raw = raw[raw.season_type == 2].copy()
    raw['date'] = pd.to_datetime(raw.game_date)
    raw['played'] = (raw.did_not_play == False) & (raw.minutes.fillna(0) > 0)
    # position: most common abbreviation per athlete
    pos = raw.dropna(subset=['athlete_position_abbreviation']).groupby('athlete_id').athlete_position_abbreviation.agg(lambda s: s.value_counts().index[0])
    GROUP = {'G': 'G', 'PG': 'G', 'SG': 'G', 'F': 'F', 'SF': 'F', 'PF': 'F', 'C': 'C'}  # app uses the same 3 groups
    raw['pos'] = raw.athlete_id.map(pos).map(GROUP).fillna('F')
    raw['team'] = raw.team_abbreviation; raw['opp'] = raw.opponent_team_abbreviation
    raw['home'] = (raw.home_away == 'home').astype(int)
    return raw


def played_rows(raw):
    p = raw[raw.played].copy()
    for k, c in STATS.items():
        if c is not None: p[k] = p[c].astype(float)
    p['pra'] = p['pts'] + p['reb'] + p['ast']
    p['min'] = p.minutes.astype(float)
    return p.sort_values(['athlete_id', 'season', 'date', 'game_id']).reset_index(drop=True)


def add_walk_forward(p, min_prior_games=0):
    """cumulative-before-this-game totals within season and prior-season totals, per athlete."""
    g = p.groupby(['athlete_id', 'season'])
    p['gp'] = g.cumcount()
    p['cum_min'] = g['min'].cumsum() - p['min']
    for k in STATS:
        p['cum_' + k] = g[k].cumsum() - p[k]
    prior = p.groupby(['athlete_id', 'season']).agg(pg=('min', 'size'), pmin=('min', 'sum'), **{'p_' + k: (k, 'sum') for k in STATS}).reset_index()
    prior['season'] = prior.season + 1
    p = p.merge(prior.rename(columns={'pg': 'priorGp', 'pmin': 'priorMin', **{'p_' + k: 'prior_' + k for k in STATS}}), on=['athlete_id', 'season'], how='left')
    for c in ['priorGp', 'priorMin'] + ['prior_' + k for k in STATS]:
        p[c] = p[c].fillna(0.0)
    # last-5 minutes (exclusive of this game) as a recency signal
    p['min_l5'] = p.groupby(['athlete_id', 'season'])['min'].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    p['avg_min_pre'] = np.where(p.gp > 0, p.cum_min / p.gp.clip(lower=1), np.where(p.priorGp > 0, p.priorMin / p.priorGp.clip(lower=1), np.nan))
    p['rest_days'] = p.groupby(['athlete_id', 'season']).date.diff().dt.days
    return p


def pos_group_priors(p, season):
    """per-minute rate by position for a season (league mean, minutes-weighted)."""
    s = p[p.season == season]
    out = {}
    for pos, g in s.groupby('pos'):
        out[pos] = {k: float(g[k].sum() / g['min'].sum()) for k in STATS}
        out[pos]['min'] = float(g['min'].mean())
    allr = {k: float(s[k].sum() / s['min'].sum()) for k in STATS}; allr['min'] = float(s['min'].mean())
    out['_all'] = allr
    return out
