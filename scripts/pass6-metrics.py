"""Ungraded image/video measurements for the Phillips/JONSWAP comparison."""
import argparse, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
import imageio_ffmpeg

parser=argparse.ArgumentParser();parser.add_argument('--stage',default='pass6');opt=parser.parse_args()
ROOT=Path(__file__).resolve().parent.parent;OUT=ROOT/'output/playwright'/opt.stage
FRAMES=[0,20,40,60,80,100,120];SIZE=(500,281)
def rgb(path,size=SIZE):
    im=Image.open(path).convert('RGB')
    if size:im=im.resize(size,Image.Resampling.LANCZOS)
    return np.asarray(im,dtype=float)
def water_mask(a):
    seed=(a[:,:,1]>a[:,:,0]*.92)&(a[:,:,2]>a[:,:,0]*.88)
    labels,_=ndi.label(seed);counts=np.bincount(labels.ravel());counts[0]=0
    return ndi.binary_fill_holes(ndi.binary_closing(labels==counts.argmax(),iterations=2))
def hsv(a):
    a=a/255;hi=a.max(2);lo=a.min(2);diff=hi-lo;h=np.zeros(hi.shape)
    for channel,value in enumerate([(a[:,:,1]-a[:,:,2])/np.maximum(diff,1e-9),(a[:,:,2]-a[:,:,0])/np.maximum(diff,1e-9)+2,(a[:,:,0]-a[:,:,1])/np.maximum(diff,1e-9)+4]):
        h[(a.argmax(2)==channel)&(diff>0)]=value[(a.argmax(2)==channel)&(diff>0)]
    return (h*60)%360,diff/np.maximum(hi,1e-9)
def hx(a):return '#'+''.join(f'{int(round(v)):02x}' for v in a)
def measure(a,mask,foam=None):
    lum=a@np.array([.2126,.7152,.0722]);h,s=hsv(a)
    water=mask&~((a[:,:,0]>a[:,:,1]*1.5)&(a[:,:,0]>130));inside=ndi.binary_erosion(mask,iterations=2)
    def gaussian(sigma):return ndi.gaussian_filter(lum*mask,sigma)/np.maximum(ndi.gaussian_filter(mask.astype(float),sigma),1e-6)
    g15=gaussian(1.5);g6=gaussian(6);glints=water&(a.mean(2)>200);labels,count=ndi.label(glints,np.ones((3,3)));areas=np.bincount(labels.ravel())[1:]
    faces=g6>=np.percentile(g6[water],70);ys,xs=np.where(mask)
    foam=foam if foam is not None else mask&(h>180)&(s>.2)&(a[:,:,2]>a[:,:,0]*1.3)&(lum>70)
    return dict(hue=float(np.median(h[water])),saturation=float(np.median(s[water])),luminance=np.percentile(lum[water],[5,25,50,75,95]).tolist(),
      glintSpecks=count,medianSpeckPixels=float(np.median(areas)) if len(areas) else 0,glintPixelsPercent=float(glints.sum()/mask.sum()*100),
      glintsOnLitFaces=float((glints&faces).sum()/max(1,glints.sum())),fineStd=float(np.std((lum-g15)[inside])),
      bandStd=[float(np.std(b[inside])) for b in [lum-g15,g15-g6,g6]],foamCoveragePercent=float(foam.sum()/mask.sum()*100),
      foamMean=hx(a[foam].mean(0)) if foam.any() else None,foamStd=float(np.std(lum[foam])) if foam.any() else None,
      silhouetteWidth=float((xs.max()-xs.min()+1)/500),silhouetteHeightWidth=float((ys.max()-ys.min()+1)/(xs.max()-xs.min()+1)))
def puff_measure(beauty_path,id_path):
    ids=np.asarray(Image.open(id_path).convert('RGB'));beauty=rgb(beauty_path,None);lum=beauty@np.array([.2126,.7152,.0722])
    packed=ids[:,:,0].astype(np.uint32)*65536+ids[:,:,1].astype(np.uint32)*256+ids[:,:,2];counts=np.bincount(packed.ravel(),minlength=1)
    candidates=np.where((counts>=12)&(counts<1500))[0];samples=[];colours=[]
    for value in candidates:
        region=ndi.binary_erosion(packed==value)
        if region.sum()>=5:
            samples.append(float(np.std(lum[region])));colours.extend(beauty[region].tolist())
    return dict(measuredPuffs=len(samples),medianInteriorStd=float(np.median(samples)) if samples else None,p95InteriorStd=float(np.percentile(samples,95)) if samples else None,
        minInteriorStd=min(samples) if samples else None,puffsStdAtLeast12Share=float(np.mean(np.array(samples)>=12)) if samples else None,
        puffMean=hx(np.mean(colours,axis=0)) if colours else None,allInteriorStds=samples)

result={'frames':{},'motion':{}}
result['frames']['reference']=[]
for frame in FRAMES:
    a=rgb(ROOT/f'output/reference/reference-{frame:03d}.png');result['frames']['reference'].append(dict(frame=frame,**measure(a,water_mask(a))))
for model in ['phillips','jonswap']:
    meta_path=OUT/f'{model}-frames.json'
    if not meta_path.exists():continue
    metadata=json.loads(meta_path.read_text(encoding='utf-8'));meta={row['frame']:row for row in metadata['frames']};rows=[]
    for frame in FRAMES:
        a=rgb(OUT/f'{model}-{frame:03d}.png');diag=np.asarray(Image.open(OUT/f'{model}-{frame:03d}-mask.png').convert('RGB').resize(SIZE,Image.Resampling.NEAREST));mask=diag[:,:,0]>200
        m=measure(a,mask,mask&(diag[:,:,1]>=128));ev=meta[frame];spectrum=ev['spectrum']
        m.update(frame=frame,reliefPercent=ev['reliefPercent'],aboveMean=spectrum['areaAboveMeanFraction'],minJ=spectrum['minFinalJacobian'],acceptedPatchAreas=ev.get('acceptedPatchAreas'),anchor=ev.get('anchor'))
        id_path=OUT/f'{model}-{frame:03d}-puff-ids.png'
        if id_path.exists():m.update(puff_measure(OUT/f'{model}-{frame:03d}.png',id_path))
        rows.append(m)
    result['frames'][model]=rows
    video=OUT/f'{model}-live.webm'
    if video.exists():
        reader=imageio_ffmpeg.read_frames(str(video),pix_fmt='rgb24',input_params=['-threads','4'],output_params=['-vf','fps=28','-threads','4','-filter_threads','4']);info=next(reader);width,height=info['size'];tracks=[[],[]]
        for raw in reader:
            pair=np.frombuffer(raw,np.uint8).reshape(height,width,3)
            for half in [0,1]:
                a=pair[:281,half*500:(half+1)*500].astype(float);mask=water_mask(a);ys,xs=np.where(mask)
                ball=(a[:,:,0]>210)&(a[:,:,1]>65)&(a[:,:,1]<225)&(a[:,:,2]<a[:,:,1]*.55)
                labels,count=ndi.label(ndi.binary_erosion(ndi.binary_closing(ball)))
                candidates=[]
                for component in range(1,count+1):
                    by,bx=np.where(labels==component)
                    if len(bx)<90:continue
                    bw,bh=np.ptp(bx)+1,np.ptp(by)+1
                    if not (.55<bw/bh<1.8 and bw<50 and bh<50):continue
                    centre=[float(bx.mean()),float(by.mean())]
                    if not (125<centre[0]<375 and 35<centre[1]<225):continue
                    distance=np.linalg.norm(np.array(centre)-tracks[half][-1]['ball']) if tracks[half] else 0
                    candidates.append((distance if tracks[half] else -len(bx),centre))
                if not candidates:raise RuntimeError(f'Ball segmentation missing: {model}, half {half}, frame {len(tracks[half])}')
                centre=min(candidates,key=lambda c:c[0])[1]
                tracks[half].append(dict(ball=centre,top=float(ys.min()),bottom=float(ys.max()),left=float(xs.min()),right=float(xs.max()),width=float((xs.max()-xs.min()+1)/500),heightWidth=float((ys.max()-ys.min()+1)/(xs.max()-xs.min()+1))))
        summaries=[]
        for track in tracks:
            p=np.array([r['ball'] for r in track]);speed=np.linalg.norm(np.diff(p,axis=0),axis=1)
            summaries.append(dict(frames=len(track),ballY=float(np.ptp(p[:,1])/281),ballX=float(np.ptp(p[:,0])/500),speedMedian=float(np.median(speed)),speedP95=float(np.percentile(speed,95)),
                topY=float(np.ptp([r['top'] for r in track])/281),bottomY=float(np.ptp([r['bottom'] for r in track])/281),leftX=float(np.ptp([r['left'] for r in track])/500),rightX=float(np.ptp([r['right'] for r in track])/500),
                width=np.percentile([r['width'] for r in track],[0,50,100]).tolist(),heightWidth=np.percentile([r['heightWidth'] for r in track],[0,50,100]).tolist()))
        result['motion'][model]=dict(reference=summaries[0],simulation=summaries[1],tracks=tracks,videoInfo=info)

available=[m for m in ['reference','phillips','jonswap'] if m in result['frames']]
def tile(model,frame):
    path=ROOT/f'output/reference/reference-{frame:03d}.png' if model=='reference' else OUT/f'{model}-{frame:03d}.png'
    return Image.open(path).convert('RGB').resize(SIZE,Image.Resampling.LANCZOS)
def sheet(frames,name,horizontal=False):
    if horizontal:width,height=len(frames)*500,len(available)*305
    else:width,height=len(available)*500,len(frames)*305
    im=Image.new('RGB',(width,height),'#152829');draw=ImageDraw.Draw(im)
    for mi,model in enumerate(available):
        for fi,frame in enumerate(frames):
            x,y=(fi*500,mi*305) if horizontal else (mi*500,fi*305)
            im.paste(tile(model,frame),(x,y+24));draw.text((x+10,y+5),f'{model} / {frame:03d}',fill='white')
    im.save(OUT/name)
sheet(FRAMES,'contact.png');sheet(list(range(60,94,3)),'consecutive-060-093.png',True)
(OUT/'metrics.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(dict(frameRanges={m:{key:[min(r[key] for r in rows),max(r[key] for r in rows)] for key in ['hue','saturation','glintSpecks','glintPixelsPercent','medianSpeckPixels','glintsOnLitFaces','fineStd','foamCoveragePercent']} for m,rows in result['frames'].items()},motion={m:{k:v for k,v in d.items() if k!='tracks'} for m,d in result['motion'].items()}),indent=2))
