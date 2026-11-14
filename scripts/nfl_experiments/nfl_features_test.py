import numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln
D='/home/claude/data/'
bt=pd.read_csv(D+'bt_rows.csv'); off=pd.read_csv(D+'team_off_games.csv'); dfn=pd.read_csv(D+'team_def_games.csv'); gm=pd.read_csv(D+'games.csv')
gm=gm[gm.game_type=='REG']
norm={'LA':'LAR','ARI':'ARI','JAC':'JAX','WSH':'WAS','OAK':'LV','SD':'LAC','STL':'LAR'}
n=lambda t: norm.get(t,t)
opp={}
for r in gm.itertuples():
    opp[(r.season,r.week,n(r.home_team))]=n(r.away_team); opp[(r.season,r.week,n(r.away_team))]=n(r.home_team)
bt['opp']=[opp.get((s,w,n(t))) for s,w,t in zip(bt.season,bt.week,bt.team)]
print('rows',len(bt),'missing opp',bt.opp.isna().sum())
FEATS_OFF=['pass_epa','pass_succ','press','pa','neutral_pass','pace','blitz']
FEATS_DEF=['pass_epa','pass_succ','press','blitz']
K=4.0  # pseudo-games shrinking toward the league mean of games seen so far
def wf_table(tab,cols):
    """team feature as of week W (exclusive), shrunk to league mean, same season only."""
    out={}
    for (s,t),g in tab.groupby(['season','team']):
        g=g.sort_values('week')
        for w in range(1,19):
            prev=g[g.week<w]
            allprev=tab[(tab.season==s)&(tab.week<w)]
            for c in cols:
                lm=allprev[c].mean() if len(allprev) else np.nan
                x=prev[c].dropna()
                out[(s,t,w,c)]=(x.sum()+K*lm)/(len(x)+K) if len(x) and not np.isnan(lm) else np.nan
    return out
fo=wf_table(off,FEATS_OFF); fd=wf_table(dfn,FEATS_DEF)
lg={}
for s in (2024,2025,2026):
    for w in range(1,19):
        for c in FEATS_OFF: lg[('o',s,w,c)]=off[(off.season==s)&(off.week<w)][c].mean()
        for c in FEATS_DEF: lg[('d',s,w,c)]=dfn[(dfn.season==s)&(dfn.week<w)][c].mean()
for c in FEATS_OFF: bt['o_'+c]=[fo.get((s,t,w,c),np.nan) for s,t,w in zip(bt.season,bt.team,bt.week)]
for c in FEATS_DEF: bt['d_'+c]=[fd.get((s,t,w,c),np.nan) for s,t,w in zip(bt.season,bt.opp,bt.week)]
bt['op_pace']=[fo.get((s,t,w,'pace'),np.nan) for s,t,w in zip(bt.season,bt.opp,bt.week)]
bt['z_op_pace']=(bt.op_pace-bt.o_pace.mean())/off.pace.std()
# z-score each feature by its league-wide std (computed from earlier data of same season is overkill; use global std of team-game values)
cols=['o_'+c for c in FEATS_OFF]+['d_'+c for c in FEATS_DEF]
sd={}
for c in FEATS_OFF: sd['o_'+c]=off[c].std()
for c in FEATS_DEF: sd['d_'+c]=dfn[c].std()
for c in cols:
    s_=bt.season; w_=bt.week
    lm=np.array([lg[('o' if c[0]=='o' else 'd',s,w,c[2:])] for s,w in zip(s_,w_)])
    bt['z_'+c]=(bt[c]-lm)/sd[c]
bt=bt.dropna(subset=['z_'+c for c in cols]+['z_op_pace']).reset_index(drop=True)
print('usable',len(bt))
ALPHA={'WR':0.10,'TE':0.125}
def nb_ll(y,mu,a):
    r=1/a; return gammaln(y+r)-gammaln(r)-gammaln(y+1)+r*np.log(r/(r+mu))+y*np.log(mu/(r+mu))
def fit(df,zc,ridge=30.0):
    X=df[zc].values; y=df.actual.values; mu0=df.mu.values; a=df.pos.map(ALPHA).values
    f=lambda b: -nb_ll(y,mu0*np.exp(X@b),a).sum()+ridge*(b@b)
    g=minimize(f,np.zeros(len(zc)),method='L-BFGS-B'); return g.x
def score(df,zc,b):
    mu=df.mu.values*np.exp(df[zc].values@b if zc else 0); a=df.pos.map(ALPHA).values
    return nb_ll(df.actual.values,mu,a).mean()
def evaluate(zc,label,train_seasons,test_season,minweek=3):
    tr=bt[bt.season.isin(train_seasons)]; te=bt[bt.season==test_season]
    b=fit(tr,zc); base=score(te,[],None); new=score(te,zc,b)
    return base,new,b
zc_all=['z_'+c for c in cols]+['z_op_pace']
print('\n== ALL features, train->test (mean LL/row; + = better than baseline)')
for tr,te in [([2024],2025),([2024,2025],2026),([2025],2026)]:
    base,new,b=evaluate(zc_all,'all',tr,te); print(f'train {tr} test {te}: base {base:.4f} new {new:.4f} delta {new-base:+.4f}')
print('\n== single features (train 2024+2025, test 2026 | train 2024, test 2025)')
res=[]
for c in zc_all:
    d1=evaluate([c],c,[2024],2025); d2=evaluate([c],c,[2024,2025],2026)
    res.append((c,d1[1]-d1[0],d2[1]-d2[0],d1[2][0],d2[2][0]))
for c,a,b_,c1,c2 in sorted(res,key=lambda r:-(r[1]+r[2])): print(f'{c:18s} dLL25 {a:+.5f} dLL26 {b_:+.5f} coef25 {c1:+.4f} coef26 {c2:+.4f}')
bt.to_csv(D+'bt_with_feats.csv',index=False)
