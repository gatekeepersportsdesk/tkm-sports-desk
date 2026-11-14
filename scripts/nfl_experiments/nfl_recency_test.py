import numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln
D='/home/claude/data/'
bt=pd.read_csv(D+'bt_with_abs.csv')
S=pd.concat([pd.read_csv(D+f'stats_player_week_{y}.csv',usecols=['player_display_name','season','week','season_type','receptions','targets']) for y in (2024,2025,2026)])
S=S[S.season_type=='REG'].sort_values(['player_display_name','season','week'])
S['r3']=S.groupby(['player_display_name','season']).receptions.transform(lambda x:x.shift(1).rolling(3,min_periods=2).mean())
S['t3']=S.groupby(['player_display_name','season']).targets.transform(lambda x:x.shift(1).rolling(3,min_periods=2).mean())
bt=bt.merge(S[['player_display_name','season','week','r3','t3']].rename(columns={'player_display_name':'name'}),on=['name','season','week'],how='left')
bt=bt.dropna(subset=['r3']).copy()
bt['f_r3']=np.log((bt.r3+0.5)/(bt.mu+0.5)); bt['f_t3']=np.log((bt.t3*0.65+0.5)/(bt.mu+0.5))
ALPHA={'WR':0.10,'TE':0.125}
def ll(y,mu,a): r=1/a; return gammaln(y+r)-gammaln(r)-gammaln(y+1)+r*np.log(r/(r+mu))+y*np.log(mu/(r+mu))
def fit(df,cols,ridge=5.0):
    X=df[cols].values;y=df.actual.values;a=df.pos.map(ALPHA).values
    return minimize(lambda b:-ll(y,df.mu.values*np.exp(X@b),a).sum()+ridge*(b@b),np.zeros(len(cols)),method='L-BFGS-B').x
def sc(df,cols,b):
    mu=df.mu.values*np.exp(df[cols].values@b) if cols else df.mu.values
    return ll(df.actual.values,mu,df.pos.map(ALPHA).values).mean()
print('rows',len(bt))
for cols in (['f_r3'],['f_t3'],['f_r3','f_t3']):
    for tr,te in [([2024],2025),([2024,2025],2026),([2025],2026)]:
        a=bt[bt.season.isin(tr)];b_=bt[bt.season==te];b=fit(a,cols)
        print(cols,f'train {tr} test {te}: coef {np.round(b,3)} delta LL/row {sc(b_,cols,b)-sc(b_,[],None):+.5f}')
