import json,sys
sys.stdout.reconfigure(encoding='utf8')
E={x['id']:x for x in json.load(open(sys.argv[1],encoding='utf8'))}
for i in sys.argv[2:]:
    x=E.get('ep_'+i) or E.get(i)
    if not x: print('MISSING',i);continue
    s=x['script_json']
    print(f"\n=== {x['id']} {x['youtube_video_id']} {x['lane']} {s.get('evergreen_format') or s.get('story_type')} dur {x['duration']}\nTITLE {s.get('youtube',{}).get('title')}\nHOOK {s.get('hook')}")
    for b in s.get('beats',[]):
        v=b.get('visual') or {}
        print(' -',v.get('kind',''),'['+str(v.get('primary',''))[:50]+' / '+str(v.get('secondary',''))[:40]+']',b.get('narration',''))
    for en in s.get('entries',[]) or []: print(' * ',json.dumps(en,ensure_ascii=False)[:280])
    print('TAKE',s.get('pulse_take'),'\nLOOP',s.get('loop_line'),'\nKICKER',s.get('kicker'),'Q',s.get('desk_question'))
