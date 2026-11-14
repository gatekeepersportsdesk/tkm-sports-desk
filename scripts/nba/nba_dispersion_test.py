"""NBA: (1) widen the minutes-blend grid, (2) does dispersion r depend on games played / projected minutes / market,
(3) early-season coverage. Uses the per-minute model + opponent factor (K=10) + injury absence.
usage: python3 -I scripts/nba/nba_dispersion_test.py /home/claude/nbadata"""
import sys, itertools, numpy as np, pandas as pd
sys.path.insert(0, 'scripts/nba'); sys.argv = [sys.argv[0]] + sys.argv[1:]
import nba_features_test as T
from nba_variants import nb_ll, mu_per_min
import nba_data as D
F, PRM = T.F, T.PRM
print('rows', len(F))
print('\n== minutes blend W grid (tuned pooled, K/PK/KM held), LL/row')
for k in D.STATS:
    res = {}
    for W in (0.0, 0.3, 0.6, 0.8, 1.0):
        q = PRM[k]; ll = 0
        mu = np.concatenate([mu_per_min(F[F.season == s], k, q['K'], q['PK'], q['KM'], W).values for s in T.SEASONS])
        y = np.concatenate([F[F.season == s][k].values for s in T.SEASONS]); res[W] = nb_ll(y, mu, q['r']).mean()
    print(k, {w: round(v, 4) for w, v in res.items()})
def pit_cov(y, mu, r, rng):
    from scipy.stats import nbinom
    pr = r / (r + mu); lo = np.where(y > 0, nbinom.cdf(y - 1, r, pr), 0.0); hi = nbinom.cdf(y, r, pr)
    u = lo + rng.random(len(y)) * (hi - lo)
    return {l: float(((u > (1 - l) / 2) & (u < 1 - (1 - l) / 2)).mean()) for l in (0.5, 0.8, 0.9)}
rng = np.random.default_rng(2)
print('\n== PIT coverage 50/80/90 at base r, by games played this season and by projected-minutes bucket')
F['mb'] = pd.cut(F.min_l5.fillna(F.avg_min_pre), [0, 24, 30, 60], labels=['<24', '24-30', '30+'])
F['gb'] = pd.cut(F.gp, [-1, 4, 14, 40, 100], labels=['0-4', '5-14', '15-40', '40+'])
for k in D.STATS:
    mu = F['mu_' + k] * np.exp(F[f'of_{k}_10'] * {'pts': 1.0, 'reb': .8, 'ast': .95, 'tpm': .7}[k])
    for col in ('gb', 'mb'):
        out = []
        for b, g in F.assign(mu=mu).groupby(col, observed=True):
            c = pit_cov(g[k].values, g.mu.values, PRM[k]['r'], rng); out.append(f'{b}: n={len(g)} {c[0.5]*100:.0f}/{c[0.8]*100:.0f}/{c[0.9]*100:.0f}')
        print(f'{k:3s} by {col}:', ' | '.join(out))
print('\n== best r by bucket (LL), same mu')
for k in D.STATS:
    mu = F['mu_' + k] * np.exp(F[f'of_{k}_10'] * {'pts': 1.0, 'reb': .8, 'ast': .95, 'tpm': .7}[k])
    for col in ('gb', 'mb'):
        out = []
        for b, g in F.assign(mu=mu).groupby(col, observed=True):
            best = max(((nb_ll(g[k].values, g.mu.values, r).mean(), r) for r in [2, 3, 4, 5, 6, 8, 10, 12.5, 15, 20, 30, 50]), key=lambda t: t[0]); out.append(f'{b}: r*={best[1]}')
        print(f'{k:3s} by {col}:', ' | '.join(out), f'(config r={PRM[k]["r"]})')
