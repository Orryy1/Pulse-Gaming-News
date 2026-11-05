#!/usr/bin/env python
"""Cuts a minute and picture brightness for videos (scaled decode, one thread). usage: pace.py <name=path>..."""
import subprocess,sys,re,json
for a in sys.argv[1:]:
    n,p=a.split('=',1)
    r=subprocess.run(['ffmpeg','-hide_banner','-threads','1','-i',p,'-vf',"scale=180:-2,select='gt(scene,0.3)',metadata=print:file=-",'-an','-f','null','-'],capture_output=True,text=True,encoding='utf8',errors='ignore')
    cuts=len(re.findall(r'pts_time',r.stdout))
    d=float(json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',p]))['format']['duration'])
    r2=subprocess.run(['ffmpeg','-hide_banner','-threads','1','-i',p,'-vf','fps=2,scale=90:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-','-an','-f','null','-'],capture_output=True,text=True,encoding='utf8',errors='ignore')
    Y=[float(x) for x in re.findall(r'YAVG=([\d.]+)',r2.stdout)]
    sa=sorted(Y)
    print(f"{n}: {d:.0f}s cuts/min {cuts/d*60:.0f} meanY {sum(Y)/max(len(Y),1):.0f} darkest10% {sa[len(sa)//10] if sa else 0:.0f} share<40 {100*sum(y<40 for y in Y)/max(len(Y),1):.0f}%",flush=True)
