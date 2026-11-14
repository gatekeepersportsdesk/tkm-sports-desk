"""Measure the moments the NHL game simulator must reproduce (walk-forward residuals from the fitted marginals)."""
import sys, numpy as np, pandas as pd
sys.path.insert(0, 'scripts'); import fit_nhl_moneypuck as F
F.MIN_TOI = 12.0
raw = pd.concat([F.read_any(f) for f in sys.argv[1:]], ignore_index=True); g = F.build_games(raw)
seasons = sorted(g.season.unique()); S = seasons[-1]
cur = F.walk_forward_inputs(g, S); cur = cur[(cur.priorGp + cur.gp >= 1) & (cur.avg_toi_pre >= 12.0)].copy()
prior = F.pos_priors(g, S - 1)
cur['mu_s'] = F.mu_for(cur, 'sog', 20, 10, prior).values; cur['mu_p'] = F.mu_for(cur, 'pts', 30, 10, prior).values
R_S, R_P = 16.0, 36.0
cur['zs'] = (cur.shots - cur.mu_s) / np.sqrt(cur.mu_s + cur.mu_s ** 2 / R_S); cur['zp'] = (cur.points - cur.mu_p) / np.sqrt(cur.mu_p + cur.mu_p ** 2 / R_P)
print('rows', len(cur), 'own shots-points resid corr', round(cur[['zs', 'zp']].corr().iloc[0, 1], 3))
def pair_corr(col):
    num = den = 0; a = []; 
    for (_, _), d in cur.groupby(['gid', 'team']):
        z = d[col].values
        if len(z) < 2: continue
        s = z.sum(); q = (z ** 2).sum(); n = len(z)
        a.append(((s * s - q) / (n * (n - 1)), 1))   # mean of z_i z_j over i!=j
    v = np.array([x[0] for x in a]); return v.mean(), v.std() / np.sqrt(len(v)), len(v)
for c in ('zs', 'zp'):
    m, se, n = pair_corr(c); print(f'teammate {c} corr {m:+.4f} +- {se:.4f} (team-games {n})')
# opposing skaters same game
opp = cur.merge(cur[['gid', 'team', 'zs', 'zp']].rename(columns={'team': 'oteam', 'zs': 'ozs', 'zp': 'ozp'}), on='gid'); opp = opp[opp.team != opp.oteam]
print('opponents zs corr', round(opp[['zs', 'ozs']].corr().iloc[0, 1], 4), ' zp corr', round(opp[['zp', 'ozp']].corr().iloc[0, 1], 4))
# team shot volume: predicted mean = sum of skater mu_s (listed >=12min) ; observed = sum of their shots
tv = cur.groupby(['gid', 'team']).agg(n=('pid', 'size'), mu=('mu_s', 'sum'), y=('shots', 'sum'), mup=('mu_p', 'sum'), yp=('points', 'sum')).reset_index()
tv = tv[tv.n >= 10]
print('team-games', len(tv), 'mean listed-skater SOG', tv.y.mean().round(2), 'pred', tv.mu.mean().round(2), 'var obs', tv.y.var().round(2))
res = tv.y - tv.mu; var = res.var(); m = tv.mu.mean()
print('team SOG residual var', round(var, 2), 'poisson var', round(m, 2), '-> NB size r_V = ', round(m ** 2 / max(var - m, 1e-6), 1))
resp = tv.yp - tv.mup; print('team points resid var', round(resp.var(), 3), 'mean', round(tv.mup.mean(), 3), 'ratio', round(resp.var() / tv.mup.mean(), 3), ' corr(team SOG resid, team pts resid)', round(np.corrcoef(res, resp)[0, 1], 3))
# share dispersion: observed share of team listed shots vs predicted share
cur = cur.merge(tv[['gid', 'team', 'mu', 'y']], on=['gid', 'team'], how='inner', suffixes=('', '_t'))
cur['w'] = cur.mu_s / cur.mu; cur['sh'] = cur.shots / cur.y.clip(lower=1)
d = cur[cur.y >= 10]; V = d.y.values; w = d.w.values
obs = ((d.sh - w) ** 2).values; 
# DM: Var(share) = w(1-w)(V+c)/(V(1+c))  -> solve for c by least squares on a grid
best = None
for c in [5, 10, 15, 20, 30, 40, 60, 80, 120, 200, 400, 1e6]:
    pred = w * (1 - w) * (V + c) / (V * (1 + c)); sse = ((obs - pred) ** 2).sum()
    if best is None or sse < best[1]: best = (c, sse)
    print(f'  c={c:>8}: mean predicted share var {pred.mean():.5f}  observed {obs.mean():.5f}')
print('best concentration c', best[0])
