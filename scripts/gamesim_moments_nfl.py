"""NFL simulator target moments: team target volume dispersion given the engine's dropback mean, and target-share concentration."""
import numpy as np, pandas as pd
D = '/home/claude/data/'
norm = {'LA': 'LAR', 'JAC': 'JAX', 'WSH': 'WAS', 'OAK': 'LV', 'SD': 'LAC', 'STL': 'LAR'}; n = lambda t: norm.get(t, t)
S = pd.concat([pd.read_csv(D + f'stats_player_week_{y}.csv', usecols=['player_id', 'player_display_name', 'position', 'season', 'week', 'season_type', 'team', 'targets', 'receptions']) for y in (2024, 2025, 2026)])
S = S[(S.season_type == 'REG') & S.position.isin(['WR', 'TE', 'RB'])].copy(); S['team'] = S.team.map(n)
G = pd.read_csv(D + 'games.csv'); G = G[G.game_type == 'REG']
rows = []
for r in G.itertuples():
    if pd.isna(r.spread_line) or pd.isna(r.total_line): continue
    rows.append((r.season, r.week, n(r.home_team), -r.spread_line, r.total_line / 2 + r.spread_line / 2))
    rows.append((r.season, r.week, n(r.away_team), r.spread_line, r.total_line / 2 - r.spread_line / 2))
L = pd.DataFrame(rows, columns=['season', 'week', 'team', 'spread', 'implied'])
# engine dropbacks formula (src/model/nfl_engine.ts NFL_CONFIG)
import re
cfg = open('/home/claude/gsd/src/model/nfl_engine.ts').read()
g = lambda k: float(re.search(k + r':\s*(-?[\d.]+)', cfg).group(1))
base, cs, ct, lo, hi = g('dropback_base'), g('dropback_spread_coef'), g('dropback_total_coef'), g('dropback_min'), g('dropback_max')
L['dropbacks'] = (base + cs * L.spread + ct * (L.implied - 22.0)).clip(lo, hi)
T = S.groupby(['season', 'week', 'team']).targets.sum().rename('T').reset_index().merge(L, on=['season', 'week', 'team'])
T = T[T.week >= 3]
ratio = T['T'].sum() / T.dropbacks.sum(); T['muT'] = ratio * T.dropbacks
print('engine dropbacks mean', T.dropbacks.mean().round(2), 'team targets mean', T['T'].mean().round(2), 'targets per engine-dropback', round(ratio, 3))
res = T['T'] - T.muT; v = res.var(); m = T.muT.mean()
print('team target residual var', round(v, 2), 'poisson var', round(m, 2), '-> NB size r_T', round(m * m / (v - m), 1), ' (bias mean resid', res.mean().round(3), ')')
# share concentration: trailing-4-game share (pre-game) vs observed share, WR/TE/RB players with >=3 prior games
S = S.sort_values(['player_id', 'season', 'week'])
S['t4'] = S.groupby(['player_id', 'season']).targets.transform(lambda x: x.shift(1).rolling(4, min_periods=3).sum())
S['g4'] = S.groupby(['player_id', 'season']).targets.transform(lambda x: x.shift(1).rolling(4, min_periods=3).count())
TT = S.groupby(['season', 'week', 'team']).targets.sum().rename('Tt').reset_index()
S = S.merge(TT, on=['season', 'week', 'team']); S = S[(S.week >= 3) & S.t4.notna() & (S.Tt >= 15)]
# trailing team targets for the same window need the team's trailing total: use the team's own trailing 4-week avg total * (g4/4)
TTs = TT.sort_values(['team', 'season', 'week']); TTs['t4tot'] = TTs.groupby(['team', 'season']).Tt.transform(lambda x: x.shift(1).rolling(4, min_periods=3).mean())
S = S.merge(TTs[['season', 'week', 'team', 't4tot']], on=['season', 'week', 'team']).dropna(subset=['t4tot'])
S['w'] = (S.t4 / S.g4) / S.t4tot; S = S[(S.w > 0.02) & (S.w < 0.5)]
S['sh'] = S.targets / S.Tt
obs = ((S.sh - S.w) ** 2).values; V = S.Tt.values; w = S.w.values
for c in [8, 12, 16, 20, 30, 45, 70, 120, 250, 1e6]:
    pred = w * (1 - w) * (V + c) / (V * (1 + c)); print(f'  c={c:>9}: pred share MSE {pred.mean():.5f}  observed {obs.mean():.5f}')
best = min([8, 12, 16, 20, 30, 45, 70, 120, 250, 1e6], key=lambda c: abs((w * (1 - w) * (V + c) / (V * (1 + c))).mean() - obs.mean()))
print('best c (MoM, includes trailing-share estimation error, so this is a LOWER bound on true concentration)', best, ' n', len(S))
# catch rate
pr = S[S.targets > 0]; print('league catch rate', round(pr.receptions.sum() / pr.targets.sum(), 3))
