"""Does a walk-forward opponent 'shots against' factor improve SOG pricing? Same population/rows as the fitter."""
import sys, numpy as np, pandas as pd
sys.path.insert(0, 'scripts'); import fit_nhl_moneypuck as F
from scipy.optimize import minimize_scalar
F.MIN_TOI = 12.0
raw = pd.concat([F.read_any(f) for f in sys.argv[1:]], ignore_index=True); g = F.build_games(raw)
# team shots for / against per game (all skaters in the file), then walk-forward factor with K pseudo-games at league mean
tg = g.groupby(['season', 'gid', 'team', 'opp', 'date']).shots.sum().reset_index().rename(columns={'shots': 'sf'})
ag = tg.rename(columns={'team': 'opp', 'opp': 'team', 'sf': 'sa'})[['season', 'gid', 'team', 'sa']]
tg = tg.merge(ag, on=['season', 'gid', 'team'], how='left').sort_values(['season', 'date'])
def factors(K):
    out = {}
    for ssn, d in tg.groupby('season'):
        for team, t in d.groupby('team'):
            t = t.sort_values('date'); cs = t.sa.cumsum().shift(1).fillna(0); n = np.arange(len(t))
            lg = d.sa.mean()
            for gid, c, k in zip(t.gid, cs, n): out[(ssn, gid, team)] = ((c + K * lg) / (k + K)) / lg
    return out
def rows(season, pseudo):
    gg = g.copy()
    if pseudo:
        early = (gg.season == season) & (gg.date < pd.Timestamp(f'{season + 1}-01-01')); gg.loc[early, 'season'] = season - 1
    cur = F.walk_forward_inputs(gg, season); prior = F.pos_priors(gg, season - 1)
    return cur, prior
res = []
for K in (5, 10, 20, 40):
    fac = factors(K)
    ll0 = ll1 = n = 0
    for season, pseudo in ((2025, True), (2026, False)):
        cur, prior = rows(season, pseudo)
        cur = cur.copy(); cur['f'] = [fac.get((season, gid, opp), np.nan) for gid, opp in zip(cur.gid, cur.opp)]
        cur = cur.dropna(subset=['f']); cur = cur[cur.gp >= 3]
        mu = F.mu_for(cur, 'sog', 20, 10, prior).values; y = cur.shots.values
        def nll(b): return -F.nb_logpmf(y, mu * cur.f.values ** b, 16.0).sum()
        r = minimize_scalar(nll, bounds=(-1, 3), method='bounded')
        res.append((K, season, len(cur), r.x, (F.nb_logpmf(y, mu * cur.f.values ** r.x, 16.0).mean() - F.nb_logpmf(y, mu, 16.0).mean())))
for K, ssn, n, b, d in res: print(f'K={K:<3} season {ssn} n={n:,}  exponent b={b:+.2f} (1 = full pass-through)  LL gain/row {d:+.5f}')
