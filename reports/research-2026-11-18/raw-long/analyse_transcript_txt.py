import json,re,sys,statistics as st
# usage: python -I analyse_transcript_txt.py file.json|file.txt [duration_seconds]
p=sys.argv[1]
if p.lower().endswith('.txt'):
    t=open(p,encoding='utf-8').read()
else:
    d=json.load(open(p,encoding='utf-8')); t=d['transcription']
segs=[]
for m in re.finditer(r'\[(\d+):(\d+)(?::(\d+))?\]\s*(.*?)(?=\n\[\d+:\d+|\Z)',t,re.S):
    a,b,c,txt=m.groups()
    s=int(a)*60+int(b) if c is None else int(a)*3600+int(b)*60+int(c)
    segs.append((s,txt))
dur=float(sys.argv[2]) if len(sys.argv)>2 else segs[-1][0]+15
clean=lambda x: re.sub(r'\[[^\]]*\]|>>','',x)
words=lambda x: re.findall(r"[A-Za-z0-9'’]+",clean(x))
allw=[w.lower() for s,x in segs for w in words(x)]
n=len(allw)
print('file',p); print('words',n,'dur_min',round(dur/60,1),'wpm_overall',round(n/(dur/60),1))
# per 5 min wpm
buck={}
for s,x in segs: buck[s//300]=buck.get(s//300,0)+len(words(x))
print('wpm per 5min:',[round(v/5) for k,v in sorted(buck.items())])
buck={}
for s,x in segs:
    if s<120: buck[s//30]=buck.get(s//30,0)+len(words(x))
print('first 2 min words per 30s:',[v for k,v in sorted(buck.items())])
def per1k(ws): return round(sum(allw.count(w) for w in ws)/n*1000,1)
print('I/1k',per1k(['i',"i'm","i've","i'd","i'll",'my','me']),'you/1k',per1k(['you','your',"you're","you've","you'll"]),'we/1k',per1k(['we','our',"we're","we've",'us']))
full=clean(' '.join(x for s,x in segs))
sents=[s for s in re.split(r'(?<=[.!?])\s+',full) if len(s.split())>0]
sl=[len(s.split()) for s in sents]
print('sentences',len(sl),'mean',round(st.mean(sl),1),'median',st.median(sl),'share<=8w',round(sum(1 for x in sl if x<=8)/len(sl),2),'share>=25w',round(sum(1 for x in sl if x>=25)/len(sl),2))
print('speaker turns (>>)',t.count('>>'),'per min',round(t.count('>>')/(dur/60),2))
print('[music] tags',len(re.findall(r'\[music\]',t,re.I)),'[applause]',len(re.findall(r'applause',t,re.I)),'[laughter]',len(re.findall(r'laugh',t,re.I)))
print('questions',full.count('?'),'per 1k',round(full.count('?')/n*1000,1))
nums=re.findall(r'\b\d[\d,.]*\b',full); print('numbers per 1k',round(len(nums)/n*1000,1))
# gaps: segments with few words
gaps=[(s,len(words(x))) for s,x in segs]
quiet=[f"{s//60}:{s%60:02d}({w})" for (s,w),(s2,_) in zip(gaps,gaps[1:]) if (s2-s)>0 and w/((s2-s)/60)<60]
print('low-speech segments (<60wpm):',len(quiet),quiet[:60])
print('first-person singular /1k',per1k(['i',"i'm","i've","i'd","i'll",'my','me']))
mus=[f"{s//60}:{s%60:02d}" for s,x in segs if re.search(r'\[music\]',x,re.I)]
print('[music] block timestamps',len(mus),mus)
