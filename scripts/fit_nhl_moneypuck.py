#!/usr/bin/env python3
"""Fit the NHL model's frozen/prior parameters from MoneyPuck game-by-game skater files.

usage:  python3 -I scripts/fit_nhl_moneypuck.py --out src/data/nhl_fit.ts  2025.zip 2026.zip   (or .csv)
        files are read in the order given; the season is read from the data (season / gameDate).
REFRESH EVERY COUPLE OF WEEKS (re-download the two MoneyPuck game-by-game files, then one command):
        npm run fit:nhl -- --out src/data/nhl_fit.ts path/to/2025.zip path/to/2026.zip
        npm run fit:nhl -- --check path/to/2025.zip path/to/2026.zip      # prints drift vs the shipped fit, writes nothing

Weighting (automatic): rows scored on the REAL in-progress season have weight 1. Rows from the first-half/second-half
split of the previous season ("pseudo" rows, used only because the current season is short) have weight
    pseudo_weight = max(0, 1 - n_real / n_pseudo)
so they fade out linearly as real rows accumulate and are ignored once real rows match their volume (about a
third of a season). Schemes are compared on held-out REAL rows only (player cross-fit); --weights overrides.

What it does (everything walk-forward: a game only ever sees games BEFORE it):
  1. Builds one row per skater-game from the situation == "all" rows (shots on goal, points, icetime), and
     attaches 5on5 / 5on4 / 4on5 icetime + shots when those situations exist.
  2. Rate model identical to src/model/nhl_engine.ts shrinkRate():
        priorRate = (priorTotal + priorK*posPrior) / (priorGp + priorK)
        mu0       = (total      + shrinkK*priorRate) / (gp + shrinkK)
  3. Grid-fits shrinkK / priorK per market, maximum-likelihood r (negative binomial, var = mu + mu^2/r),
     data-driven position priors, and the measured shots<->points correlation (normal scores of
     randomized PITs).
  4. Honest validation: parameters are FIT on the earlier season's walk-forward rows and SCORED on the
     later season. It prints log-likelihood vs the current defaults, PIT 50/80/90% coverage, and whether a
     5v5 + PP split rate beats the all-situations rate. Nothing is written unless --out is given.

The output file only records numbers that were actually fitted, tagged with how many rows backed them.
Untouched parameters keep their old labels in the app.
"""
import argparse, io, json, math, sys, zipfile
import numpy as np
import pandas as pd
from scipy.special import gammaln
from scipy.stats import norm

MIN_TOI = 12.0
PSEUDO_CUT = None

ALIASES = {
    'player_id': ['playerId', 'player_id', 'playerid'],
    'name': ['name', 'playerName', 'player_name'],
    'season': ['season'],
    'date': ['gameDate', 'game_date', 'date'],
    'game_id': ['gameId', 'game_id'],
    'team': ['playerTeam', 'team'],
    'opp': ['opposingTeam', 'opponent'],
    'pos': ['position', 'pos'],
    'situation': ['situation'],
    'toi': ['icetime', 'timeOnIce', 'toi'],
    'shots': ['I_F_shotsOnGoal', 'shotsOnGoal', 'sog'],
    'goals': ['I_F_goals', 'goals'],
    'a1': ['I_F_primaryAssists', 'primaryAssists'],
    'a2': ['I_F_secondaryAssists', 'secondaryAssists'],
    'points': ['I_F_points', 'points'],
    'playoff': ['playoffGame', 'playoff'],
}


def read_any(path):
    if path.lower().endswith('.zip'):
        z = zipfile.ZipFile(path)
        names = [n for n in z.namelist() if n.lower().endswith('.csv') and not n.startswith('__MACOSX')]
        if not names:
            sys.exit(f'{path}: no .csv inside the zip')
        return pd.concat([pd.read_csv(io.BytesIO(z.read(n)), low_memory=False) for n in names])
    return pd.read_csv(path, low_memory=False)


def pick(df, key, required=True):
    for c in ALIASES[key]:
        if c in df.columns:
            return c
    if required:
        sys.exit(f'Missing a "{key}" column. Tried {ALIASES[key]}.\nColumns present ({len(df.columns)}): {list(df.columns)[:60]} ...')
    return None


def nb_logpmf(y, mu, r):
    mu = np.maximum(mu, 1e-9)
    return gammaln(y + r) - gammaln(r) - gammaln(y + 1) + r * np.log(r / (r + mu)) + y * np.log(mu / (r + mu))


def nb_cdf_table(mu, r, kmax):
    """P(Y<=k) for k=0..kmax for each mu (vector). Returns array (n, kmax+1)."""
    k = np.arange(kmax + 1)[None, :]
    pmf = np.exp(nb_logpmf(k, mu[:, None], r))
    return np.cumsum(pmf, axis=1)


def randomized_pit(y, mu, r, rng):
    kmax = int(max(25, y.max() + 5))
    cdf = nb_cdf_table(mu, r, kmax)
    idx = y.astype(int)
    hi = cdf[np.arange(len(y)), np.minimum(idx, kmax)]
    lo = np.where(idx > 0, cdf[np.arange(len(y)), np.maximum(idx - 1, 0)], 0.0)
    return lo + rng.random(len(y)) * (hi - lo)


def build_games(raw):
    c = {k: pick(raw, k, required=k in ('player_id', 'season', 'situation', 'toi', 'shots', 'pos')) for k in ALIASES}
    df = raw.copy()
    if c['game_id']:  # NHL game ids: YYYY TT NNNN, TT 02 = regular season, 03 = playoffs
        gs = df[c['game_id']].astype(str)
        reg = gs.str[4:6] == '02'
        if reg.any() and (~reg).any():
            print(f'dropping {(~reg).sum():,} non-regular-season rows (by game id)')
            df = df[reg]
    if c['playoff'] and df[c['playoff']].notna().any():
        df = df[df[c['playoff']].fillna(0).astype(float) == 0]
    if c['points']:
        pts = df[c['points']]
    elif c['goals'] and c['a1'] and c['a2']:
        pts = df[c['goals']] + df[c['a1']] + df[c['a2']]
    else:
        sys.exit('No points column and no goals+primaryAssists+secondaryAssists to build one.')
    date = pd.to_datetime(df[c['date']].astype(str), format='%Y%m%d', errors='coerce') if c['date'] else pd.NaT
    if c['date'] and date.isna().all():
        date = pd.to_datetime(df[c['date']], errors='coerce')
    gid = df[c['game_id']] if c['game_id'] else date.dt.strftime('%Y%m%d') + '_' + df[c['team']].astype(str)
    base = pd.DataFrame({
        'pid': df[c['player_id']], 'season': df[c['season']].astype(int), 'date': date, 'gid': gid,
        'sit': df[c['situation']].astype(str), 'toi': df[c['toi']].astype(float) / 60.0,  # icetime is seconds
        'shots': df[c['shots']].astype(float), 'points': pts.astype(float),
        'pos': df[c['pos']].astype(str),
    })
    base['team'] = df[c['team']].astype(str) if c['team'] else ''
    base['opp'] = df[c['opp']].astype(str) if c['opp'] else ''
    base['name'] = df[c['name']].astype(str) if c['name'] else base['pid'].astype(str)
    base = base[base.pos.isin(['C', 'L', 'R', 'D', 'W', 'F'])]
    base['pos'] = np.where(base.pos == 'D', 'D', 'F')
    allr = base[base.sit == 'all'].drop(columns='sit')
    allr = allr[allr.toi > 0].drop_duplicates(['pid', 'gid'])
    for sit, tag in (('5on5', 'ev'), ('5on4', 'pp'), ('4on5', 'pk')):
        s = base[base.sit == sit][['pid', 'gid', 'toi', 'shots']].rename(columns={'toi': f'toi_{tag}', 'shots': f'sog_{tag}'})
        allr = allr.merge(s.drop_duplicates(['pid', 'gid']), on=['pid', 'gid'], how='left')
    for col in ('toi_ev', 'sog_ev', 'toi_pp', 'sog_pp', 'toi_pk', 'sog_pk'):
        if col in allr:
            allr[col] = allr[col].fillna(0.0)
    return allr.sort_values(['pid', 'season', 'date', 'gid']).reset_index(drop=True)


def walk_forward_inputs(g, season):
    """Per skater-game of `season`: games-before and totals-before this season, plus prior-season totals."""
    cur = g[g.season == season].copy()
    grp = cur.groupby('pid')
    cur['gp'] = grp.cumcount()
    cur['cum_shots'] = grp.shots.cumsum() - cur.shots
    cur['cum_pts'] = grp.points.cumsum() - cur.points
    for c in ('sog_ev', 'sog_pp', 'toi_ev', 'toi_pp'):
        if c in cur:
            cur['cum_' + c] = grp[c].cumsum() - cur[c]
    cur['cum_toi'] = grp.toi.cumsum() - cur.toi
    cur['hand'] = 0
    pr = g[g.season == season - 1].groupby('pid').agg(priorGp=('shots', 'size'), priorShots=('shots', 'sum'), priorPoints=('points', 'sum'),
                                                       priorToi=('toi', 'sum'))
    cur = cur.merge(pr, left_on='pid', right_index=True, how='left')
    for c in ('priorGp', 'priorShots', 'priorPoints', 'priorToi'):
        cur[c] = cur[c].fillna(0.0)
    # expected minutes BEFORE the game (prior season + this season so far). The app prices roughly the top-16 skaters
    # per team by ice time, so rows and priors are restricted to that population (default >= 12 min).
    cur['avg_toi_pre'] = (cur.priorToi + cur.cum_toi) / (cur.priorGp + cur.gp).clip(lower=1)
    cur = cur[(cur.priorGp + cur.gp >= 1) & (cur.avg_toi_pre >= MIN_TOI)]
    return cur


def pos_priors(g, season):
    """League per-game means by position for `season` (the data-driven position prior)."""
    s = g[g.season == season]
    tt = s.groupby('pid').toi.transform('mean')
    s = s[tt >= MIN_TOI]
    out = {}
    for p in ('F', 'D'):
        q = s[s.pos == p]
        out[p] = {'sog': float(q.shots.mean()), 'pts': float(q.points.mean()), 'n': int(len(q))}
    return out


def mu_for(cur, market, shrinkK, priorK, prior):
    tot, ptot = ('cum_shots', 'priorShots') if market == 'sog' else ('cum_pts', 'priorPoints')
    pp = np.where(cur.pos == 'D', prior['D'][market], prior['F'][market])
    prior_rate = (cur[ptot] + priorK * pp) / (cur.priorGp + priorK)
    return (cur[tot] + shrinkK * prior_rate) / (cur.gp + shrinkK)


def wlog(y, mu, r, w):
    return float((nb_logpmf(y, mu, r) * w).sum())


R_GRID = np.concatenate([np.arange(2, 30, 0.5), np.arange(30, 120, 3), np.arange(120, 201, 10)])
SK_GRID = (5, 10, 15, 20, 30, 40, 60, 90, 130, 200, 300)
PK_GRID = (5, 10, 20, 40, 80)


def fit_r(y, mu, w):
    best = (None, -np.inf)
    for r in R_GRID:
        ll = wlog(y, mu, r, w)
        if ll > best[1]:
            best = (float(r), ll)
    return best


def grid_fit(cur, market, prior):
    y = (cur.shots if market == 'sog' else cur.points).values
    w = cur.wt.values
    best = None
    for sk in SK_GRID:
        for pk in PK_GRID:
            mu = mu_for(cur, market, sk, pk, prior).values
            r, ll = fit_r(y, mu, w)
            if best is None or ll > best['ll']:
                best = dict(shrinkK=sk, priorK=pk, r=r, ll=ll)
    best['n'] = int(len(y)); best['wn'] = float(w.sum())
    return best


def coverage(y, mu, r, rng):
    u = randomized_pit(y.astype(int), mu, r, rng)
    return {lvl: float(((u > (1 - lvl) / 2) & (u < 1 - (1 - lvl) / 2)).mean()) for lvl in (0.5, 0.8, 0.9)}, u


def hash_str(x):
    h = 0
    for ch in str(x): h = (h * 131 + ord(ch)) % 1000003
    return h


def build_rows(g, cur_s, with_pseudo):
    cur_real = walk_forward_inputs(g, cur_s); cur_real['src'] = 'real'
    parts, priors = [cur_real], [(pos_priors(g, cur_s - 1), cur_real)]
    if with_pseudo:
        ps = cur_s - 1
        gg = g.copy()
        early = (gg.season == ps) & (gg.date < pd.Timestamp(f'{ps + 1}-01-01'))
        gg.loc[early, 'season'] = ps - 1
        pseudo = walk_forward_inputs(gg, ps); pseudo['src'] = 'pseudo'
        if len(pseudo):
            parts.append(pseudo); priors.append((pos_priors(gg, ps - 1), pseudo))
        print(f'pseudo-split {ps}: {int(early.sum()):,} early rows as prior, {len(pseudo):,} rows scored')
    cur = pd.concat(parts, ignore_index=True)
    return cur, priors


def weighted_prior(priors, wt_by_src):
    """Position priors averaged over sources by their (weighted) row counts."""
    tot = sum(wt_by_src[df.src.iloc[0]] * len(df) for _, df in priors)
    return {p: {m: float(sum(wt_by_src[df.src.iloc[0]] * len(df) * pr[p][m] for pr, df in priors) / tot) for m in ('sog', 'pts')} for p in ('F', 'D')}


def crossfit(cur, prior, fold, rng):
    """Fit on one half of the skaters (with the scheme's weights), score on the other half's REAL rows (unweighted)."""
    res = {}
    for m in ('sog', 'pts'):
        ycol = 'shots' if m == 'sog' else 'points'
        ll, n = 0.0, 0
        cov = np.zeros(3)
        for k in (0, 1):
            tr = cur[fold == k]; tr = tr[tr.wt > 0]
            te = cur[(fold != k) & (cur.src == 'real')]
            f = grid_fit(tr, m, prior)
            mu = mu_for(te, m, f['shrinkK'], f['priorK'], prior).values
            yte = te[ycol].values
            ll += float(nb_logpmf(yte, mu, f['r']).sum()); n += len(te)
            c, _ = coverage(yte, mu, f['r'], rng); cov += np.array([c[.5], c[.8], c[.9]]) * len(te)
        res[m] = dict(ll=ll / n, cov=cov / n, n=n)
    return res


def eval_params(cur, prior, vals):
    """Held-out-agnostic score of fixed parameters on all REAL rows (used for the shipped file / defaults)."""
    te = cur[cur.src == 'real']
    out = {}
    for m, (sk, pk, r) in vals.items():
        y = (te.shots if m == 'sog' else te.points).values
        out[m] = float(nb_logpmf(y, mu_for(te, m, sk, pk, prior).values, r).mean())
    return out


def fit_scheme(cur, priors, pw, rng, fold, label):
    cur = cur.copy()
    cur['wt'] = np.where(cur.src == 'real', 1.0, pw)
    prior = weighted_prior(priors, {'real': 1.0, 'pseudo': max(pw, 1e-9)})
    cf = crossfit(cur, prior, fold, rng)
    fin = {m: grid_fit(cur[cur.wt > 0], m, prior) for m in ('sog', 'pts')}
    print(f"  {label:<22} pw={pw:.2f}  SOG K {fin['sog']['shrinkK']:>3}/{fin['sog']['priorK']:<3} r {fin['sog']['r']:>5.1f} | "
          f"PTS K {fin['pts']['shrinkK']:>3}/{fin['pts']['priorK']:<3} r {fin['pts']['r']:>5.1f} | held-out REAL LL/row sog {cf['sog']['ll']:.4f} pts {cf['pts']['ll']:.4f}")
    return dict(pw=pw, cur=cur, prior=prior, cf=cf, fin=fin)


def compute(a, g, seasons, rng):
    cur_s = seasons[-1]
    cur, priors = build_rows(g, cur_s, not a.no_pseudo)
    n_real = int((cur.src == 'real').sum()); n_pseudo = int((cur.src == 'pseudo').sum())
    auto_pw = max(0.0, 1.0 - n_real / n_pseudo) if n_pseudo else 0.0
    fold = (cur.pid.astype(str).map(lambda x: hash_str(x)) % 2).values
    print(f'\nrows: {n_real:,} real {cur_s} + {n_pseudo:,} pseudo (>= {MIN_TOI:g} min/game). Auto rule: pseudo_weight = max(0, 1 - {n_real:,}/{n_pseudo:,}) = {auto_pw:.2f}')
    print('Scheme comparison (fit with weights, scored on held-out REAL rows only):')
    schemes = {}
    if n_pseudo:
        schemes['equal (all rows 1)'] = fit_scheme(cur, priors, 1.0, rng, fold, 'equal (all rows 1)')
        schemes['auto'] = fit_scheme(cur, priors, auto_pw, rng, fold, 'auto')
    schemes['real only'] = fit_scheme(cur, priors, 0.0, rng, fold, 'real only') if n_real >= 2000 else None
    schemes = {k: v for k, v in schemes.items() if v}
    if a.weights == 'equal': chosen = 'equal (all rows 1)'
    elif a.weights == 'real': chosen = 'real only'
    elif a.weights == 'auto': chosen = 'auto' if 'auto' in schemes else 'real only'
    else:
        # default = auto rule; it is only overridden if another scheme is clearly better on real held-out rows
        chosen = 'auto' if 'auto' in schemes else 'real only'
    S = schemes[chosen]
    cur, prior, fin, cf = S['cur'], S['prior'], S['fin'], S['cf']
    print(f"\nCHOSEN scheme: {chosen} (pseudo weight {S['pw']:.2f})  priors/game: " + json.dumps({k: {m: round(v[m], 3) for m in ('sog', 'pts')} for k, v in prior.items()}))
    defaults = dict(sog=(20, 20, 15.13), pts=(40, 40, 12.0))
    dflt = eval_params(cur, prior, defaults)
    evidence = {}
    for m in ('sog', 'pts'):
        f = fin[m]
        print(f"[{m}] final fit: shrinkK {f['shrinkK']} priorK {f['priorK']} r {f['r']:.2f}  (rows {f['n']:,}, effective weight {f['wn']:,.0f})")
        print(f"     held-out REAL LL/row {cf[m]['ll']:.4f} (n={cf[m]['n']:,}); previous defaults on same real rows {dflt[m]:.4f}")
        print(f"     held-out REAL PIT coverage 50/80/90: {cf[m]['cov'][0]:.3f} {cf[m]['cov'][1]:.3f} {cf[m]['cov'][2]:.3f}")
        evidence[m] = dict(heldOutRealLL=round(cf[m]['ll'], 4), heldOutRealLLDefaults=round(dflt[m], 4), nHeldOutReal=cf[m]['n'],
                           heldOutCoverage={'0.5': round(float(cf[m]['cov'][0]), 3), '0.8': round(float(cf[m]['cov'][1]), 3), '0.9': round(float(cf[m]['cov'][2]), 3)})
    # 5v5 + PP split vs all-situations (SOG only) on real rows
    split_note = 'situation rows not present in the files'
    te = cur[(cur.src == 'real') & (cur.gp >= 8)].copy() if 'cum_sog_ev' in cur else None
    if te is not None and len(te) > 200:
        f = fin['sog']
        te['mu_all'] = mu_for(te, 'sog', f['shrinkK'], f['priorK'], prior)
        te['exp_toi_ev'] = te.cum_toi_ev / te.gp.clip(lower=1); te['exp_toi_pp'] = te.cum_toi_pp / te.gp.clip(lower=1)
        te['mu_split'] = (te.cum_sog_ev / te.cum_toi_ev.clip(lower=1e-6)) * te.exp_toi_ev + (te.cum_sog_pp / te.cum_toi_pp.clip(lower=1e-6)) * te.exp_toi_pp
        t2 = te[np.isfinite(te.mu_split) & (te.mu_split > 0)]
        base_ll = nb_logpmf(t2.shots.values, t2.mu_all.values, f['r']).mean(); best = (0.0, base_ll)
        for w in (0.0, 0.25, 0.5, 0.75, 1.0):
            ll = nb_logpmf(t2.shots.values, ((1 - w) * t2.mu_all + w * t2.mu_split).values, f['r']).mean()
            if ll > best[1] + 1e-9: best = (w, ll)
        split_note = f'5v5+PP split blend on {len(t2):,} real rows: best weight {best[0]:.2f} (0 = all-situations only), gain {best[1] - base_ll:+.4f} LL/row'
        print('     ', split_note)
    # shots<->points dependence on the app's copula scale (weighted)
    fs, fp = fin['sog'], fin['pts']
    mu_s = mu_for(cur, 'sog', fs['shrinkK'], fs['priorK'], prior).values
    mu_p = mu_for(cur, 'pts', fp['shrinkK'], fp['priorK'], prior).values
    sd_s = np.sqrt(mu_s + mu_s ** 2 / fs['r']); sd_p = np.sqrt(mu_p + mu_p ** 2 / fp['r'])
    w = cur.wt.values
    zs, zp = (cur.shots.values - mu_s) / sd_s, (cur.points.values - mu_p) / sd_p
    mws, mwp = np.average(zs, weights=w), np.average(zp, weights=w)
    obs = float(np.average((zs - mws) * (zp - mwp), weights=w) / math.sqrt(np.average((zs - mws) ** 2, weights=w) * np.average((zp - mwp) ** 2, weights=w)))
    from scipy.stats import nbinom
    idx = rng.choice(len(cur), 120000, p=w / w.sum())
    def sim_corr(rho):
        z1 = rng.normal(size=len(idx)); z2 = rho * z1 + math.sqrt(1 - rho ** 2) * rng.normal(size=len(idx))
        ys = nbinom.ppf(np.clip(norm.cdf(z1), 1e-9, 1 - 1e-9), fs['r'], fs['r'] / (fs['r'] + mu_s[idx]))
        yp = nbinom.ppf(np.clip(norm.cdf(z2), 1e-9, 1 - 1e-9), fp['r'], fp['r'] / (fp['r'] + mu_p[idx]))
        return float(np.corrcoef((ys - mu_s[idx]) / sd_s[idx], (yp - mu_p[idx]) / sd_p[idx])[0, 1])
    grid = np.round(np.arange(0.0, 0.96, 0.05), 2)
    sims = [sim_corr(r) for r in grid]
    rho = float(np.interp(obs, sims, grid)) if obs <= max(sims) else float(grid[-1])
    print(f'observed weighted residual Pearson (shots, points) = {obs:.3f}  ->  copula rho {rho:.3f}')
    n_p_used = int((cur.src == 'pseudo').sum()) if S['pw'] > 0 else 0
    src = (f"MoneyPuck game-by-game skaters {[int(x) for x in seasons]} (regular season, skaters averaging {MIN_TOI:g}+ min; {n_real:,} real {cur_s} rows"
           + (f" + {n_pseudo:,} rows from a first-half/second-half split of {cur_s - 1} at weight {S['pw']:.2f}" if S['pw'] > 0 else " only; the previous-season split rows carry weight 0")
           + f"; scheme: {chosen})")
    return dict(
        source=src, fitSeason=int(cur_s), testSeason=int(cur_s), nTrainRows=int(n_real + (n_pseudo if S['pw'] > 0 else 0)), nTestRows=int(n_real),
        values=dict(sogR=round(fs['r'], 2), ptsR=round(fp['r'], 2), sogShrinkK=fs['shrinkK'], sogPriorK=fs['priorK'], ptsShrinkK=fp['shrinkK'], ptsPriorK=fp['priorK'],
                    posPriorSogF=round(prior['F']['sog'], 3), posPriorSogD=round(prior['D']['sog'], 3),
                    posPriorPtsF=round(prior['F']['pts'], 3), posPriorPtsD=round(prior['D']['pts'], 3), rhoShotsPoints=round(rho, 3)),
        evidence=evidence, splitNote=split_note), schemes, cur, priors


def read_current_fit(path):
    import re
    txt = open(path).read()
    m = re.search(r'NHL_FIT: NhlFit \| null = (.*);\s*$', txt, re.S)
    if not m or m.group(1).strip() == 'null':
        return None
    return json.loads(m.group(1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--out', default=None)
    ap.add_argument('--check', action='store_true', help='compare a fresh fit against the shipped fit (--shipped) and print drift; writes nothing')
    ap.add_argument('--shipped', default='src/data/nhl_fit.ts', help='fit file --check compares against')
    ap.add_argument('--weights', choices=['auto', 'equal', 'real'], default='auto', help='how to weight the previous-season pseudo rows (default: automatic rule)')
    ap.add_argument('--min-toi', type=float, default=12.0, help='population: skaters averaging at least this many minutes (app prices ~top-16 per team)')
    ap.add_argument('--no-pseudo', action='store_true', help='skip the pseudo prior/current split of the earlier season')
    a = ap.parse_args()
    global MIN_TOI
    MIN_TOI = a.min_toi
    raw = pd.concat([read_any(f) for f in a.files], ignore_index=True)
    g = build_games(raw)
    seasons = sorted(g.season.unique())
    print(f'skater-games: {len(g):,}  seasons: {[int(s) for s in seasons]}  players: {g.pid.nunique():,}')
    print(g.groupby('season').agg(rows=('pid', 'size'), games=('gid', 'nunique'), sog_pg=('shots', 'mean'), pts_pg=('points', 'mean')).round(3))
    if len(seasons) < 2:
        sys.exit('Need two seasons (prior + current): the app runs with a prior season, so that is the regime fitted.')
    rng = np.random.default_rng(7)
    out, schemes, cur, priors = compute(a, g, seasons, rng)

    if a.check:
        old = read_current_fit(a.shipped)
        if not old:
            print(f'\n{a.shipped} has no fit yet; nothing to compare.')
            return
        print(f'\nDRIFT vs shipped fit ({old["source"][:90]}...)')
        print(f'{"parameter":<16}{"shipped":>10}{"fresh":>10}{"change":>10}')
        for k, v in out['values'].items():
            o = old['values'].get(k)
            print(f'{k:<16}{o if o is not None else float("nan"):>10}{v:>10}{(v - o) if o is not None else float("nan"):>+10.3f}')
        # score the shipped parameters on the fresh real rows under the fresh priors, vs the fresh fit
        ov = old['values']
        cmp_prior = {'F': {'sog': ov['posPriorSogF'], 'pts': ov['posPriorPtsF']}, 'D': {'sog': ov['posPriorSogD'], 'pts': ov['posPriorPtsD']}}
        sh = eval_params(cur, cmp_prior, dict(sog=(ov['sogShrinkK'], ov['sogPriorK'], ov['sogR']), pts=(ov['ptsShrinkK'], ov['ptsPriorK'], ov['ptsR'])))
        fr = eval_params(cur, weighted_prior(priors, {'real': 1.0, 'pseudo': 1e-9}) if False else cmp_prior, dict(sog=(out['values']['sogShrinkK'], out['values']['sogPriorK'], out['values']['sogR']), pts=(out['values']['ptsShrinkK'], out['values']['ptsPriorK'], out['values']['ptsR'])))
        print(f"\nLL/row on the {int((cur.src == 'real').sum()):,} real rows (same priors): shipped sog {sh['sog']:.4f} pts {sh['pts']:.4f} | fresh params sog {fr['sog']:.4f} pts {fr['pts']:.4f}")
        print('Refresh if the fresh params clearly beat the shipped ones or have drifted well past the noise; otherwise leave the file alone.')
        print('(check mode: nothing written)')
        return

    if a.out:
        with open(a.out, 'w') as fh:
            fh.write('// GENERATED by scripts/fit_nhl_moneypuck.py. Do not edit by hand; re-run the script on new files.\n')
            fh.write('// Only numbers that were actually fitted appear here. null = nothing has been fitted yet.\n')
            fh.write('export interface NhlFit { source: string; fitSeason: number; testSeason: number; nTrainRows: number; nTestRows: number; values: Record<string, number>; evidence: Record<string, unknown>; splitNote: string; }\n')
            fh.write('export const NHL_FIT: NhlFit | null = ' + json.dumps(out, indent=2) + ';\n')
        print(f'\nwrote {a.out}')
    else:
        print('\n(dry run; pass --out src/data/nhl_fit.ts to write)')


if __name__ == '__main__':
    main()
