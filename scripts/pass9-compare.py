"""Lossless quality gate against the unchanged pass-9 baseline; no look targets."""
import json
import math
import sys
from pathlib import Path
import numpy as np
from PIL import Image

candidate = Path('output/perf') / sys.argv[1]
baseline = Path('output/perf/baseline')
rows = []
for source in sorted(baseline.glob('hd-*.png')) + sorted((baseline/'frames').glob('*.png')) + [baseline/'paused.png']:
    relative = source.relative_to(baseline)
    a = np.asarray(Image.open(source).convert('RGB'), dtype=np.int16)
    b = np.asarray(Image.open(candidate/relative).convert('RGB'), dtype=np.int16)
    assert a.shape == b.shape, relative
    diff = np.abs(a-b)
    mse = float(np.mean((a.astype(np.float64)-b)**2))
    h, w = a.shape[:2]
    blocks = (diff[:h//8*8,:w//8*8].astype(np.float32)**2).reshape(h//8,8,w//8,8,3).mean(axis=(1,3,4))
    index = np.unravel_index(np.argmax(blocks), blocks.shape)
    rows.append({'file':str(relative),'psnr':None if mse==0 else 10*math.log10(255**2/mse),
                 'maxAbs':int(diff.max()),'overOne':int((diff>1).any(axis=2).sum()),
                 'worst8x8Mse':float(blocks[index]),'worst8x8XY':[int(index[1]*8),int(index[0]*8)]})
    if relative.parent == Path('.') or rows[-1]['maxAbs']>1:
        dest=candidate/'differences'/relative
        dest.parent.mkdir(parents=True,exist_ok=True)
        Image.fromarray(np.clip(diff*12,0,255).astype(np.uint8)).save(dest)
report={'candidate':str(candidate),'frames':len(rows),'pass':all(r['maxAbs']<=1 for r in rows),
        'bitIdentical':all(r['maxAbs']==0 for r in rows),'maxAbs':max(r['maxAbs'] for r in rows),
        'worst8x8Mse':max(r['worst8x8Mse'] for r in rows),'rows':rows}
(candidate/'quality.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='rows'}))
if not report['pass']: sys.exit(1)
