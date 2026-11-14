"""Absence redistribution: does a teammate's lift depend on HIS minutes (starters absorb more of a lost rotation player)?
Compare, leave-one-season-out with a clustered bootstrap, for each market:
  A: mu *= exp(c * L)                      (what nba_v1 uses; same lift for every teammate)
  B: mu *= exp(c * L * pm/30)              (lift proportional to his own minutes)
  C: mu *= exp(c1*L + c2*L*(pm/30-1))      (free slope on his minutes)
L = rotation minutes lost to injury-DNP teammates / 100.   usage: python3 -I scripts/nba/nba_absence_shape_test.py /home/claude/nbadata"""
import sys, numpy as np, pandas as pd
sys.path.insert(0, 'scripts/nba')
import nba_features_test as T, nba_data as D
F = T.F
F['pm'] = np.concatenate([T.V.minutes_proj(F[F.season == s], 8, 0.6).values for s in T.SEASONS])
F['L_pm'] = F.L_inj * F.pm / 30.0; F['L_slope'] = F.L_inj * (F.pm / 30.0 - 1.0)
for k in D.STATS:
    for label, cols in (('A same lift', ['L_inj']), ('B lift ~ own minutes', ['L_pm']), ('C free slope', ['L_inj', 'L_slope'])):
        T.report(k, label, cols)
