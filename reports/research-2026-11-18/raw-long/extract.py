# Pull vidIQ tool results (transcripts, watch analyses, comments) out of the Claude session logs onto disk.
# usage: python -I extract.py ID1 ID2 ...   -> extracts results for those video IDs only (other agents share this session log)
import json,os,re,glob,sys
S=r"C:\Users\MORR\.claude\projects\C--Users-MORR-gaming-studio-pulse-gaming--claude-worktrees-angry-babbage-192c9e\f10a6f14-a66c-4be5-8afd-16e9fe69c776"
OUT=os.path.dirname(os.path.abspath(__file__))
def texts(o):
    if isinstance(o,str):
        yield o
    elif isinstance(o,dict):
        for v in o.values(): yield from texts(v)
    elif isinstance(o,list):
        for v in o: yield from texts(v)
WANT=set(sys.argv[1:])
def handle(s):
    s=s.strip()
    if not s.startswith('{'): return
    try: d=json.loads(s)
    except Exception: return
    if not isinstance(d,dict): return
    if 'transcription' in d and d.get('videoId') in WANT:
        p=os.path.join(OUT,f"transcript_{d['videoId']}.txt")
        t=d['transcription']
        blocks=re.split(r'\n(?=\[\d+:\d+)',t)
        open(p,'w',encoding='utf-8').write('\n'.join(re.sub(r'\s*\n\s*',' ',b) for b in blocks)); print('transcript',d['videoId'],len(t))
    r=d.get('result')
    if isinstance(r,dict) and 'analysisText' in r and r.get('videoId') in WANT:
        p=os.path.join(OUT,f"watch_{r.get('videoId','unknown')}.md"); open(p,'w',encoding='utf-8').write(r['analysisText']); print('watch',r.get('videoId'))
    if 'threads' in d or 'comments' in d:
        vid=None
        m=re.search(r'"videoId":"([\w-]{11})"',s)
        vid=m.group(1) if m else 'unknown'
        if vid not in WANT: return
        p=os.path.join(OUT,f"comments_{vid}.json"); open(p,'w',encoding='utf-8').write(s); print('comments',vid)
files=glob.glob(os.path.join(S,'**','*.jsonl'),recursive=True)+glob.glob(os.path.join(os.path.dirname(S),os.path.basename(S)+'.jsonl'))
for f in files:
    for line in open(f,encoding='utf-8',errors='ignore'):
        if 'transcription' not in line and 'analysisText' not in line and 'threads' not in line and '"comments"' not in line: continue
        try: o=json.loads(line)
        except Exception: continue
        for s in texts(o): handle(s)
for f in glob.glob(os.path.join(S,'tool-results','*')):
    try: handle(open(f,encoding='utf-8',errors='ignore').read())
    except Exception as e: print('skip',f,e)
