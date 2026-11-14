"""Which adjustments earn a place in the NBA model? Walk-forward, no lookahead.
Base: per-minute rate (shrunk to prior season and position) x projected minutes  (nba_variants.py 'per_min').
Candidate multipliers (log-linear, ridge): opponent allowed-rate factor, home/away, back-to-back, teammate absence.
Evaluation: leave-one-SEASON-out (fit coefficient on two seasons, score the third), NB log-lik per row,
game-clustered bootstrap CI. Adopt only if positive in EVERY season and the pooled CI is above zero.
usage: python3 -I scripts/nba/nba_features_test.py /home/claude/nbadata"""
import sys, numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln
sys.path.insert(0, 'scripts/nba')
import nba_data as D, nba_variants as V

DIR = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/nbadata'
V.DIR = DIR
raw, p = V.prep()
PRM = {  # tuned on 2025 by nba_variants.py
    'pts': dict(K=300, PK=200, KM=8, W=0.6, r=5.0), 'reb': dict(K=300, PK=600, KM=8, W=0.6, r=15.0),
    'ast': dict(K=300, PK=200, KM=3, W=0.6, r=15.0), 'tpm': dict(K=300, PK=200, KM=8, W=0.6, r=10.0),
    'pra': dict(K=100, PK=200, KM=8, W=0.6, r=8.5), 'stl': dict(K=800, PK=600, KM=3, W=0.6, r=12.5), 'blk': dict(K=800, PK=200, KM=8, W=0.6, r=7.5)}
SEASONS = (2024, 2025, 2026)
fr = {s: V.season_frame(p, s, wide=True) for s in SEASONS}   # everyone the desk lists (pm >= 14), incl. rookies / changers
for s in SEASONS:
    f = fr[s]; f['season'] = s
    for k in D.STATS:
        q = PRM[k]; f['mu_' + k] = V.mu_per_min(f, k, q['K'], q['PK'], q['KM'], q['W']).values
F = pd.concat(fr.values(), ignore_index=True)

# ---- team allowed per game (walk-forward, same season) -> opponent factor ----
tg = p.groupby(['season', 'game_id', 'team', 'opp', 'date']).agg(**{k: (k, 'sum') for k in D.STATS}).reset_index().sort_values('date')
def opp_factor(k, K):
    out = {}
    for s, g in tg.groupby('season'):
        g = g.sort_values('date'); dates = sorted(g.date.unique())
        for d in dates:
            prev = g[g.date < d]
            if len(prev) == 0: continue
            lg = prev[k].mean()
            allowed = prev.groupby('opp')[k].agg(['sum', 'count'])
            for t, row in allowed.iterrows(): out[(s, t, d)] = ((row['sum'] + K * lg) / (row['count'] + K)) / lg
    return out
for k in D.STATS:
    for K in (5, 10, 20):
        m = opp_factor(k, K); F[f'of_{k}_{K}'] = [np.log(m.get((s, o, d), 1.0)) for s, o, d in zip(F.season, F.opp, F.date)]

# ---- teammate absence (hindsight DNP of rotation players: upper bound; live uses the injury report) ----
trail = p.sort_values('date').copy(); trail['avg_after'] = (trail.cum_min + trail['min']) / (trail.gp + 1)
trail = trail[['athlete_id', 'date', 'avg_after']].sort_values('date')
dnp = raw[(raw.did_not_play == True)].copy(); dnp['inj'] = ~dnp.reason.fillna('').str.contains("COACH", case=False)
dnp = pd.merge_asof(dnp.sort_values('date'), trail, by='athlete_id', on='date', direction='backward', allow_exact_matches=False)
dnp = dnp[dnp.avg_after >= 20]
L_all = dnp.groupby(['game_id', 'team']).avg_after.sum().rename('L_all'); L_inj = dnp[dnp.inj].groupby(['game_id', 'team']).avg_after.sum().rename('L_inj')
F = F.merge(L_all, left_on=['game_id', 'team'], right_index=True, how='left').merge(L_inj, left_on=['game_id', 'team'], right_index=True, how='left')
F['L_all'] = F.L_all.fillna(0) / 100.0; F['L_inj'] = F.L_inj.fillna(0) / 100.0   # units: 100 rotation-minutes
F['home'] = F.home.astype(float) - 0.5
F['b2b'] = (F.rest_days == 1).astype(float)
F['b2b'] = F.b2b.fillna(0)

def ll(y, mu, r): mu = np.maximum(mu, 1e-6); return gammaln(y + r) - gammaln(r) - gammaln(y + 1) + r * np.log(r / (r + mu)) + y * np.log(mu / (r + mu))
def fit(df, k, cols, lam=5.0):
    X = df[cols].values; y = df[k].values; m0 = df['mu_' + k].values; r = PRM[k]['r']
    return minimize(lambda b: -ll(y, m0 * np.exp(X @ b), r).sum() + lam * (b @ b), np.zeros(len(cols)), method='L-BFGS-B').x
def cv(k, cols):
    d = np.zeros(len(F)); coefs = {}
    for s in SEASONS:
        tr, te = F[F.season != s], F[F.season == s]; b = fit(tr, k, cols); coefs[s] = b
        mu1 = te['mu_' + k].values * np.exp(te[cols].values @ b)
        d[te.index] = ll(te[k].values, mu1, PRM[k]['r']) - ll(te[k].values, te['mu_' + k].values, PRM[k]['r'])
    return d, coefs
rng = np.random.default_rng(1)
def boot(d, B=600):
    s = pd.Series(d).groupby(F.game_id.values).agg(['sum', 'count']); n = len(s); sums = s['sum'].values; cnt = s['count'].values
    return np.percentile([sums[i].sum() / cnt[i].sum() for i in (rng.integers(0, n, n) for _ in range(B))], [2.5, 97.5])
def report(k, label, cols):
    d, co = cv(k, cols); lo, hi = boot(d); per = {s: d[(F.season == s).values].mean() for s in SEASONS}
    ok = lo > 0 and all(v > 0 for v in per.values())
    print(f'{k:3s} {label:26s} dLL/row {d.mean():+.5f} CI[{lo:+.5f},{hi:+.5f}]  24 {per[2024]:+.5f} 25 {per[2025]:+.5f} 26 {per[2026]:+.5f}  coef {np.round(np.mean([c for c in co.values()], axis=0), 3)} {"ADOPT" if ok else ""}')
if __name__ == '__main__':
    print('rows', len(F), '| share with a rotation teammate DNP: all %.3f injury %.3f' % ((F.L_all > 0).mean(), (F.L_inj > 0).mean()))
    for k in D.STATS:
        for K in (5, 10, 20): report(k, f'opponent allowed K={K}', [f'of_{k}_{K}'])
        report(k, 'home/away', ['home']); report(k, 'back-to-back', ['b2b'])
        report(k, 'teammate absent (all DNP)', ['L_all']); report(k, 'teammate absent (injury)', ['L_inj'])
        report(k, 'opp K=10 + b2b + home', [f'of_{k}_10', 'b2b', 'home'])
