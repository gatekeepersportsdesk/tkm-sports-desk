"""Export walk-forward skater-game rows (engine means + realized shots/points) for scripts/validate_gamesim.ts.
usage: python3 -I scripts/export_nhl_validation_rows.py out.csv 2025.csv 2026.csv"""
import sys, numpy as np, pandas as pd
sys.path.insert(0, 'scripts'); import fit_nhl_moneypuck as F
F.MIN_TOI = 12.0
out = sys.argv[1]
raw = pd.concat([F.read_any(f) for f in sys.argv[2:]], ignore_index=True); g = F.build_games(raw)
S = sorted(g.season.unique())[-1]
parts = []
real = F.walk_forward_inputs(g, S); real['src'] = 'real'; parts.append((real, F.pos_priors(g, S - 1)))
ps = S - 1; gg = g.copy(); early = (gg.season == ps) & (gg.date < pd.Timestamp(f'{ps + 1}-01-01')); gg.loc[early, 'season'] = ps - 1
pseudo = F.walk_forward_inputs(gg, ps); pseudo['src'] = 'pseudo'; parts.append((pseudo, F.pos_priors(gg, ps - 1)))
rows = []
for cur, prior in parts:
    cur = cur[(cur.priorGp + cur.gp >= 1) & (cur.avg_toi_pre >= 12.0)].copy()
    cur['mu_s'] = F.mu_for(cur, 'sog', 20, 10, prior).values; cur['mu_p'] = F.mu_for(cur, 'pts', 30, 10, prior).values
    rows.append(cur[['src', 'gid', 'team', 'pid', 'pos', 'mu_s', 'mu_p', 'shots', 'points', 'gp']])
d = pd.concat(rows); d['gid'] = d.src + '_' + d.gid.astype(str)
d.to_csv(out, index=False); print(len(d), 'rows,', d.groupby(['gid', 'team']).ngroups, 'team-games ->', out)
