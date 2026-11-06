from pathlib import Path
import json,zipfile
import imageio_ffmpeg
root=Path(__file__).resolve().parent.parent
checkpoint=zipfile.ZipFile(root/'output/checkpoints/pass9-start-20261104-180850/sources.zip')
old={name:checkpoint.read(name) for name in checkpoint.namelist() if not name.endswith('/')}
paths=list((root/'src').rglob('*.ts'))+list((root/'src').rglob('*.js'))+list((root/'scripts').glob('pass9*'))
paths += [root/name for name in ['REPORT.md','settings.html','pick.html','compare.html','vite.main.config.ts','package.json','docs/pass9-progress.md','scripts/preview-checks.mjs','scripts/float-surface-checks.mjs']]
checked=[]
for p in paths:
    if p.suffix not in ['.ts','.js','.mjs','.py','.html','.md','.json']:continue
    data=p.read_bytes();relative=p.relative_to(root).as_posix()
    if old.get(relative)==data:continue
    assert not data.startswith(b'\xef\xbb\xbf'),relative
    data.decode('utf-8');checked.append(relative)
media={}
for name,file in [('baseline','output/perf/baseline/loop.webm'),('final','output/perf/final/loop.webm'),('recording','output/playwright/pass9/recorded-loop.webm')]:
    reader=imageio_ffmpeg.read_frames(str(root/file),pix_fmt='rgb24',input_params=['-threads','4'],output_params=['-fps_mode','passthrough']);meta=next(reader);count=sum(1 for frame in reader);reader.close()
    media[name]={'size':list(meta['size']),'frames':count,'duration':meta['duration']}
    if name!='recording':assert count==121 and list(meta['size'])==[1280,720] and abs(meta['duration']-3.63)<.001
    else:assert count>20 and abs(meta['duration']-3.63)<.3
report={'pass':True,'changedTextFilesUTF8NoBOM':len(checked),'media':media}
(root/'output/perf/artifacts.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
