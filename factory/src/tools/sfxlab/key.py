# Key of each music bed (Krumhansl major/minor profile on mean chroma). Usage: python src/tools/sfxlab/key.py public/music_*.mp3
import sys, librosa, numpy as np
names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
maj=np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]); mnr=np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
for p in sys.argv[1:]:
    y,sr=librosa.load(p,sr=22050,mono=True,duration=120)
    c=librosa.feature.chroma_cqt(y=y,sr=sr).mean(axis=1)
    cands=[(np.corrcoef(np.roll(maj,k),c)[0,1],names[k]+' major') for k in range(12)]+[(np.corrcoef(np.roll(mnr,k),c)[0,1],names[k]+' minor') for k in range(12)]
    best=max(cands)
    top=[names[k] for k in np.argsort(c)[::-1][:5]]
    print(p.split('/')[-1], 'key', best[1], round(best[0],2), 'notes', top)
