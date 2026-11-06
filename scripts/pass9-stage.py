import pathlib, shutil, sys
root = pathlib.Path(__file__).resolve().parent.parent
name = sys.argv[1]
dest = root / 'output' / 'perf' / name
dest.mkdir(parents=True, exist_ok=True)
shutil.copytree(root / 'src', dest / 'source', dirs_exist_ok=True)
html = (root / 'index.html').read_text(encoding='utf-8-sig')
html = html.replace('/src/entry.ts', './source/entry.ts')
(dest / 'index.html').write_text(html, encoding='utf-8')
