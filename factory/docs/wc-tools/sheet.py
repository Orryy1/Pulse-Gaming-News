#!/usr/bin/env python
"""Contact sheet with timestamps for one video. usage: sheet.py <video> <out.jpg> <every_s> [start] [end] [cols] [cellw]
One seek per sample (cheap); one ffmpeg thread. Read only on the video."""
import subprocess,sys,tempfile,os,json
from PIL import Image,ImageDraw,ImageFont
v,out,every=sys.argv[1],sys.argv[2],float(sys.argv[3])
start=float(sys.argv[4]) if len(sys.argv)>4 else 0
dur=float(json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',v]))['format']['duration'])
end=float(sys.argv[5]) if len(sys.argv)>5 and float(sys.argv[5])>0 else dur
cols=int(sys.argv[6]) if len(sys.argv)>6 else 7
cw=int(sys.argv[7]) if len(sys.argv)>7 else 300
ts=[];t=start
while t<end-0.05: ts.append(t);t+=every
ims=[]
with tempfile.TemporaryDirectory() as d:
    for i,t in enumerate(ts):
        p=f'{d}/{i}.jpg'
        subprocess.run(['ffmpeg','-v','error','-threads','1','-ss',str(t),'-i',v,'-frames:v','1','-q:v','3','-vf',f'scale={cw}:-2','-y',p],check=False)
        if os.path.exists(p):ims.append((t,Image.open(p).copy()))
w,h=ims[0][1].size
rows=(len(ims)+cols-1)//cols
S=Image.new('RGB',(cols*w,rows*h),'black');D=ImageDraw.Draw(S)
f=ImageFont.truetype('arial.ttf',20)
for i,(t,m) in enumerate(ims):
    x,y=(i%cols)*w,(i//cols)*h;S.paste(m,(x,y))
    lab=f'{int(t//60)}:{t%60:04.1f}';D.rectangle([x,y,x+78,y+24],fill='black');D.text((x+3,y+1),lab,fill='yellow',font=f)
S.save(out,quality=78)
print(out,len(ims),S.size,round(dur,1))
