from pathlib import Path
import shutil,json
root=Path('output/perf');source=root/'11b-cached';dest=root/'final'
quality=json.loads((source/'quality.json').read_text());assert quality['pass']
files=list(source.glob('hd-*.png'))+list((source/'frames').glob('*.png'))+[source/'paused.png']
identical=all((dest/p.relative_to(source)).exists() and (dest/p.relative_to(source)).read_bytes()==p.read_bytes() for p in files)
for p in files:
    target=dest/p.relative_to(source);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
for name in ['quality.json','golden.json']:shutil.copyfile(source/name,dest/name)
shutil.copytree(source/'differences',dest/'differences',dirs_exist_ok=True)
(dest/'promotion.json').write_text(json.dumps({'source':str(source),'images':len(files),'sameAsPreviouslyEncodedPNGs':identical,'loopEncodingReusable':identical}),encoding='utf-8')
print('Promoted',len(files),'cached images. Existing loop encoding reusable:',identical)
if not identical:raise SystemExit(2)
