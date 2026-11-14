"""Fit the NBA model (nba_v2) and write src/data/nba_fit.ts. Everything walk-forward; held-out = leave-one-season-out.
usage: python3 -I scripts/nba/fit_nba.py [dir] [--out src/data/nba_fit.ts] [--export-parity src/model/fixtures/nba_parity.json]
Population: everyone the desk lists (projected minutes >= 14), seven markets (pts reb ast tpm pra stl blk).
Model (mirrored exactly by src/model/nba_engine.ts and parity-tested against rows exported here):
  prior_rate = (prior_k + PK*pos_rate_k)/(priorMin + PK);   rate = (cum_k + K*kMult_g*prior_rate)/(cum_min + K*kMult_g)     per MINUTE
  pm_k = W*last5 + (1-W)*season_avg (KM games toward last season / position minutes);  pmR = pm of the points params (drives r)
  mu   = rate * pm_k * exp(oppCoef*log(opp_allowed_factor)) * exp(absCoef*L + absSlope*L*(pmR/30-1)) * lvl_g(gp)
  lvl_g(gp) = 1 - (1-lvl)*max(0, 1-gp/20)                  (group g = vet | changer | new)
  Y ~ NegBin(mu, r),  r = rScale_g * rA * (max(pmR,5)/30)^rB
Groups: new = fewer than 20 games last season; changer = 20+ last season but a different team than last season's last team; vet = the rest.
"""
import sys, json, argparse, itertools, numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.stats import nbinom, norm
sys.path.insert(0, 'scripts/nba')
ap = argparse.ArgumentParser(); ap.add_argument('dir', nargs='?', default='/home/claude/nbadata'); ap.add_argument('--out'); ap.add_argument('--export-parity'); ap.add_argument('--quick', action='store_true'); a = ap.parse_args()
sys.argv = [sys.argv[0], a.dir]
import nba_features_test as T
import nba_variants as V
import nba_data as D
from nba_variants import nb_ll
F, PRM, SEASONS = T.F.reset_index(drop=True), T.PRM, T.SEASONS
MK = list(D.STATS); OPP_K = 10; LVL_DECAY = 20.0; NEW_FIT_MIN_GP = 3
F['pmR'] = V.minutes_proj(F, PRM['pts']['KM'], PRM['pts']['W']).values
F['x'] = F.pmR / 30.0 - 1.0
for k in MK:
    F['pm_' + k] = V.minutes_proj(F, PRM[k]['KM'], PRM[k]['W']).values
    F['prate_' + k] = (F['prior_' + k] + PRM[k]['PK'] * F['pr_rate_' + k]) / (F.priorMin + PRM[k]['PK'])
F['lvl_w'] = np.clip(1.0 - F.gp / LVL_DECAY, 0, 1)
F['Lx'] = F.L_inj * F.x

def mu_of(df, k, p, g):
    """p: dict(oc, ac, as_) ; g: dict(kMult, lvl)"""
    ke = PRM[k]['K'] * g['kMult']
    rate = (df['cum_' + k] + ke * df['prate_' + k]) / (df.cum_min + ke)
    base = rate * df['pm_' + k]
    return base.values * np.exp(p['oc'] * df[f'of_{k}_{OPP_K}'].values + p['ac'] * df.L_inj.values + p['as'] * df.Lx.values) * (1 - (1 - g['lvl']) * df.lvl_w.values)
def r_of(df, rp, scale=1.0): return scale * rp[0] * (np.maximum(df.pmR.values, 5) / 30.0) ** rp[1]
G0 = dict(kMult=1.0, lvl=1.0)
def fit_coefs(df, k, rvec_or_scalar):
    y = df[k].values
    f = lambda b: -nb_ll(y, mu_of(df, k, dict(oc=b[0], ac=b[1], **{'as': b[2]}), G0), rvec_or_scalar).sum() + 5.0 * (b @ b)
    b = minimize(f, [0.5, 0.1, 0.0], method='L-BFGS-B').x
    return dict(oc=b[0], ac=b[1], **{'as': b[2]})
RA = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 18, 22, 28, 40, 60]; RB = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4]
def fit_r(df, k, p):
    y = df[k].values; mu = mu_of(df, k, p, G0); best = (None, -1e18)
    for rA, rB in itertools.product(RA, RB):
        ll = nb_ll(y, mu, r_of(df, (rA, rB))).mean()
        if ll > best[1]: best = ((rA, rB), ll)
    return best[0]
def fit_base(df, k):
    p = fit_coefs(df, k, PRM[k]['r']); rp = fit_r(df, k, p)
    p = fit_coefs(df, k, r_of(df, rp)); rp = fit_r(df, k, p)
    return p, rp
KMULT = [0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5]; RSC = [0.65, 0.8, 1.0, 1.25]; LVL = [0.8, 0.85, 0.9, 0.95, 1.0]
def fit_group(df, k, p, rp):
    y = df[k].values; best = None
    for km, rs, lv in itertools.product(KMULT, RSC, LVL):
        ll = nb_ll(y, mu_of(df, k, p, dict(kMult=km, lvl=lv)), r_of(df, rp, rs)).mean()
        if best is None or ll > best[0]: best = (ll, dict(kMult=km, rScale=rs, lvl=lv))
    return best[1]
def pit_cov(y, mu, r, rng):
    pr = r / (r + mu); lo = np.where(y > 0, nbinom.cdf(y - 1, r, pr), 0.0); hi = nbinom.cdf(y, r, pr)
    u = lo + rng.random(len(y)) * (hi - lo)
    return np.array([((u > (1 - l) / 2) & (u < 1 - (1 - l) / 2)).mean() for l in (0.5, 0.8, 0.9)])

rng = np.random.default_rng(5)
GROUPS = ['vet', 'changer', 'new']
ho_mu = {k: np.full(len(F), np.nan) for k in MK}; ho_r = {k: np.full(len(F), np.nan) for k in MK}
ho_v1 = {k: np.full(len(F), np.nan) for k in MK}; v1_r = {k: np.full(len(F), np.nan) for k in MK}
fold_groups = {k: {} for k in MK}
for k in MK:
    for s in SEASONS:
        tr, te = F[F.season != s], F[F.season == s]
        # --- v1: one pooled fit, no groups, no slope (what shipped in Update 5) ---
        pa = fit_coefs(tr, k, PRM[k]['r']); pa['as'] = 0.0
        yb = tr[k].values
        pv = lambda b: -nb_ll(yb, mu_of(tr, k, dict(oc=b[0], ac=b[1], **{'as': 0.0}), G0), PRM[k]['r']).sum() + 5.0 * (b @ b)
        b = minimize(pv, [0.5, 0.1], method='L-BFGS-B').x; pa = dict(oc=b[0], ac=b[1], **{'as': 0.0}); rpa = fit_r(tr, k, pa)
        ho_v1[k][te.index] = mu_of(te, k, pa, G0); v1_r[k][te.index] = r_of(te, rpa)
        # --- v2 ---
        vt = tr[tr.group == 'vet']; p, rp = fit_base(vt, k)
        gp_ = {'vet': dict(kMult=1.0, rScale=1.0, lvl=1.0)}
        for g in ('changer', 'new'):
            d = tr[(tr.group == g) & ((tr.gp >= NEW_FIT_MIN_GP) if g == 'new' else True)]; gp_[g] = fit_group(d, k, p, rp)
        fold_groups[k][s] = gp_
        for g in GROUPS:
            m = (te.group == g).values; d = te[m]
            ho_mu[k][d.index] = mu_of(d, k, p, dict(kMult=gp_[g]['kMult'], lvl=gp_[g]['lvl'])); ho_r[k][d.index] = r_of(d, rp, gp_[g]['rScale'])
    print(f'[{k}] folds done', flush=True)

# ------------------ evidence: held-out LL by group, and coverage by group x games played ------------------
F['gb'] = pd.cut(F.gp, [-1, 2, 4, 9, 19, 39, 200], labels=['0-2', '3-4', '5-9', '10-19', '20-39', '40+'])
evidence = {}; report_lines = []
for k in MK:
    y = F[k].values; naive = np.where(F.gp > 0, F['cum_' + k] / F.gp.clip(lower=1), F['prate_' + k] * F['pm_' + k]); naive = np.maximum(naive, 0.05)
    ll2 = nb_ll(y, ho_mu[k], ho_r[k]); ll1 = nb_ll(y, ho_v1[k], v1_r[k]); lln = nb_ll(y, naive, PRM[k]['r'])
    ev = dict(heldOutLL={'v2': round(ll2.mean(), 4), 'v1': round(ll1.mean(), 4), 'naive': round(lln.mean(), 4)}, byGroup={}, coverage={})
    for g in GROUPS:
        m = (F.group == g).values
        ev['byGroup'][g] = dict(n=int(m.sum()), v2=round(ll2[m].mean(), 4), v1=round(ll1[m].mean(), 4), ratio=round(F[k].values[m].mean() / ho_mu[k][m].mean(), 3))
        for b in F.gb.cat.categories:
            mm = m & (F.gb == b).values
            if mm.sum() < 120: continue
            ev['coverage'][f'{g}|{b}'] = dict(n=int(mm.sum()), cov=[round(float(x), 3) for x in pit_cov(y[mm], ho_mu[k][mm], ho_r[k][mm], rng)], ratio=round(y[mm].mean() / ho_mu[k][mm].mean(), 3),
                                              v1cov=[round(float(x), 3) for x in pit_cov(y[mm], ho_v1[k][mm], v1_r[k][mm], rng)], v1ratio=round(y[mm].mean() / ho_v1[k][mm].mean(), 3))
    ev['coverageAll'] = [round(float(x), 3) for x in pit_cov(y, ho_mu[k], ho_r[k], rng)]
    evidence[k] = ev
    print(f"\n[{k}] held-out LL/row  v2 {ev['heldOutLL']['v2']}  v1 {ev['heldOutLL']['v1']}  naive {ev['heldOutLL']['naive']}   coverage 50/80/90 {ev['coverageAll']}")
    for g in GROUPS: print(f"     {g:8s} {ev['byGroup'][g]}")
    if k in ('pts', 'reb', 'ast', 'tpm'):
        for key, v in ev['coverage'].items():
            if key.startswith(('new|', 'changer|')): print(f"       {key:14s} n={v['n']:5d} v2 cov {v['cov']} ratio {v['ratio']}   | v1 cov {v['v1cov']} ratio {v['v1ratio']}")

# ------------------ final fit on all data ------------------
fitted = {}
for k in MK:
    p, rp = fit_base(F[F.group == 'vet'], k); groups = {'vet': dict(kMult=1.0, rScale=1.0, lvl=1.0)}
    for g in ('changer', 'new'):
        d = F[(F.group == g) & ((F.gp >= NEW_FIT_MIN_GP) if g == 'new' else True)]; groups[g] = fit_group(d, k, p, rp)
    fitted[k] = dict(K=PRM[k]['K'], PK=PRM[k]['PK'], KM=PRM[k]['KM'], W=PRM[k]['W'], oppCoef=round(float(p['oc']), 3), absCoef=round(float(p['ac']), 3), absSlope=round(float(p['as']), 3),
                     rA=rp[0], rB=rp[1], groups=groups)
    print(f"[{k}] final: opp {p['oc']:.3f} abs {p['ac']:.3f} slope {p['as']:.3f}  r={rp[0]}*(pm/30)^{rp[1]}  groups {groups}")
pri = D.pos_group_priors(T.p, 2026)
priors = {pos: {'rate': {k: round(v[k], 5) for k in MK}, 'min': round(v['min'], 2)} for pos, v in pri.items()}

# absorbed minutes diagnostic (points multiplier): how much of the lost rotation minutes the listed teammates take up
q = fitted['pts']; sub = F[F.L_inj > 0]
lift = np.exp(q['absCoef'] * sub.L_inj + q['absSlope'] * sub.Lx) - 1
absorbed = (lift * sub['pm_pts']).groupby([sub.game_id, sub.team]).sum() / (sub.groupby(['game_id', 'team']).L_inj.first() * 100)
print(f'\nabsorbed share of lost rotation minutes implied by the points lift (listed teammates only): median {absorbed.median():.2f}  mean {absorbed.mean():.2f}')

# ------------------ correlations on the copula scale (held-out residuals) ------------------
def std_res(k): mu = ho_mu[k]; r = ho_r[k]; return (F[k].values - mu) / np.sqrt(mu + mu * mu / r)
E = {k: std_res(k) for k in MK}
crng = np.random.default_rng(11)
key = F.game_id.astype(str) + '|' + F.team; opp_key = F.game_id.astype(str) + '|' + F.opp
grp_idx = {}
for i, kk in enumerate(key.values): grp_idx.setdefault(kk, []).append(i)
def partners(rel, per=2):
    I, J = [], []
    for i in range(len(F)):
        pool = grp_idx.get(key.values[i] if rel == 'team' else opp_key.values[i], [])
        if rel == 'team': pool = [j for j in pool if j != i]
        if not pool: continue
        for j in crng.choice(pool, size=min(per, len(pool)), replace=False): I.append(i); J.append(j)
    return np.array(I), np.array(J)
from scipy.special import owens_t
def bvn_cdf(h, k, rho):
    """standard bivariate normal CDF (Owen's T identity); vectorised, checked against scipy.stats.multivariate_normal"""
    h = np.where(np.abs(h) < 1e-9, 1e-9, h); k = np.where(np.abs(k) < 1e-9, 1e-9, k); sd = np.sqrt(1 - rho ** 2)
    return 0.5 * (norm.cdf(h) + norm.cdf(k)) - owens_t(h, (k - rho * h) / (h * sd)) - owens_t(k, (h - rho * k) / (k * sd)) - np.where(h * k < 0, 0.5, 0.0)
def thresholds(k, idx):
    """each row's own median-ish prop line L = floor(mu)+0.5 -> latent threshold c with P(Y<=L) = Phi(c); and the realised 'over' indicator"""
    mu, r = ho_mu[k][idx], ho_r[k][idx]; L = np.floor(mu) + 0.5
    u = nbinom.cdf(np.floor(L), r, r / (r + mu)); return norm.ppf(np.clip(u, 1e-9, 1 - 1e-9)), (F[k].values[idx] > L)
def solve_rho(c1, c2, o1, o2, w=None):
    """the Gaussian-copula rho under which the predicted joint frequencies of the four over/under quadrants match the observed ones
    (this is what a prop bettor prices: P(both over), P(both under), P(over/under) at real lines), not a tail-sensitive Pearson."""
    uu = (~o1 & ~o2).astype(float); oo = (o1 & o2).astype(float)
    if w is None: w = np.ones(len(c1))
    def gap(rho):
        p_uu = bvn_cdf(c1, c2, rho); p_oo = 1 - norm.cdf(c1) - norm.cdf(c2) + p_uu
        return float((w * ((uu - p_uu) + (oo - p_oo))).sum() / w.sum())    # observed minus predicted, both corners
    lo, hi = -0.9, 0.99
    if gap(lo) < 0: return lo
    if gap(hi) > 0: return hi
    for _ in range(40):
        mid = (lo + hi) / 2
        if gap(mid) > 0: lo = mid
        else: hi = mid
    return (lo + hi) / 2
def estimate(k1, k2, I, J, n=15000, B=60):
    if len(I) > n: sel = crng.choice(len(I), n, replace=False); I, J = I[sel], J[sel]
    c1, o1 = thresholds(k1, I); c2, o2 = thresholds(k2, J); ok = np.isfinite(c1) & np.isfinite(c2); c1, c2, o1, o2, I = c1[ok], c2[ok], o1[ok], o2[ok], I[ok]
    rho = solve_rho(c1, c2, o1, o2)
    games = F.game_id.values[I]; ug, inv = np.unique(games, return_inverse=True); bs = []
    for _ in range(B):                                      # bootstrap by GAME (players in one game are not independent draws)
        pick = crng.integers(0, len(ug), len(ug)); cnt = np.bincount(pick, minlength=len(ug)); w = cnt[inv].astype(float)
        if w.sum() > 0: bs.append(solve_rho(c1, c2, o1, o2, w))
    return rho, float(np.std(bs)), int(len(I))
corr = {'samePlayer': {}, 'teammate': {}, 'opponent': {}}; corr_meta = {}
Iself = np.arange(len(F)); It, Jt = partners('team'); Io, Jo = partners('opp')
for rel, (I, J) in (('samePlayer', (Iself, Iself)), ('teammate', (It, Jt)), ('opponent', (Io, Jo))):
    for a_i, k1 in enumerate(MK):
        for k2 in MK[a_i:]:
            if rel == 'samePlayer' and k1 == k2: continue
            rho, se, n = estimate(k1, k2, I, J)
            if rel != 'samePlayer' and k1 != k2:
                rho2, se2, _ = estimate(k2, k1, I, J); rho = (rho + rho2) / 2; se = np.sqrt((se ** 2 + se2 ** 2) / 2)
            within = abs(rho) < 2 * se and rel != 'samePlayer'
            corr[rel][f'{k1}|{k2}'] = 0.0 if within else round(float(rho), 3)
            corr_meta[f'{rel}|{k1}|{k2}'] = dict(rho=round(float(rho), 3), se=round(float(se), 3), n=n)
    print(rel, {kk: v for kk, v in corr[rel].items()}, flush=True)
print('teammate/opponent estimates (rho, se):', {kk.split('|', 1)[1]: (v['rho'], v['se']) for kk, v in corr_meta.items() if kk.startswith(('teammate', 'opponent')) and (kk.split('|')[1] == kk.split('|')[2])})

# ------------------ joint check: predicted vs observed frequency of every over/under corner, with the corr table above ------------------
def joint_check(pairs, rel):
    res = {}
    for k1, k2 in pairs:
        I, J = (np.arange(len(F)), np.arange(len(F))) if rel == 'samePlayer' else ((It, Jt) if rel == 'teammate' else (Io, Jo))
        if len(I) > 20000: sel = np.random.default_rng(4).choice(len(I), 20000, replace=False); I, J = I[sel], J[sel]
        rho = corr[rel].get(f'{k1}|{k2}', corr[rel].get(f'{k2}|{k1}', 0.0))
        c1, o1 = thresholds(k1, I); c2, o2 = thresholds(k2, J); ok = np.isfinite(c1) & np.isfinite(c2); c1, c2, o1, o2 = c1[ok], c2[ok], o1[ok], o2[ok]
        p1, p2 = 1 - norm.cdf(c1), 1 - norm.cdf(c2)
        puu = bvn_cdf(c1, c2, rho); poo = p1 + p2 - 1 + puu; pou = p1 - poo; puo = p2 - poo
        pin = {'OO': p1 * p2, 'UU': (1 - p1) * (1 - p2), 'OU': p1 * (1 - p2), 'UO': (1 - p1) * p2}
        pcp = {'OO': poo, 'UU': puu, 'OU': pou, 'UO': puo}
        obs = {'OO': o1 & o2, 'UU': ~o1 & ~o2, 'OU': o1 & ~o2, 'UO': ~o1 & o2}
        row = dict(rho=rho, n=int(len(c1)))
        for q in ('OO', 'UU', 'OU', 'UO'):
            y = obs[q].astype(float); row[q] = dict(observed=round(float(y.mean()), 4), copula=round(float(pcp[q].mean()), 4), independent=round(float(pin[q].mean()), 4),
                                                    brierCopula=round(float(((pcp[q] - y) ** 2).mean()), 5), brierIndependent=round(float(((pin[q] - y) ** 2).mean()), 5))
        res[f'{k1}|{k2}'] = row
        print(f'  {rel:10s} {k1}-{k2} rho {rho:+.3f} n={row["n"]}: ' + '  '.join(f'{q} obs {row[q]["observed"]:.3f} cop {row[q]["copula"]:.3f} ind {row[q]["independent"]:.3f}' for q in ('OO', 'UU', 'OU')))
    return res
print("\njoint corners at each leg's own median-ish line, held-out marginals:")
joint_ev = {'samePlayer': joint_check([('pts', 'tpm'), ('pts', 'reb'), ('pts', 'ast'), ('reb', 'ast'), ('ast', 'tpm'), ('pts', 'stl'), ('reb', 'blk')], 'samePlayer'),
            'teammate': joint_check([('pts', 'pts'), ('reb', 'reb'), ('ast', 'ast'), ('tpm', 'tpm'), ('pts', 'ast'), ('pra', 'pra')], 'teammate'),
            'opponent': joint_check([('pts', 'pts'), ('pra', 'pra')], 'opponent')}
evidence['joint'] = joint_ev

out = dict(source='sportsdataverse ESPN NBA player box scores, regular seasons 2023-24 .. 2025-26 (walk-forward rows, everyone projected >= 14 minutes)', oppK=OPP_K, lvlDecayGames=LVL_DECAY, newMinFitGp=NEW_FIT_MIN_GP,
           nRows=int(len(F)), params=fitted, priors=priors, corr=corr, evidence=evidence,
           notes='absence coefficients were fitted on realized injury-reason DNP rows (an upper bound for the live injury-report version); home/away and back-to-back were tested and NOT adopted; correlations are latent Gaussian-copula values fitted so that the predicted over/under corner frequencies at each player\'s own median-ish line match the observed ones (held-out marginals), game-clustered bootstrap standard errors, set to 0 when within 2 standard errors (teammate/opponent)')
if a.out:
    with open(a.out, 'w') as fh:
        fh.write('// GENERATED by scripts/nba/fit_nba.py from real box scores. Do not edit by hand; re-run the script.\n')
        fh.write('export interface NbaGroupFit { kMult: number; rScale: number; lvl: number }\n')
        fh.write('export interface NbaFit { source: string; oppK: number; lvlDecayGames: number; newMinFitGp: number; nRows: number; params: Record<string, { K: number; PK: number; KM: number; W: number; oppCoef: number; absCoef: number; absSlope: number; rA: number; rB: number; groups: Record<string, NbaGroupFit> }>; priors: Record<string, { rate: Record<string, number>; min: number }>; corr: Record<string, Record<string, number>>; evidence: Record<string, unknown>; notes: string; }\n')
        fh.write('export const NBA_FIT: NbaFit = ' + json.dumps(out, indent=2) + ';\n')
    print('\nwrote', a.out)
if a.export_parity:
    S = F.sample(300, random_state=3); rows = []
    for idx, r0 in S.iterrows():
        g = r0.group; q0 = fitted
        rows.append(dict(season=int(r0.season), pos=r0.pos, gp=int(r0.gp), cumMin=float(r0.cum_min), priorGp=float(r0.priorGp), priorMin=float(r0.priorMin), changer=bool(g == 'changer'),
                         minL5=None if pd.isna(r0.min_l5) else float(r0.min_l5), cum={k: float(r0['cum_' + k]) for k in MK}, prior={k: float(r0['prior_' + k]) for k in MK},
                         of={k: float(r0[f'of_{k}_{OPP_K}']) for k in MK}, L=float(r0.L_inj), prMin=float(r0.pr_min), prRate={k: float(r0['pr_rate_' + k]) for k in MK},
                         group=g, pyPm=float(r0.pmR),
                         pyMu={k: float(mu_of(S.loc[[idx]], k, dict(oc=fitted[k]['oppCoef'], ac=fitted[k]['absCoef'], **{'as': fitted[k]['absSlope']}), dict(kMult=fitted[k]['groups'][g]['kMult'], lvl=fitted[k]['groups'][g]['lvl']))[0]) for k in MK},
                         pyR={k: float(r_of(S.loc[[idx]], (fitted[k]['rA'], fitted[k]['rB']), fitted[k]['groups'][g]['rScale'])[0]) for k in MK}))
    json.dump(rows, open(a.export_parity, 'w'))
    print('parity rows ->', a.export_parity)
