"""SYNTHETIC MoneyPuck-schema data with KNOWN parameters, used only to prove the fitter recovers them.
Not real NHL data. Never ship numbers from this."""
import sys, numpy as np, pandas as pd
from scipy.stats import norm, nbinom
out = sys.argv[1]; R_S, R_P, RHO = 18.0, 9.0, 0.40
rng = np.random.default_rng(11)
P = 450; pos = np.where(rng.random(P) < 0.33, 'D', np.where(rng.random(P) < .5, 'C', 'L'))
tr_s = np.where(pos == 'D', 1.6, 2.1) * np.exp(rng.normal(0, 0.38, P))
tr_p = np.where(pos == 'D', 0.22, 0.47) * np.exp(rng.normal(0, 0.45, P))
def nb_ppf(u, mu, r): return nbinom.ppf(np.clip(u, 1e-9, 1 - 1e-9), r, r / (r + mu))
rows = []
for season in (2025, 2026):
    G = 82 if season == 2025 else 55
    drift = np.exp(rng.normal(0, 0.08, P))
    for gnum in range(G):
        d = pd.Timestamp(f'{season-1}-10-05') + pd.Timedelta(days=int(gnum * 2.1))
        play = rng.random(P) < 0.9
        z1 = rng.normal(size=P); z2 = RHO * z1 + np.sqrt(1 - RHO ** 2) * rng.normal(size=P)
        s = nb_ppf(norm.cdf(z1), tr_s * drift, R_S); p = nb_ppf(norm.cdf(z2), tr_p * drift, R_P)
        toi = np.where(pos == 'D', 1350, 1080) * np.exp(rng.normal(0, 0.1, P))
        for i in np.where(play)[0]:
            ev, pp = toi[i] * 0.78, toi[i] * 0.16
            for sit, t, sh in (('all', toi[i], s[i]), ('5on5', ev, round(s[i] * 0.8)), ('5on4', pp, s[i] - round(s[i] * 0.8)), ('4on5', toi[i] * 0.06, 0)):
                rows.append((i, f'P{i}', season, 'TST', 'OPP', int(d.strftime('%Y%m%d')), gnum * 100 + season, pos[i], sit, t, sh, p[i] if sit == 'all' else 0, 0))
df = pd.DataFrame(rows, columns=['playerId', 'name', 'season', 'playerTeam', 'opposingTeam', 'gameDate', 'gameId', 'position', 'situation', 'icetime', 'I_F_shotsOnGoal', 'I_F_points', 'playoffGame'])
df.to_csv(out, index=False); print(len(df), 'rows ->', out)
