# Which script features go with real retention on Pulse's own Shorts (1-17 Nov 2026).
# usage: python feature_study.py features1.json [features2.json]
import json, sys, math
import numpy as np
D = 'D:/pulse-data/scratch/creator-gap-1118/ten/'
key = {k['code']: k for k in json.load(open(D + 'pulse_shorts_key_DO_NOT_SHOW.json', encoding='utf-8'))}
sets = [{r['code']: r for r in json.load(open(p, encoding='utf-8'))} for p in sys.argv[1:]]
feats = ['open', 'answer_at', 'payoff', 'surprise', 'stakes', 'conflict', 'stance', 'specific', 'one_point', 'turns', 'human', 'clarity', 'stock_end', 'heat', 'swipe_at', 'overall']
def rank(a):
    a = np.asarray(a, float); o = a.argsort(); r = np.empty(len(a)); r[o] = np.arange(len(a))
    for v in np.unique(a):
        m = a == v; r[m] = r[m].mean()
    return r
def sp(x, y):
    x = rank(x); y = rank(y)
    if x.std() == 0 or y.std() == 0: return float('nan')
    return float(np.corrcoef(x, y)[0, 1])
def resid(y, X):
    X = np.column_stack([np.ones(len(y))] + [np.asarray(c, float) for c in X]); y = np.asarray(y, float)
    b, *_ = np.linalg.lstsq(X, y, rcond=None); return y - X @ b
codes = [c for c in key if all(c in s for s in sets) and key[c]['views'] >= 100 and key[c]['avg_viewed_pct'] > 0]
print('shorts with 100+ views:', len(codes))
F = {f: [float(np.mean([s[c][f] for s in sets])) for c in codes] for f in feats}
if len(sets) == 2:
    print('judge agreement (rank corr) per feature:')
    for f in feats:
        print(f'  {f:10s} {sp([sets[0][c][f] for c in codes], [sets[1][c][f] for c in codes]):+.2f}')
dur = [key[c]['duration_s'] for c in codes]
avp = [key[c]['avg_viewed_pct'] for c in codes]
eng = [key[c]['engaged_rate'] for c in codes]
lv = [math.log(key[c]['views']) for c in codes]
gta = [1.0 if str(key[c]['gta']) == 'True' else 0.0 for c in codes]
avp_r = resid(avp, [dur])            # retention with length taken out
avp_r2 = resid(avp, [dur, F['heat']])
lv_r = resid(lv, [gta, F['heat']])   # views with topic size taken out
print(f"\n{'feature':10s} {'avg viewed':>10s} {'(len out)':>10s} {'(len+heat)':>10s} {'stayed':>8s} {'views':>7s} {'(topic out)':>11s}")
for f in feats:
    x = F[f]
    print(f"{f:10s} {sp(x, avp):+10.2f} {sp(x, avp_r):+10.2f} {sp(x, avp_r2):+10.2f} {sp(x, eng):+8.2f} {sp(x, lv):+7.2f} {sp(x, lv_r):+11.2f}")
print('\nduration vs avg viewed', round(sp(dur, avp), 2), '| heat vs views', round(sp(F['heat'], lv), 2), '| gta vs views', round(sp(gta, lv), 2))
# a simple pull score from the features that carry signal, to compare with "overall"
z = lambda a: (np.asarray(a, float) - np.mean(a)) / (np.std(a) or 1)
pull = z(F['open']) + z(F['payoff']) + z(F['surprise']) + z(F['stakes']) + z(F['conflict']) + z(F['turns']) + z(F['answer_at'])
print('pull (open+payoff+surprise+stakes+conflict+turns+answer_at) vs avg viewed (len out):', round(sp(pull, avp_r), 2), '| stayed:', round(sp(pull, eng), 2), '| views (topic out):', round(sp(pull, lv_r), 2))
# top and bottom third by retention with length out
o = np.argsort(avp_r); n = len(o) // 3
print('\nmean feature, top third vs bottom third by avg viewed (length taken out):')
for f in feats:
    a = np.asarray(F[f]); print(f'  {f:10s} top {a[o[-n:]].mean():6.2f}  bottom {a[o[:n]].mean():6.2f}')
