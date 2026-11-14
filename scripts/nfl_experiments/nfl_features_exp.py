"""Walk-forward team-context features (nflverse PBP + FTN charting) and out-of-sample test of whether
they improve the receptions NB likelihood. Features for week W use ONLY games before W of the same season
(plus nothing from the future). Shrunk toward league mean with pseudo-games K."""
import sys, numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln
D = '/home/claude/data/'
def pbp(y):
    c = ['game_id','season','week','season_type','posteam','defteam','play_type','pass','rush','qb_dropback','epa','success','sack','qb_hit','qb_kneel','qb_spike','wp','half_seconds_remaining','game_seconds_remaining','score_differential','down','play_id','no_huddle','yards_gained','interception','fumble_lost','pass_touchdown','two_point_attempt','drive']
    d = pd.read_csv(D+f'pbp_{y}.csv', usecols=c, low_memory=False)
    f = pd.read_csv(D+f'ftn_{y}.csv', usecols=['nflverse_game_id','nflverse_play_id','n_blitzers','n_pass_rushers','is_play_action'])
    d = d.merge(f, left_on=['game_id','play_id'], right_on=['nflverse_game_id','nflverse_play_id'], how='left')
    return d[d.season_type=='REG']
P = pd.concat([pbp(y) for y in (2024,2025,2026)])
P = P[P.posteam.notna() & (P['qb_kneel']!=1) & (P['qb_spike']!=1)]
P['dropback'] = (P.qb_dropback==1)
pl = P[(P['pass']==1)|(P.sack==1)|(P['rush']==1)]
# --- per team-game aggregates (offense side) ---
def agg(g):
    db = g[g.dropback]; ru = g[(g['rush']==1)&(~g.dropback)]
    neutral = g[(g.wp.between(0.2,0.8))&(g.down.isin([1,2,3]))&(g.half_seconds_remaining>120)]
    nd = neutral[neutral.dropback]
    return pd.Series(dict(plays=len(g), db=len(db), pass_epa=db.epa.mean(), pass_succ=db.success.mean(), rush_epa=ru.epa.mean(),
        press=(db.sack.fillna(0).sum()+ (db.qb_hit.fillna(0)*(1-db.sack.fillna(0))).sum())/max(1,len(db)),
        blitz=(db.n_blitzers.dropna()>0).mean() if db.n_blitzers.notna().sum()>5 else np.nan,
        pa=db.is_play_action.dropna().astype(float).mean() if db.is_play_action.notna().sum()>5 else np.nan,
        neutral_pass=len(nd)/max(1,len(neutral)), sec_per_play=np.nan))
pl = pl.sort_values(['game_id','play_id'])
off = pl.groupby(['season','week','game_id','posteam']).apply(agg, include_groups=False).reset_index().rename(columns={'posteam':'team'})
dfn = pl.groupby(['season','week','game_id','defteam']).apply(agg, include_groups=False).reset_index().rename(columns={'defteam':'team'})
# pace: seconds per play within a team's drives (neutral game states only), drive-elapsed / plays
pl2 = pl[(pl.wp.between(0.2,0.8))&(pl.half_seconds_remaining>120)].copy()
dr = pl2.groupby(['season','week','game_id','posteam','drive']).agg(n=('play_id','size'), hi=('game_seconds_remaining','max'), lo=('game_seconds_remaining','min')).reset_index()
dr = dr[dr.n>=4]; dr['el']=(dr.hi-dr.lo)
pace = dr.groupby(['season','week','posteam']).apply(lambda g: g.el.sum()/ (g.n.sum()-len(g)), include_groups=False).reset_index().rename(columns={'posteam':'team',0:'pace'})
off = off.merge(pace, on=['season','week','team'], how='left')
off.to_csv(D+'team_off_games.csv', index=False); dfn.to_csv(D+'team_def_games.csv', index=False)
print(off.shape, dfn.shape); print(off.describe().T[['mean','std']])
