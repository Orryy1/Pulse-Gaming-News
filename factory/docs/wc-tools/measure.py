#!/usr/bin/env python
"""Cheap per-video measures from one low-res decode (one thread). Read only on the videos.
usage: measure.py out.jsonl <fps> <ep_dir>... 
Per sample: picture region only (top 60 percent, caption band excluded). Gives dark share, longest dark run,
repeat share (same picture seen earlier, by 64-bit hash), longest static hold, distinct pictures, first dark time."""
import subprocess,sys,json,os
out,fps=sys.argv[1],float(sys.argv[2]);W,H=48,86
def dhash(a):
    # a: bytes of W*H gray, picture region; 8x8 average grid then difference hash
    gw,gh=9,8;g=[]
    for y in range(gh):
        for x in range(gw):
            xs=range(x*W//gw,(x+1)*W//gw);ys=range(y*RH//gh,(y+1)*RH//gh)
            g.append(sum(a[j*W+i] for j in ys for i in xs)/(len(xs)*len(ys)))
    return sum(1<<(y*8+x) for y in range(gh) for x in range(8) if g[y*gw+x]<g[y*gw+x+1])
RH=int(H*0.60)
with open(out,'a') as F:
  for d in sys.argv[3:]:
    v=os.path.join(d,'short.mp4')
    if not os.path.exists(v): continue
    p=subprocess.run(['ffmpeg','-v','error','-threads','1','-i',v,'-vf',f'fps={fps},scale={W}:{H}:flags=area,format=gray','-f','rawvideo','-'],capture_output=True)
    b=p.stdout;n=len(b)//(W*H)
    H_=[];dark=[]
    for i in range(n):
        a=b[i*W*H:(i+1)*W*H];reg=a[:W*RH];m=sum(reg)/len(reg);dark.append(m<14);H_.append(dhash(reg))
    seen=[];rep=0;hold=best=1;uniq=0
    for i,h in enumerate(H_):
        near=[j for j,s in enumerate(seen) if bin(s^h).count('1')<=6]
        recent=[j for j in near if i-j<=2/ (1/fps)]
        old=[j for j in near if i-j>4*fps]
        if old: rep+=1
        if not near: uniq+=1
        seen.append(h)
    for i in range(1,n):
        hold=hold+1 if bin(H_[i]^H_[i-1]).count('1')<=6 else 1;best=max(best,hold)
    run=br=0;fd=None
    for i,x in enumerate(dark):
        if x:
            run+=1;br=max(br,run);fd=i/fps if fd is None else fd
        else: run=0
    r=dict(ep=os.path.basename(d),dur=round(n/fps,1),dark_pct=round(100*sum(dark)/max(n,1)),longest_dark_s=round(br/fps,1),first_dark=fd,repeat_pct=round(100*rep/max(n,1)),distinct=uniq,distinct_per_10s=round(10*uniq/max(n/fps,1),1),longest_hold_s=round(best/fps,1))
    F.write(json.dumps(r)+'\n');F.flush();print(r,flush=True)
