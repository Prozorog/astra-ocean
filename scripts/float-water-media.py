"""Evidence only: decode live canvas recordings; never feeds the runtime scene."""
import argparse, json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--out',default='output/playwright/float-water')
parser.add_argument('--before');parser.add_argument('--after')
parser.add_argument('--before-phases');parser.add_argument('--after-phases')
args=parser.parse_args()
OUT=(ROOT/args.out).resolve();OUT.mkdir(parents=True,exist_ok=True)
BEFORE=(ROOT/args.before).resolve() if args.before else OUT/'before'
AFTER=(ROOT/args.after).resolve() if args.after else OUT/'final'
BEFORE_PHASES=(ROOT/args.before_phases).resolve() if args.before_phases else BEFORE/'current'
AFTER_PHASES=(ROOT/args.after_phases).resolve() if args.after_phases else AFTER/'result'
FF=imageio_ffmpeg.get_ffmpeg_exe()
FONT=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',14)
FRAMES=[0,20,40,60,80,100,120]
def frames(filename):
    command=[FF,'-v','error','-threads','1','-i',str(filename),'-vf','fps=30,scale=500:281','-threads','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']
    p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    size=500*281*3
    try:
        while True:
            data=p.stdout.read(size)
            if not data:break
            while len(data)<size:
                more=p.stdout.read(size-len(data))
                if not more:raise RuntimeError(f'Partial decoded frame: {filename}')
                data+=more
            yield Image.frombytes('RGB',(500,281),data)
        error=p.stderr.read().decode(errors='replace');code=p.wait()
        if code:raise RuntimeError(f'{filename}: {error}')
    finally:
        p.stdout.close();p.stderr.close()
        if p.poll() is None:p.terminate();p.wait()
def verify(filename):
    p=subprocess.run([FF,'-v','error','-threads','2','-i',str(filename),'-threads','2','-progress','pipe:1','-f','null','NUL' if sys.platform=='win32' else '/dev/null'],capture_output=True,text=True,check=True)
    values={}
    for line in p.stdout.splitlines():
        if '=' in line:
            key,value=line.split('=',1);values[key]=value
    return {'file':str(filename.relative_to(ROOT)),'decoded':values.get('progress')=='end','frames':int(values['frame']),'durationSeconds':int(values.get('out_time_us','0'))/1e6}
def writer(filename,width=1000):
    w=imageio_ffmpeg.write_frames(str(filename),(width,306),fps=30,codec='libx264',pix_fmt_in='rgb24',pix_fmt_out='yuv420p',macro_block_size=1,output_params=['-threads','2','-crf','18'])
    w.send(None);return w
def tile(images,labels):
    result=Image.new('RGB',(500*len(images),306),(24,34,37));draw=ImageDraw.Draw(result)
    for i,(image,label) in enumerate(zip(images,labels)):
        draw.text((i*500+8,4),label,font=FONT,fill='white');result.paste(image,(i*500,24))
    return result
report={'recordings':[],'comparisons':[],'reference':'Original GIF frames, 30ms each; reference never enters live ocean rendering.'}
for stage in [BEFORE,AFTER]:
    for name in ['idle','throw','tap-seam']:
        file=stage/f'{name}.webm'
        if file.exists():report['recordings'].append(verify(file))
for directory in [BEFORE_PHASES,BEFORE/'no-foam-relief',BEFORE/'no-quadratic',AFTER_PHASES]:
    file=directory/'continuous.webm'
    if file.exists():report['recordings'].append(verify(file))
if (AFTER/'idle.webm').exists():
    for name in ['idle','throw']:
        a,b=frames(BEFORE/f'{name}.webm'),frames(AFTER/f'{name}.webm')
        file=OUT/f'{name}-before-after.mp4';w=writer(file);count=0
        try:
            for x,y in zip(a,b):
                image=tile([x,y],[f'BEFORE / LIVE {name}',f'AFTER / LIVE {name}']);w.send(image.tobytes())
                if count in [0,90,180]:image.save(OUT/f'{name}-decoded-{count:03}.png')
                count+=1
            for _ in a:pass
            for _ in b:pass
        finally:w.close();a.close();b.close()
        item=verify(file);item['resampledFrames']=count;report['comparisons'].append(item)
    trace=json.loads((AFTER/'idle-trace.json').read_text())
    phase=trace[0]['phase'];file=OUT/'reference-live-result.mp4';w=writer(file);count=0
    try:
        for count,actual in enumerate(frames(AFTER/'idle.webm')):
            ref_index=int(((phase+count/30)%3.63)/.03)%121
            ref=Image.open(ROOT/f'output/reference/reference-{ref_index:03}.png').convert('RGB').resize((500,281),Image.Resampling.LANCZOS)
            image=tile([ref,actual],[f'GIF / phase {ref_index:03}',f'LIVE RESULT / {count/30:.2f}s']);w.send(image.tobytes())
    finally:w.close()
    item=verify(file);item['phaseAlignment']='First recorded trace phase; <= one render-frame offset, no retiming of result.';report['comparisons'].append(item)
    sheet=Image.new('RGB',(1500,7*306),(24,34,37))
    for row,frame in enumerate(FRAMES):
        inputs=[ROOT/f'output/reference/reference-{frame:03}.png',BEFORE_PHASES/f'{frame:03}.png',AFTER_PHASES/f'{frame:03}.png']
        images=[Image.open(p).convert('RGB').resize((500,281),Image.Resampling.LANCZOS) for p in inputs]
        sheet.paste(tile(images,[f'GIF {frame:03}',f'BEFORE {frame:03}',f'RESULT {frame:03}']),(0,row*306))
        if frame in [0,60,100]:
            for name,roi in [('crest',(50,15,450,180)),('foam',(150,20,340,110)),('ball-reflection',(165,75,310,245))]:
                crops=[image.crop(roi) for image in [images[0],images[2]]];height=round((roi[3]-roi[1])*500/(roi[2]-roi[0]))
                detail=Image.new('RGB',(1000,height+24),(24,34,37));draw=ImageDraw.Draw(detail)
                for column,(image,label) in enumerate(zip(crops,['GIF','RESULT'])):
                    draw.text((column*500+8,4),f'{label} / {name} / {frame:03}',font=FONT,fill='white')
                    detail.paste(image.resize((500,height),Image.Resampling.LANCZOS),(column*500,24))
                detail.save(OUT/f'detail-{name}-{frame:03}.png')
    sheet.save(OUT/'contact-sheet.png')
    report['details']={'phases':[0,60,100],'method':'Identical fixed ROIs in both 500x281 images, enlarged without colour changes. Frozen-phase water morphology only; ball dynamics are proven by live recordings.'}
(OUT/'media-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
