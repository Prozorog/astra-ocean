"""Measurements of ungraded 500x281 captures. Evidence only, never runtime input."""
import argparse, json, colorsys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
args = argparse.ArgumentParser()
args.add_argument('--stage', default='pass5')
args.add_argument('--contact', action='store_true')
opt = args.parse_args()
OUT = ROOT / 'output/playwright' / opt.stage
FRAMES = [0, 20, 40, 60, 80, 100, 120]
SIZE = (500, 281)

def rgb(path):
    return np.asarray(Image.open(path).convert('RGB').resize(SIZE, Image.Resampling.LANCZOS), dtype=float)

def reference_mask(a):
    seed = (a[:,:,1] > a[:,:,0]*.92) & (a[:,:,2] > a[:,:,0]*.88)
    labels, _ = ndi.label(seed)
    counts = np.bincount(labels.ravel()); counts[0] = 0
    seed = labels == counts.argmax()
    return ndi.binary_fill_holes(ndi.binary_closing(seed, iterations=2))

def hsv(a):
    a = a / 255
    hi, lo = a.max(2), a.min(2)
    diff = hi-lo
    h = np.zeros(hi.shape)
    for channel, value in enumerate([(a[:,:,1]-a[:,:,2])/np.maximum(diff,1e-9), (a[:,:,2]-a[:,:,0])/np.maximum(diff,1e-9)+2, (a[:,:,0]-a[:,:,1])/np.maximum(diff,1e-9)+4]):
        sel = (a.argmax(2) == channel) & (diff > 0)
        h[sel] = value[sel]
    return (h*60)%360, diff / np.maximum(hi,1e-9)

def measure(a, mask, foam=None):
    lum = a @ np.array([.2126,.7152,.0722])
    h, s = hsv(a)
    inside = ndi.binary_erosion(mask, iterations=2)
    water = mask & ~((a[:,:,0]>a[:,:,1]*1.5) & (a[:,:,0]>130))
    qs = np.percentile(lum[water], [5,25,50,75,95])
    bright = water & (lum >= qs[-1])
    warm = (a[:,:,0]>a[:,:,2]) & (a[:,:,0]>a[:,:,1]*.98)
    specks = water & (a.mean(2)>200)
    labels, count = ndi.label(specks, np.ones((3,3)))
    areas = np.bincount(labels.ravel())[1:]
    # Filter in normalized material mask, then erode to avoid coral boundary leakage.
    den = ndi.gaussian_filter(mask.astype(float), 6)
    g6 = ndi.gaussian_filter(lum*mask, 6)/np.maximum(den,1e-6)
    g15 = ndi.gaussian_filter(lum*mask, 1.5)/np.maximum(ndi.gaussian_filter(mask.astype(float),1.5),1e-6)
    floor = ~ndi.binary_dilation(mask, iterations=7) & (a[:,:,0]>a[:,:,1]*1.35)
    mound = foam if foam is not None else (mask & (h>180) & (s>.2) & (a[:,:,2]>a[:,:,0]*1.3) & (lum>70))
    mean_floor = a[floor].mean(0)
    def hx(vals): return '#'+''.join(f'{int(round(x)):02x}' for x in vals)
    return dict(hue=float(np.median(h[water])), saturation=float(np.median(s[water])), luminance=qs.tolist(),
        darkQuartileRGB=np.median(a[water & (lum>=qs[0]) & (lum<=qs[1])],axis=0).tolist(),
        glintSpecks=int(count), glintPixelsPercent=float(specks.sum()/mask.sum()*100), glintLargestPixels=int(areas.max()) if len(areas) else 0,
        bandStd=[float(np.std(v[inside])) for v in [lum-g15,g15-g6,g6]],
        brightWarmShare=float(warm[bright].mean()), brightWarm=bool(warm[bright].mean()>.5),
        floor=mean_floor.tolist(), floorHex=hx(mean_floor), foamCoveragePercent=float(mound.sum()/mask.sum()*100),
        foamMean=a[mound].mean(0).tolist() if mound.any() else None,
        foamHex=hx(a[mound].mean(0)) if mound.any() else None, waterPixels=int(mask.sum()))

metadata_path=OUT/'frames.json'
metadata={r['frame']:r for r in json.loads(metadata_path.read_text(encoding='utf-8'))['frames']} if metadata_path.exists() else {}
rows=[]
for fr in FRAMES:
    ref = rgb(ROOT/f'output/reference/reference-{fr:03d}.png')
    current = rgb(OUT/f'F-{fr:03d}.png')
    diag = np.asarray(Image.open(OUT/f'F-{fr:03d}-mask.png').convert('RGB').resize(SIZE,Image.Resampling.NEAREST))
    mask = diag[:,:,0]>200
    after=measure(current,mask,(diag[:,:,1]>=128)&mask)
    if fr in metadata:
        ev=metadata[fr]['ev']; cx,cy=ev['ballScreen'];cx*=500;cy*=281
        radius=ev['ballRadiusPixels']*500/Image.open(OUT/f'F-{fr:03d}.png').width
        yy,xx=np.mgrid[:281,:500];rr=np.hypot(xx-cx,yy-cy)/radius
        core=(rr<.2);body=(rr>.4)&(rr<.65)&(yy<cy);limb=(rr>.88)&(rr<.96)&(yy<cy)
        def hexrgb(a): return '#'+''.join(f'{int(round(x)):02x}' for x in a)
        after.update(ballDiameter=2*radius,ballCore=hexrgb(np.median(current[core],axis=0)),ballBody=hexrgb(np.median(current[body],axis=0)),ballLimb=hexrgb(np.median(current[limb],axis=0)))
        nb_path=OUT/f'F-{fr:03d}-no-bloom.png'
        if nb_path.exists():
            delta=np.maximum(0,current-rgb(nb_path)) @ np.array([.2126,.7152,.0722])
            profile=[]
            for ring in np.arange(1.05,4.01,.05):
                region=(rr>=ring)&(rr<ring+.05)&(yy<cy)
                profile.append([float(ring),float(delta[region].mean()) if region.any() else 0.])
            after['bloomHaloRadiusAtDeltaY1']=max([r for r,y in profile if y>=1.]+[1.])
            after['haloProfile']=profile
        after.update(reflection=metadata[fr]['reflection'],reliefPercent=ev['reliefPercent'],areaAboveMean=ev['spectrum']['areaAboveMeanFraction'],minJacobian=ev['spectrum']['minFinalJacobian'])
    rows.append(dict(frame=fr, reference=measure(ref, reference_mask(ref)), after=after))

(OUT/'metrics.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
print(json.dumps([dict(frame=r['frame'], **{k:r['after'][k] for k in ['hue','saturation','luminance','glintSpecks','glintPixelsPercent','bandStd','brightWarmShare','floorHex','foamCoveragePercent','foamHex']}) for r in rows],indent=2))
if opt.contact:
    font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',16)
    contact=Image.new('RGB',(1500,7*310+30),'#192329');draw=ImageDraw.Draw(contact)
    for i,title in enumerate(['Reference','Before / pass 4','After / pass 5']):draw.text((i*500+10,5),title,font=font,fill='white')
    for row,fr in enumerate(FRAMES):
        imgs=[Image.open(ROOT/f'output/reference/reference-{fr:03d}.png'),Image.open(ROOT/f'output/playwright/f-surface-character/fold-contrast/{fr:03d}.png'),Image.open(OUT/f'F-{fr:03d}.png')]
        for col,im in enumerate(imgs):
            im=im.convert('RGB').resize(SIZE,Image.Resampling.LANCZOS)
            contact.paste(im,(col*500,row*310+30));draw.text((col*500+8,row*310+313),f'Frame {fr:03d}',font=font,fill='white')
        if fr in [0,40,100]:
            for label,box in [('whole',(0,0,500,281)),('ball',(170,85,315,210)),('crest',(70,50,300,160)),('foam',(110,15,370,145))]:
                crop=Image.new('RGB',((box[2]-box[0])*6,(box[3]-box[1])*2+28),'#192329');cd=ImageDraw.Draw(crop)
                for col,im in enumerate(imgs):
                    im=im.convert('RGB').resize(SIZE,Image.Resampling.LANCZOS).crop(box).resize(((box[2]-box[0])*2,(box[3]-box[1])*2),Image.Resampling.NEAREST)
                    crop.paste(im,(col*im.width,28));cd.text((col*im.width+6,4),['Reference','Before','After'][col],font=font,fill='white')
                crop.save(OUT/f'crop-{label}-{fr:03d}.png')
    contact.save(OUT/'contact.png')
