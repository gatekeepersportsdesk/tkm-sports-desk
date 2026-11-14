"""Early season / rookies / team changers: how does the NBA rate model behave OUTSIDE the 20+ minute veterans it was tuned on?
Evaluation population = every played row with projected minutes >= 14 (what the desk lists), seasons 2024-2026, walk-forward.
Groups: rookie/new (no prior-season games), vet (prior >= 20 games), changer (vet whose team differs from last season's last team),
by total games (this + last season).
usage: python3 -I scripts/nba/nba_early_test.py /home/claude/nbadata"""
import sys, itertools, numpy as np, pandas as pd
from scipy.stats import nbinom
sys.path.insert(0, 'scripts/nba')
import nba_data as D, nba_variants as V
V.DIR = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/nbadata'
PRM = {'pts': dict(K=300, PK=200, KM=8, W=0.6, rA=6, rB=2.5), 'reb': dict(K=300, PK=600, KM=8, W=0.6, rA=18, rB=2.5),
       'ast': dict(K=300, PK=200, KM=3, W=0.6, rA=15, rB=3), 'tpm': dict(K=300, PK=200, KM=8, W=0.6, rA=12, rB=2)}
raw, p = V.prep()
last_team = p.sort_values('date').groupby(['athlete_id', 'season']).team.last().rename('prev_team').reset_index(); last_team['season'] += 1
p = p.merge(last_team, on=['athlete_id', 'season'], how='left')

def frame(season):
    s = p[p.season == season].copy()
    pri = D.pos_group_priors(p, season - 1)
    s['pr_min'] = s.pos.map(lambda x: pri.get(x, pri['_all'])['min'])
    for k in D.STATS: s['pr_rate_' + k] = s.pos.map(lambda x: pri.get(x, pri['_all'])[k])
    q = PRM['pts']; s['pm'] = V.minutes_proj(s, q['KM'], q['W']).values
    s = s[s.pm >= 14].copy()
    s['tot'] = s.gp + s.priorGp
    s['group'] = np.where(s.priorGp < 20, 'new', np.where(s.prev_team.notna() & (s.prev_team != s.team), 'changer', 'vet'))
    s['season'] = season
    return s
FR = pd.concat([frame(y) for y in (2024, 2025, 2026)], ignore_index=True)
FR['gb'] = pd.cut(FR.gp, [-1, 4, 9, 19, 39, 200], labels=['0-4', '5-9', '10-19', '20-39', '40+'])
print(len(FR), 'rows', FR.group.value_counts().to_dict())

def mu_for(df, k, K, PK, mult=None):
    prior_rate = (df['prior_' + k] + PK * df['pr_rate_' + k]) / (df.priorMin + PK)
    Ke = K if mult is None else K * mult
    rate = (df['cum_' + k] + Ke * prior_rate) / (df.cum_min + Ke)
    return rate * V.minutes_proj(df, PRM[k]['KM'], PRM[k]['W'])
def rf(df, k, scale=1.0): return scale * PRM[k]['rA'] * (np.maximum(df.pm.values, 5) / 30.0) ** PRM[k]['rB']
def cov(y, mu, r, rng):
    pr = r / (r + mu); lo = np.where(y > 0, nbinom.cdf(y - 1, r, pr), 0.0); hi = nbinom.cdf(y, r, pr); u = lo + rng.random(len(y)) * (hi - lo)
    return [float(((u > (1 - l) / 2) & (u < 1 - (1 - l) / 2)).mean()) for l in (0.5, 0.8, 0.9)]
rng = np.random.default_rng(1)

print('\n== current model, coverage 50/80/90 and LL by group x games-this-season (pts) ==')
for k in ('pts', 'reb'):
    print(k)
    for g in ('vet', 'changer', 'new'):
        for b in FR.gb.cat.categories:
            d = FR[(FR.group == g) & (FR.gb == b)]
            if len(d) < 150: continue
            mu = mu_for(d, k, PRM[k]['K'], PRM[k]['PK']).values
            print(f'  {g:8s} gp {b:6s} n={len(d):5d}  cov {np.round(cov(d[k].values, mu, rf(d, k), rng), 3)}  LL {V.nb_ll(d[k].values, mu, rf(d, k)).mean():.4f}  mean(y)/mean(mu) {d[k].mean()/mu.mean():.3f}')

print('\n== fit K multiplier and r scale per group (grid, season-held-out: choose on two seasons, score on the third) ==')
KM_GRID = [0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2.5]; RS = [0.5, 0.65, 0.8, 1, 1.25]
res = {}
for g in ('vet', 'changer', 'new'):
    for k in D.STATS:
        tot_ll = 0; n = 0; chosen = []
        for s in (2024, 2025, 2026):
            tr = FR[(FR.group == g) & (FR.season != s)]; te = FR[(FR.group == g) & (FR.season == s)]
            best = None
            for km, rs in itertools.product(KM_GRID, RS):
                ll = V.nb_ll(tr[k].values, mu_for(tr, k, PRM[k]['K'], PRM[k]['PK'], km).values, rf(tr, k, rs)).mean()
                if best is None or ll > best[0]: best = (ll, km, rs)
            tot_ll += V.nb_ll(te[k].values, mu_for(te, k, PRM[k]['K'], PRM[k]['PK'], best[1]).values, rf(te, k, best[2])).sum(); n += len(te); chosen.append((best[1], best[2]))
        base = sum(V.nb_ll(FR[(FR.group == g) & (FR.season == s)][k].values, mu_for(FR[(FR.group == g) & (FR.season == s)], k, PRM[k]['K'], PRM[k]['PK']).values, rf(FR[(FR.group == g) & (FR.season == s)], k)).sum() for s in (2024, 2025, 2026))
        allb = None
        for km, rs in itertools.product(KM_GRID, RS):
            d = FR[FR.group == g]; ll = V.nb_ll(d[k].values, mu_for(d, k, PRM[k]['K'], PRM[k]['PK'], km).values, rf(d, k, rs)).mean()
            if allb is None or ll > allb[0]: allb = (ll, km, rs)
        res[(g, k)] = dict(kmult=allb[1], rscale=allb[2])
        print(f'  {g:8s} {k}: held-out LL/row current {base/n:.4f} -> tuned {tot_ll/n:.4f} (gain {(tot_ll-base)/n:+.4f}); per-fold choice {chosen}; all-data choice Kx{allb[1]} r x{allb[2]}  n={n}')
import json; json.dump({f'{g}|{k}': v for (g, k), v in res.items()}, open('/tmp/claude-0/-home-claude/4b87b68d-aeb1-517c-951a-160af25d46a9/scratchpad/early_res.json', 'w'))
