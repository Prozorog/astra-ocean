"""Matched-size evidence from live renders, never a reference texture in the scene."""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg
ROOT = Path(__file__).resolve().parent.parent
stage = sys.argv[1] if len(sys.argv) > 1 else 'A'
MAIN = stage == 'main'
OUT = ROOT / 'output/playwright/storm-box' if MAIN else ROOT / 'output/playwright/storm-box' / stage
PREFIX = 'main' if MAIN else 'F'
MOTION = OUT / ('main-motion' if MAIN else 'motion')
FRAMES = [0,20,40,60,80,100,120]
font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 14)
sheet = Image.new('RGB',(1000,7*303),(25,38,40))
draw = ImageDraw.Draw(sheet)
for row, frame in enumerate(FRAMES):
    ref = Image.open(ROOT/f'output/reference/reference-{frame:03d}.png').convert('RGB').resize((500,281),Image.Resampling.LANCZOS)
    actual = Image.open(OUT/f'{PREFIX}-{frame:03d}.png').convert('RGB').resize((500,281),Image.Resampling.LANCZOS)
    draw.text((8,row*303+3),f'REFERENCE {frame:03d} / {frame*.03:.2f}s',fill='white',font=font)
    draw.text((508,row*303+3),f'LIVE WATER {stage} / {frame:03d}',fill='white',font=font)
    sheet.paste(ref,(0,row*303+22));sheet.paste(actual,(500,row*303+22))
sheet.save(OUT/'contact-sheet.png')
if (MOTION/'000.jpg').exists():
    filename=OUT/('reference-main-two-cycles.mp4' if MAIN else 'comparison-two-cycles.mp4')
    writer=imageio_ffmpeg.write_frames(str(filename),(1000,282),fps=100/3,codec='libx264',pix_fmt_in='rgb24',pix_fmt_out='yuv420p',macro_block_size=1,output_params=['-threads','4','-crf','17'])
    writer.send(None)
    for frame in range(242):
        a=Image.open(ROOT/f'output/reference/reference-{frame%121:03d}.png').convert('RGB').resize((500,281),Image.Resampling.LANCZOS)
        b=Image.open(MOTION/f'{frame:03d}.jpg').convert('RGB').resize((500,281),Image.Resampling.LANCZOS)
        pair=Image.new('RGB',(1000,282));pair.paste(a,(0,0));pair.paste(b,(500,0));writer.send(pair.tobytes())
    writer.close()
    reader=imageio_ffmpeg.read_frames(str(filename),output_params=['-threads','4'])
    meta=next(reader); count=0
    for decoded in reader:
        if count in [0,60,120,121,180,241]:Image.frombytes('RGB',meta['size'],decoded).save(OUT/f'decoded-{count:03d}.png')
        count+=1
    verification={'file':filename.name,'frames':count,'seconds':count/(100/3),'decoded':count==242,'metadata':meta,'method':'242 consecutive fixed-step live engine frames; no seek at loop boundaries'}
    (OUT/'media-verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
    if count!=242:raise RuntimeError(verification)
    print(json.dumps(verification,indent=2))
    if MAIN:
        # Image-space continuity is measured on the actual consecutively played
        # frames, not two wrapped endpoint seeks or decoded reference masks.
        differences=[]
        for frame in range(1,243):
            a=Image.open(MOTION/f'{frame-1:03d}.jpg').convert('RGB').resize((250,141))
            b=Image.open(MOTION/f'{frame:03d}.jpg').convert('RGB').resize((250,141))
            differences.append(sum(abs(x-y) for x,y in zip(a.tobytes(),b.tobytes()))/(250*141*3))
        verification['adjacentFrameMeanRGBDelta']={'median':sorted(differences)[len(differences)//2],'maximum':max(differences),'seam120to121':differences[120],'seam241to242':differences[241],'screenSize':[250,141]}
        (OUT/'media-verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
if MAIN:
    def centre(image, kind):
        pixels=image.load(); width,height=image.size
        if kind=='ball':
            candidates={(x,y) for y in range(height) for x in range(width) if pixels[x,y][0]>190 and pixels[x,y][1]>90 and pixels[x,y][2]<pixels[x,y][1]*.55}
        else:
            candidates={(x,y) for y in range(35,190) for x in range(60,440) if pixels[x,y][2]>pixels[x,y][0]*1.15 and pixels[x,y][1]>95 and pixels[x,y][2]>105}
        # Select a visible connected feature only for the crop, never as a
        # physical-foam-area measurement or a simulation feedback mask.
        groups=[]
        while candidates:
            first=candidates.pop(); todo=[first]; group=[first]
            while todo:
                x,y=todo.pop()
                for q in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                    if q in candidates:candidates.remove(q);todo.append(q);group.append(q)
            groups.append(group)
        if not groups:raise RuntimeError(f'No visible {kind} feature found for a truthful detail crop')
        group=max(groups,key=len)
        return sum(p[0] for p in group)/len(group),sum(p[1] for p in group)/len(group)
    for frame in [0,60,100]:
        images=[Image.open(ROOT/f'output/reference/reference-{frame:03d}.png').convert('RGB').resize((500,281),Image.Resampling.LANCZOS),Image.open(OUT/f'main-{frame:03d}.png').convert('RGB').resize((500,281),Image.Resampling.LANCZOS)]
        for name,size,zoom in [('crest',(180,110),2),('foam',(80,80),3),('ball',(90,90),2),('reflection',(110,90),2)]:
            w,h=size; detail=Image.new('RGB',(w*zoom*2,h*zoom+24),(25,38,40));d=ImageDraw.Draw(detail)
            for side,image in enumerate(images):
                cx,cy=centre(image,'ball' if name in ['ball','reflection'] else 'foam')
                if name=='reflection':cy+=35
                x=max(0,min(500-w,round(cx-w/2)));y=max(0,min(281-h,round(cy-h/2)))
                crop=image.crop((x,y,x+w,y+h)).resize((w*zoom,h*zoom),Image.Resampling.LANCZOS)
                detail.paste(crop,(side*w*zoom,24));d.text((side*w*zoom+5,3),f'{"REF" if side==0 else "MAIN"} {name} {frame:03d}',fill='white',font=font)
            detail.save(OUT/f'detail-{name}-{frame:03d}.png')
print(OUT/'contact-sheet.png')
