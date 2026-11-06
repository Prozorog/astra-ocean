from pathlib import Path
import json,math
import numpy as np
from PIL import Image
import imageio_ffmpeg
root=Path('output/perf/anchors');report={}
for name,tile in [('main',5),('storm',3)]:
    old=Path(f'output/playwright/pass8-round1-reflections/tile-{tile}')
    rows=[]
    decoder=imageio_ffmpeg.read_frames(str(old/'loop.webm'),pix_fmt='rgb24',input_params=['-threads','4'],output_params=['-fps_mode','passthrough']);next(decoder)
    for i,source in enumerate(sorted((root/name/'frames').glob('*.png'))):
        a=np.asarray(Image.open(old/'frames'/source.name).convert('RGB'),dtype=np.int16)
        b=np.asarray(Image.open(source).convert('RGB'),dtype=np.int16)
        diff=np.abs(a-b);mse=float(np.mean((a.astype(float)-b)**2));
        d=np.abs(np.frombuffer(next(decoder),dtype=np.uint8).reshape(a.shape).astype(np.int16)-b)
        blocks=(diff.astype(float)**2).reshape(45,8,80,8,3).mean(axis=(1,3,4))
        rows.append({'frame':i,'maxAbs':int(diff.max()),'psnr':None if not mse else 10*math.log10(255**2/mse),'worst8x8Mse':float(blocks.max()),'webmMaxAbs':int(d.max()),'webmMse':float(np.mean(d.astype(float)**2))})
    decoder.close()
    report[name]={'tile':tile,'frames':len(rows),'pass':all(r['maxAbs']<=1 for r in rows),'maxAbs':max(r['maxAbs'] for r in rows),'worst8x8Mse':max(r['worst8x8Mse'] for r in rows),'webmMaxAbs':max(r['webmMaxAbs'] for r in rows),'rows':rows}
(root/'quality.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:{n:v for n,v in r.items() if n!='rows'} for k,r in report.items()}))
if not all(r['pass'] for r in report.values()):raise SystemExit(1)
