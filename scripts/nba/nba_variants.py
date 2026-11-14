"""Compare rate models for NBA props, walk-forward. Tune on one season, score on the others.
usage: python3 -I scripts/nba/nba_variants.py /home/claude/nbadata"""
import sys, itertools, numpy as np, pandas as pd
from scipy.special import gammaln
sys.path.insert(0, 'scripts/nba')
import nba_data as D

DIR = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/nbadata'
MIN_AVG = 20.0


def nb_ll(y, mu, r):
    mu = np.maximum(mu, 1e-6)
    return gammaln(y + r) - gammaln(r) - gammaln(y + 1) + r * np.log(r / (r + mu)) + y * np.log(mu / (r + mu))


def prep():
    raw = D.load(DIR, [2023, 2024, 2025, 2026, 2027])
    p = D.add_walk_forward(D.played_rows(raw))
    # team at the end of last season, to identify team changers
    lt = p.sort_values('date').groupby(['athlete_id', 'season']).team.last().rename('prev_team').reset_index(); lt['season'] += 1
    p = p.merge(lt, on=['athlete_id', 'season'], how='left')
    return raw, p


WIDE_PM = 14.0   # the desk lists everyone projected at >= 14 minutes


def season_frame(p, season, wide=False):
    """wide=False: veterans averaging 20+ minutes (what the first fit used). wide=True: EVERYONE the desk would list
    (projected minutes >= 14, incl. rookies and players with no prior season), with a group label:
    new = fewer than 20 games last season, changer = 20+ last season but a different team, vet = the rest."""
    s = p[p.season == season].copy() if wide else p[(p.season == season) & (p.avg_min_pre >= MIN_AVG)].copy()
    pri = D.pos_group_priors(p, season - 1)
    s['pr_min'] = s.pos.map(lambda x: pri.get(x, pri['_all'])['min'])
    for k in D.STATS:
        s['pr_rate_' + k] = s.pos.map(lambda x: pri.get(x, pri['_all'])[k])
    if wide:
        s['pm'] = minutes_proj(s, 8, 0.6).values
        s = s[s.pm >= WIDE_PM].copy()
        s['group'] = np.where(s.priorGp < 20, 'new', np.where(s.prev_team.notna() & (s.prev_team != s.team), 'changer', 'vet'))
    return s


def mu_per_game(s, k, K, PK):
    # per-game rate. prior season rate shrunk to position prior (per-game, from minutes-weighted rate * avg min)
    pos_pg = s['pr_rate_' + k] * s.pr_min
    prior_pg = (s['prior_' + k] + PK * pos_pg) / (s.priorGp + PK)
    return (s['cum_' + k] + K * prior_pg) / (s.gp + K)


def minutes_proj(s, KM, W):
    prior_avg = np.where(s.priorGp > 0, s.priorMin / s.priorGp.clip(lower=1), s.pr_min)
    season_avg = (s.cum_min + KM * prior_avg) / (s.gp + KM)
    l5 = s.min_l5.fillna(season_avg)
    return W * l5 + (1 - W) * season_avg


def mu_per_min(s, k, K, PK, KM, W):
    prior_rate = (s['prior_' + k] + PK * s['pr_rate_' + k]) / (s.priorMin + PK)
    rate = (s['cum_' + k] + K * prior_rate) / (s.cum_min + K)
    return rate * minutes_proj(s, KM, W)


def best_r(y, mu):
    best = (None, -1e18)
    for r in list(np.arange(1, 10, 0.5)) + list(np.arange(10, 60, 2.5)) + [80, 120, 200, 400]:
        ll = nb_ll(y, mu, r).mean()
        if ll > best[1]: best = (float(r), float(ll))
    return best


def tune(s, k, variant):
    y = s[k].values; best = None
    if variant == 'per_game':
        for K, PK in itertools.product([2, 4, 8, 15, 30], [5, 10, 20, 40]):
            mu = mu_per_game(s, k, K, PK).values; r, ll = best_r(y, mu)
            if best is None or ll > best['ll']: best = dict(K=K, PK=PK, r=r, ll=ll)
    else:
        for K, PK, KM, W in itertools.product([100, 300, 800, 2000], [200, 600, 1500], [3, 8], [0.0, 0.3, 0.6]):
            mu = mu_per_min(s, k, K, PK, KM, W).values; r, ll = best_r(y, mu)
            if best is None or ll > best['ll']: best = dict(K=K, PK=PK, KM=KM, W=W, r=r, ll=ll)
    return best


def score(s, k, variant, prm):
    y = s[k].values
    mu = (mu_per_game(s, k, prm['K'], prm['PK']) if variant == 'per_game' else mu_per_min(s, k, prm['K'], prm['PK'], prm['KM'], prm['W'])).values
    return nb_ll(y, mu, prm['r']).mean(), mu


if __name__ == '__main__':
    raw, p = prep()
    fr = {s: season_frame(p, s) for s in (2024, 2025, 2026)}
    print({s: len(f) for s, f in fr.items()}, 'rows with >= %g min avg' % MIN_AVG)
    for k in D.STATS:
        print(f'\n=== {k}')
        for variant in ('per_game', 'per_min'):
            prm = tune(fr[2025], k, variant)
            row = {s: score(fr[s], k, variant, prm)[0] for s in (2024, 2025, 2026)}
            print(f'{variant:9s} tuned on 2025: {({a: (round(b, 4) if not isinstance(b, float) or a in ("r","K","PK","KM","W") else round(b, 4)) for a, b in prm.items() if a != "ll"})}  LL/row 2024 {row[2024]:.4f} | 2025 {row[2025]:.4f} | 2026 {row[2026]:.4f}')
