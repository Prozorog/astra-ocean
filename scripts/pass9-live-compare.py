import json,math
from pathlib import Path
import numpy as np
from PIL import Image
root=Path('output/perf/live-velocity');rows=[]
def compare(a,b):
    a=np.asarray(Image.open(a).convert('RGB'),dtype=np.int16);b=np.asarray(Image.open(b).convert('RGB'),dtype=np.int16);d=np.abs(a-b);mse=float(np.mean(d.astype(float)**2));blocks=(d.astype(float)**2).reshape(135,8,240,8,3).mean(axis=(1,3,4));return {'maxAbs':int(d.max()),'psnr':None if not mse else 10*math.log10(255**2/mse),'worst8x8Mse':float(blocks.max()),'changedPixels':int(np.any(d>0,axis=2).sum())},d
for fps in [20,30,60]:
    motion,diff=compare(root/f'{fps}-canonical.png',root/f'{fps}-live.png');Image.fromarray(np.clip(diff*12,0,255).astype(np.uint8)).save(root/f'{fps}-difference.png')
    control,_=compare(root/f'{fps}-canonicalNoBlur.png',root/f'{fps}-liveNoBlur.png');paused,_=compare(root/f'{fps}-paused.png',root/f'{fps}-live.png')
    rows.append({'fps':fps,'motionOnly':motion,'noBlurControl':control,'paused':paused})
report={'pass':all(r['noBlurControl']['maxAbs']<=1 and r['paused']['maxAbs']==0 for r in rows),'rows':rows}
(root/'quality.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
if not report['pass']:raise SystemExit(1)
