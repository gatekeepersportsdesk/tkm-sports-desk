"""Measure the dependence structure a game simulator has to reproduce, from real MoneyPuck game logs.
Uses the fitted walk-forward means (same as the app). Pairs are skaters (12+ min) in the SAME game.
  teammates: same team, same game      opponents: different teams, same game
Residuals are standardized with the fitted NB variance. Reports Pearson per pair, averaged, with a
game-block bootstrap standard error. usage: python3 -I scripts/measure_nhl_dependence.py 2025.csv 2026.csv"""
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, 'scripts'); import fit_nhl_moneypuck as F
args = [a for a in sys.argv[1:] if not a.startswith('--')]
raw = pd.concat([F.read_any(f) for f in args], ignore_index=True); g = F.build_games(raw)
cur_s = int(g.season.max()); F.MIN_TOI = 12.0
fit = json.load(open('/dev/stdin')) if False else None
P = dict(sog=dict(shrinkK=20, priorK=10, r=16.0), pts=dict(shrinkK=30, priorK=10, r=36.0))
frames = []
for season, prior_season in ((cur_s, cur_s - 1),):
    cur = F.walk_forward_inputs(g, season); pr = F.pos_priors(g, prior_season)
    frames.append((cur, pr))
gg = g.copy(); ps = cur_s - 1
early = (gg.season == ps) & (gg.date < pd.Timestamp(f'{ps + 1}-01-01')); gg.loc[early, 'season'] = ps - 1
frames.append((F.walk_forward_inputs(gg, ps), F.pos_priors(gg, ps - 1)))
rows = []
for cur, pr in frames:
    cur = cur[(cur.priorGp + cur.gp >= 1) & (cur.avg_toi_pre >= 12.0)].copy()
    for m, y in (('sog', 'shots'), ('pts', 'points')):
        mu = F.mu_for(cur, m, P[m]['shrinkK'], P[m]['priorK'], pr).values; r = P[m]['r']
        cur['z_' + m] = (cur[y].values - mu) / np.sqrt(mu + mu ** 2 / r); cur['mu_' + m] = mu
    rows.append(cur)
D = pd.concat(rows, ignore_index=True)
print(f'rows {len(D):,}  games {D.gid.nunique():,}')
def pair_corr(col, same_team, rng):
    num = {}; 
    # per-game sums to compute average pair product without O(n^2) loops: for a group, sum_{i!=j} z_i z_j = (S^2 - Q)
    out = []
    for gid, gdf in D.groupby('gid'):
        if same_team:
            for tm, t in gdf.groupby('team'):
                z = t[col].values; n = len(z)
                if n > 1: out.append((gid, (z.sum() ** 2 - (z ** 2).sum()), n * (n - 1)))
        else:
            teams = gdf.team.unique()
            if len(teams) == 2:
                a = gdf[gdf.team == teams[0]][col].values; b = gdf[gdf.team == teams[1]][col].values
                out.append((gid, 2 * a.sum() * b.sum(), 2 * len(a) * len(b)))
    arr = pd.DataFrame(out, columns=['gid', 's', 'n'])
    est = arr.s.sum() / arr.n.sum()
    gids = arr.gid.unique(); boot = []
    byg = arr.groupby('gid')[['s', 'n']].sum()
    for _ in range(300):
        pick = rng.choice(len(byg), len(byg)); boot.append(byg.s.values[pick].sum() / byg.n.values[pick].sum())
    return est, float(np.std(boot))
rng = np.random.default_rng(3); res = {}
for col, name in (('z_sog', 'shots'), ('z_pts', 'points')):
    for same, lab in ((True, 'teammates'), (False, 'opponents')):
        e, se = pair_corr(col, same, rng); res[f'{name}_{lab}'] = (e, se)
        print(f'{name:7s} {lab:10s} mean pairwise residual corr {e:+.4f}  (se {se:.4f})')
# team-level totals: variance of listed-skater team total vs sum of mu
T = D.groupby(['gid', 'team']).agg(sh=('shots', 'sum'), mu_sh=('mu_sog', 'sum'), v_sh=('mu_sog', lambda x: 0), pts=('points', 'sum'), mu_pt=('mu_pts', 'sum'), n=('pid', 'size')).reset_index()
for a, b, nm in (('sh', 'mu_sh', 'shots'), ('pts', 'mu_pt', 'points')):
    x = T[a].values; m = T[b].values
    print(f'{nm}: team total mean {x.mean():.2f} (model {m.mean():.2f}) var {x.var():.2f}  Poisson-equivalent {m.mean():.2f}  var/mean {x.var()/x.mean():.3f}  listed skaters/team {T.n.mean():.1f}')
json.dump({k: list(v) for k, v in res.items()}, open('/tmp/claude-0/-home-claude/4b87b68d-aeb1-517c-951a-160af25d46a9/scratchpad/nhl_dep.json', 'w'))
