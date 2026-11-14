"""NFL teammate absence + recent form, rebuilt properly (Update 4). Run: python3 -I nfl_absence_form_v2.py [dataDir]
Baseline = v1.5 walk-forward mu from bt_rows.csv (scripts/dump_nfl_rows.ts). Every feature uses only information
available BEFORE the game (trailing games of the same season; injury report status). Evaluation: pooled blocked CV
(leave-one-block-out, blocks = 3-week blocks within season, pooled 2024-2026), negative-binomial log-lik per row,
cluster bootstrap (team-week clusters) CI on the delta, and per-season deltas."""
import sys, re, numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln
D = (sys.argv[1] if len(sys.argv) > 1 else '/home/claude/data') + '/'
NORM = {'LA': 'LAR', 'JAC': 'JAX', 'WSH': 'WAS', 'OAK': 'LV', 'SD': 'LAC', 'STL': 'LAR'}
nt = lambda t: NORM.get(t, t)
def key(x): return re.sub(r'[^a-z]', '', re.sub(r'\b(jr|sr|ii|iii|iv|v)\b\.?', '', str(x).lower()))

# ---------- stats: trailing per player-season ----------
S = pd.concat([pd.read_csv(D + f'stats_player_week_{y}.csv', usecols=['player_id', 'player_display_name', 'position', 'season', 'week', 'season_type', 'team', 'targets', 'receptions']) for y in (2024, 2025, 2026)])
S = S[S.season_type == 'REG'].copy(); S['team'] = S.team.map(nt); S['key'] = S.player_display_name.map(key)
S = S.sort_values(['player_id', 'season', 'week']).reset_index(drop=True)
G = pd.read_csv(D + 'games.csv'); G = G[G.game_type == 'REG']
team_weeks = {}  # (season, team) -> sorted weeks played
for r in G.itertuples():
    for t in (nt(r.home_team), nt(r.away_team)): team_weeks.setdefault((r.season, t), []).append(r.week)
for k in team_weeks: team_weeks[k].sort()
def prev_week(season, team, w):
    ws = [x for x in team_weeks.get((season, team), []) if x < w]; return ws[-1] if ws else None

# trailing record per (player, season, W): last 4 games before W
recs = []
for (pid, seas), g in S.groupby(['player_id', 'season']):
    wk = g.week.values; tg = g.targets.values; rc = g.receptions.values; tm = g.team.values; ky = g.key.values; ps = g.position.values
    for W in range(2, 19):
        idx = [i for i in range(len(g)) if wk[i] < W][-4:]
        if len(idx) >= 3: recs.append((pid, seas, W, tm[idx[-1]], ky[idx[-1]], ps[idx[-1]], float(np.mean(tg[idx])), len(idx), int(wk[idx[-1]])))
R = pd.DataFrame(recs, columns=['pid', 'season', 'W', 'team', 'key', 'pos', 'tavg', 'k', 'last_wk'])
R = R[R.tavg >= 3.0]  # relevant pass-catchers only (as specified)

# ---------- absence sources ----------
N = pd.concat([pd.read_csv(D + f'snap_counts_{y}.csv', usecols=['season', 'week', 'game_type', 'player', 'team', 'offense_snaps']) for y in (2024, 2025, 2026)])
N = N[N.game_type == 'REG'].copy(); N['team'] = N.team.map(nt); N['key'] = N.player.map(key)
snapmap = {(a, b, c, d): e for a, b, c, d, e in zip(N.season, N.week, N.team, N.key, N.offense_snaps)}
INJ = pd.concat([pd.read_csv(D + f'injuries_{y}.csv', usecols=['season', 'week', 'gsis_id', 'report_status']) for y in (2024, 2025, 2026)])
inj_out = set(zip(INJ[INJ.report_status == 'Out'].season, INJ[INJ.report_status == 'Out'].week, INJ[INJ.report_status == 'Out'].gsis_id))
inj_doubt = set(zip(INJ[INJ.report_status == 'Doubtful'].season, INJ[INJ.report_status == 'Doubtful'].week, INJ[INJ.report_status == 'Doubtful'].gsis_id))
R['pw'] = [prev_week(s, t, w) for s, t, w in zip(R.season, R.team, R.W)]
R['fresh'] = (R.last_wk == R.pw)  # played in the team's previous game => absence NOT yet absorbed by recent route share
R['abs_snap'] = [snapmap.get((s, w, t, k), 999) < 10 for s, w, t, k in zip(R.season, R.W, R.team, R.key)]  # hindsight ceiling; unmatched = present
R['abs_out'] = [(s, w, p) in inj_out for s, w, p in zip(R.season, R.W, R.pid)]
R['abs_oud'] = R.abs_out | np.array([(s, w, p) in inj_doubt for s, w, p in zip(R.season, R.W, R.pid)])
R['window'] = R.last_wk >= (R.W - 4)  # still relevant (played within ~4 weeks)
Rw = R[R.window]
tot = Rw.groupby(['season', 'W', 'team']).tavg.sum().rename('tot')
def lost(mask, extra=None):
    m = Rw[mask.loc[Rw.index]] if extra is None else Rw[mask.loc[Rw.index] & extra.loc[Rw.index]]
    return m.groupby(['season', 'W', 'team']).tavg.sum()
feat = pd.DataFrame(tot)
for name, mask in (('snap', R.abs_snap), ('out', R.abs_out), ('oud', R.abs_oud)):
    feat['L_' + name] = lost(mask); feat['Lf_' + name] = lost(mask, R.fresh)
    feat['Lwr_' + name] = lost(mask, R.pos.isin(['WR', 'TE'])); feat['Lrb_' + name] = lost(mask, R.pos == 'RB')
    feat['Lwrf_' + name] = lost(mask, R.pos.isin(['WR', 'TE']) & R.fresh)
feat = feat.fillna(0).reset_index().rename(columns={'W': 'week'})
g = lambda L, T: -np.log(1 - np.minimum(L / T.clip(lower=1), 0.6))  # proportional redistribution factor on remaining receivers
for c in [c for c in feat.columns if c.startswith('L')]: feat['g' + c] = g(feat[c], feat.tot)

# ---------- backtest rows + form ----------
bt = pd.read_csv(D + 'bt_rows.csv'); bt['team'] = bt.team.map(nt); bt['key'] = bt.name.map(key)
bt = bt.merge(feat, on=['season', 'week', 'team'], how='left'); bt['tot'] = bt.tot.fillna(0)
for c in [c for c in bt.columns if c.startswith('gL')]: bt[c] = bt[c].fillna(0.0)
S['r_prev'] = None
rows = []
for (pid, seas), gg in S.groupby(['player_id', 'season']):
    wk = gg.week.values; rc = gg.receptions.values
    for i in range(len(gg)):
        prev = rc[max(0, i - 3):i]
        rows.append((seas, int(wk[i]), gg.key.iloc[i], gg.team.iloc[i], float(np.sum(prev)) if len(prev) else np.nan, len(prev)))
F = pd.DataFrame(rows, columns=['season', 'week', 'key', 'team', 'rsum', 'm']).drop_duplicates(['season', 'week', 'key', 'team'])
bt = bt.merge(F, on=['season', 'week', 'key', 'team'], how='left')
bt = bt[bt.m >= 2].copy().reset_index(drop=True)
for K0 in (0, 2, 4, 8):
    rshr = (bt.rsum + K0 * bt.mu) / (bt.m + K0)
    bt[f'F{K0}'] = np.log((rshr + .5) / (bt.mu + .5))
    bt[f'Fd{K0}'] = bt[f'F{K0}'] - bt.groupby(['season', 'week'])[f'F{K0}'].transform('mean')  # cross-sectionally demeaned (removes level shift)
bt['Fg'] = bt.F2 / (1 + bt.games)  # form x games-played interaction
bt['blk'] = bt.season * 100 + (bt.week - 3) // 3
bt['cl'] = bt.season * 1000 + bt.week * 40 + pd.factorize(bt.team)[0]
ALPHA = {'WR': 0.10, 'TE': 0.125}
alpha_eff = bt.pos.map(ALPHA).values * (1 + 2.5 / bt.games.values)
def ll(y, mu, a): r = 1 / a; return gammaln(y + r) - gammaln(r) - gammaln(y + 1) + r * np.log(r / (r + mu)) + y * np.log(mu / (r + mu))
def fit(idx, cols, lam=20.0):
    X = bt.loc[idx, cols].values; y = bt.actual.values[idx]; m0 = bt.mu.values[idx]; a = alpha_eff[idx]
    return minimize(lambda b: -ll(y, m0 * np.exp(X @ b), a).sum() + lam * (b @ b), np.zeros(len(cols)), method='L-BFGS-B').x
def cv(cols, lam=20.0):
    """blocked leave-one-block-out; returns per-row delta LL (new - baseline) and coefficient mean"""
    d = np.zeros(len(bt)); coefs = []
    blk = bt.blk.values
    for b in np.unique(blk):
        te = np.where(blk == b)[0]; tr = np.where(blk != b)[0]
        c = fit(tr, cols, lam); coefs.append(c)
        mu1 = bt.mu.values[te] * np.exp(bt.loc[bt.index[te], cols].values @ c)
        d[te] = ll(bt.actual.values[te], mu1, alpha_eff[te]) - ll(bt.actual.values[te], bt.mu.values[te], alpha_eff[te])
    return d, np.mean(coefs, axis=0)
rng = np.random.default_rng(3)
def boot(d, B=1000):
    s = pd.Series(d).groupby(bt.cl.values).agg(['sum', 'count']); n = len(s); sums = s['sum'].values; cnt = s['count'].values
    out = []
    for _ in range(B):
        i = rng.integers(0, n, n); out.append(sums[i].sum() / cnt[i].sum())
    return np.percentile(out, [2.5, 97.5])
def report(label, cols, lam=20.0):
    d, c = cv(cols, lam); lo, hi = boot(d)
    per = {s: d[(bt.season == s).values].mean() for s in (2024, 2025, 2026)}
    ok = lo > 0 and all(v > 0 for v in per.values())
    print(f'{label:34s} n={len(d)} dLL/row {d.mean():+.5f} CI[{lo:+.5f},{hi:+.5f}] 24 {per[2024]:+.5f} 25 {per[2025]:+.5f} 26 {per[2026]:+.5f} coef {np.round(c, 3)} {"ADOPT?" if ok else ""}')
    return ok
if __name__ == '__main__':
    print('rows', len(bt), '| team-weeks with any absence: snap %.3f out %.3f oud %.3f' % tuple((bt.drop_duplicates('cl')[f'L_{k}'] > 0).mean() for k in ('snap', 'out', 'oud')))
    print('actual/mu by 2026 week:', bt[bt.season == 2026].groupby('week').apply(lambda x: round(x.actual.sum() / x.mu.sum(), 3), include_groups=False).to_dict())
    print('\n== ABSENCE (share-weighted redistribution factor g = -log(1-L/total))')
    for src in ('snap', 'out', 'oud'):
        report(f'all absent [{src}]', [f'gL_{src}'])
        report(f'fresh absent [{src}]', [f'gLf_{src}'])
        report(f'WR/TE fresh + RB fresh [{src}]', [f'gLwrf_{src}', f'gLrb_{src}'])
        report(f'fresh + stale [{src}]', [f'gLf_{src}', f'gL_{src}'])
    print('\n== RECENT FORM (shrunk toward mu with K0 pseudo-games; d = cross-sectionally demeaned)')
    for K0 in (0, 2, 4, 8):
        report(f'form K0={K0}', [f'F{K0}']); report(f'form demeaned K0={K0}', [f'Fd{K0}'])
    report('form K0=2 + games interaction', ['F2', 'Fg'])
    print('\n== COMBINED'); report('fresh out + form d4', ['gLf_out', 'Fd4'])

    # ---------- diagnostics ----------
    print('\n== DIAGNOSIS: why the first absence test failed')
    # inactive players have NO row in snap_counts at all. "unmatched = present" therefore hid exactly the real absences.
    stats_rows = set(zip(S.season, S.week, S.team, S.key))
    snap_team_weeks = set(zip(N.season, N.week, N.team))
    R['abs_norow'] = [((s, w, t, k) not in snapmap) and ((s, w, t, k) not in stats_rows) and ((s, w, t) in snap_team_weeks) for s, w, t, k in zip(R.season, R.W, R.team, R.key)]
    print('share of relevant pass-catcher-weeks flagged absent: snap<10 %.3f | no snap row & no stat row %.3f | injury Out %.3f | Out/Doubtful %.3f' % (R.abs_snap.mean(), R.abs_norow.mean(), R.abs_out.mean(), R.abs_oud.mean()))
    print('agreement: of injury-Out players, fraction with no snap row: %.3f; with snaps>=10: %.3f' % (R[R.abs_out].abs_norow.mean(), np.mean([snapmap.get((s, w, t, k), 0) >= 10 for s, w, t, k in zip(R[R.abs_out].season, R[R.abs_out].W, R[R.abs_out].team, R[R.abs_out].key)])))
    R['abs_hind'] = R.abs_snap | R.abs_norow
    Rw2 = R[R.window]; l2 = Rw2[Rw2.abs_hind].groupby(['season', 'W', 'team']).tavg.sum().rename('L_hind').reset_index().rename(columns={'W': 'week'})
    tmp = bt.merge(l2, on=['season', 'week', 'team'], how='left'); tmp['L_hind'] = tmp.L_hind.fillna(0)
    totv = bt[['season', 'week', 'team', 'tot']].drop_duplicates(['season', 'week', 'team'])
    bt['gL_hind'] = -np.log(1 - np.minimum(tmp.L_hind.values / bt.tot.clip(lower=1).values, 0.6))
    report('hindsight absent (no snap/stat row)', ['gL_hind'])
    print('\n== magnitude: baseline actual/mu by lost target share (oud) -- is the miss real and sized as the coefficient says?')
    bt['Lshare_oud'] = bt.L_oud / bt.tot.clip(lower=1)
    bins = pd.cut(bt.Lshare_oud, [-0.01, 0, 0.1, 0.2, 0.35, 1.0])
    print(bt.groupby(bins, observed=True).apply(lambda x: pd.Series(dict(n=len(x), actual_over_mu=round(x.actual.sum() / x.mu.sum(), 3), implied_factor=round(float(np.mean(np.exp(0.6 * x.gL_oud))), 3))), include_groups=False))
    print('\n== position check (absence oud, per-position coefficient, in-sample ridge)')
    for p in ('WR', 'TE'):
        idx = np.where(bt.pos.values == p)[0]; c = fit(idx, ['gL_oud']); print(p, 'n', len(idx), 'coef', np.round(c, 3))
    print('\n== form: is the 2026 loss distinguishable from zero? (K0=4, blocked-CV deltas, 2026 rows only)')
    d, _ = cv(['F4']); m26 = (bt.season == 2026).values
    s = pd.Series(d[m26]).groupby(bt.cl.values[m26]).agg(['sum', 'count']); sums, cnt = s['sum'].values, s['count'].values
    bs = [sums[i].sum() / cnt[i].sum() for i in (rng.integers(0, len(sums), len(sums)) for _ in range(1000))]
    print('2026 dLL/row %+.5f  95%% CI [%+.5f, %+.5f]  n=%d (%d team-weeks)' % (d[m26].mean(), *np.percentile(bs, [2.5, 97.5]), m26.sum(), len(sums)))
    print('2026 form coefficient fit on 2026 only (in-sample): %s ; on 2024-25: %s' % (np.round(fit(np.where(m26)[0], ['F4']), 3), np.round(fit(np.where(~m26)[0], ['F4']), 3)))
