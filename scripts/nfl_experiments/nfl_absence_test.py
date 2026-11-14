import numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln
D='/home/claude/data/'
norm={'LA':'LAR','JAC':'JAX','WSH':'WAS','OAK':'LV','SD':'LAC','STL':'LAR'}
n=lambda t: norm.get(t,t)
frames=[];snaps=[]
for y in (2024,2025,2026):
    s=pd.read_csv(D+f'stats_player_week_{y}.csv',usecols=['player_id','player_display_name','position','season','week','season_type','team','targets','receptions'])
    frames.append(s[s.season_type=='REG'])
    sc=pd.read_csv(D+f'snap_counts_{y}.csv',usecols=['season','week','game_type','player','team','offense_snaps','offense_pct'])
    snaps.append(sc[sc.game_type=='REG'])
S=pd.concat(frames); S['team']=S.team.map(n); S=S[S.position.isin(['WR','TE','RB'])]
N=pd.concat(snaps); N['team']=N.team.map(n); import re
def K(x): return x.str.lower().str.replace(r'\b(jr|sr|ii|iii|iv|v)\b\.?','',regex=True).str.replace(r'[^a-z]','',regex=True)
N['key']=K(N.player)
S['key']=K(S.player_display_name)
played=set(zip(N.season,N.week,N.team,N.key)) 
snapmap={(a,b,c,d):e for a,b,c,d,e in zip(N.season,N.week,N.team,N.key,N.offense_snaps)}
S=S.sort_values(['player_id','season','week'])
# trailing-4 targets per game (same season, strictly before week W); players with <1 prior games ignored
tg={}
for (pid,seas),g in S.groupby(['player_id','season']):
    g=g.sort_values('week'); wk=g.week.values; t=g.targets.values; team=g.team.values; key=g.key.values
    for i in range(len(g)):
        prev=slice(max(0,i-4),i)  # games played before this appearance
    # build for each future week the trailing average among games before it
    for W in range(2,19):
        idx=[i for i in range(len(g)) if wk[i]<W][-4:]
        if idx: tg[(pid,seas,W)]=(team[idx[-1]],key[idx[-1]],np.mean(t[idx]),len(idx))
rows=[]
for (pid,seas,W),(team,key,avg,k) in tg.items():
    if avg<2.5 or k<3: continue
    absent = snapmap.get((seas,W,team,key),999) < 10
    rows.append((seas,W,team,avg,absent))
A=pd.DataFrame(rows,columns=['season','week','team','tavg','absent'])
# only count absence if the team actually played that week (team has any snap rows)
teamplayed=set(zip(N.season,N.week,N.team))
A=A[[ (s,w,t) in teamplayed for s,w,t in zip(A.season,A.week,A.team)]]
tot=A.groupby(['season','week','team']).tavg.sum().rename('tot')
lost=A[A.absent].groupby(['season','week','team']).tavg.sum().rename('lost')
F=pd.concat([tot,lost],axis=1).fillna(0).reset_index(); F['lost_share']=F.lost/F.tot.clip(lower=1)
print('team-weeks',len(F),'with any absence >0:',(F.lost>0).mean().round(3),'mean lost_share when >0:',F[F.lost>0].lost_share.mean().round(3))
bt=pd.read_csv(D+'bt_with_feats.csv'); bt['team']=bt.team.map(n)
bt=bt.merge(F[['season','week','team','lost_share']],on=['season','week','team'],how='left').fillna({'lost_share':0})
ALPHA={'WR':0.10,'TE':0.125}
def ll(y,mu,a): r=1/a; return gammaln(y+r)-gammaln(r)-gammaln(y+1)+r*np.log(r/(r+mu))+y*np.log(mu/(r+mu))
def fit(df,cols,ridge=5.0):
    X=df[cols].values; y=df.actual.values; a=df.pos.map(ALPHA).values
    f=lambda b:-ll(y,df.mu.values*np.exp(X@b),a).sum()+ridge*(b@b)
    return minimize(f,np.zeros(len(cols)),method='L-BFGS-B').x
def sc(df,cols,b):
    mu=df.mu.values*np.exp(df[cols].values@b) if cols else df.mu.values
    return ll(df.actual.values,mu,df.pos.map(ALPHA).values).mean()
for tr,te in [([2024],2025),([2024,2025],2026),([2025],2026)]:
    a=bt[bt.season.isin(tr)];b_=bt[bt.season==te]
    b=fit(a,['lost_share']); print(f'train {tr} test {te}: coef {b[0]:+.3f}  base {sc(b_,[],None):.4f} new {sc(b_,["lost_share"],b):.4f} delta {sc(b_,["lost_share"],b)-sc(b_,[],None):+.5f}')
# diagnostic: actual/mu in games with lost_share>0.15 vs not, by position
bt['hi']=bt.lost_share>0.15
print(bt.groupby(['hi','pos']).apply(lambda g: pd.Series(dict(n=len(g),actual_over_mu=g.actual.sum()/g.mu.sum())),include_groups=False))
bt.to_csv(D+'bt_with_abs.csv',index=False)
