"""Prepare Step 1 preview media; retain raw upstream recordings as evidence."""
import json
import shutil
import subprocess
from pathlib import Path
import imageio_ffmpeg
from PIL import Image, ImageDraw

out = Path('output/playwright/pass8-base')
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
shot_ids = ['open-ocean', 'breakers', 'flotsam', 'golden-hour', 'storm-close']
report = {'shots': {}, 'legacy': {}}

def encode(source, destination, filters, seconds=None):
    args = [ffmpeg, '-y', '-v', 'error', '-i', str(source), '-an', '-vf', filters]
    if seconds is not None:
        args += ['-t', str(seconds)]
    args += ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '5',
             '-crf', '20', '-b:v', '0', '-row-mt', '1', '-threads', '4', str(destination)]
    subprocess.run(args, check=True)

def inspect(filename):
    reader = imageio_ffmpeg.read_frames(str(filename), pix_fmt='rgb24')
    metadata = next(reader)
    count, first, last = 0, None, None
    try:
        for frame in reader:
            if first is None:
                first = frame
            last = frame
            count += 1
    finally:
        reader.close()
    return {'size': list(metadata['size']), 'fps': metadata['fps'],
            'duration': metadata['duration'], 'frames': count,
            'bytes': filename.stat().st_size, 'moving': first != last}

shutil.copyfile(Path(r'C:\Main\WorkPlace\Muse spark\Ocaen simalation\floating-ocean\ocean simalation.gif'), out / 'reference.gif')
for shot in shot_ids:
    video, raw = out / f'{shot}.webm', out / f'{shot}.source.webm'
    if not raw.exists():
        video.rename(raw)
    encode(raw, video, 'fps=30', 6)
    data = inspect(video)
    data['stillSize'] = list(Image.open(out / f'{shot}.png').size)
    assert data['size'] == [1280, 720] and data['stillSize'] == [1280, 720], data
    assert data['frames'] == 180 and abs(data['duration'] - 6) < .04 and data['moving'], data
    report['shots'][shot] = data
    print(f"{shot}: 1280x720, {data['frames']} frames, {data['duration']} seconds", flush=True)

shutil.copyfile(Path('output/playwright/pass6-final/jonswap-000.png'), out / 'current-f.png')
shutil.copyfile(Path('output/playwright/water-lab/P-000.png'), out / 'poseidon-p.png')
# The historical F clip is a reference/F pair: extract only its right half.
encode(Path('output/playwright/pass6-final/jonswap-live.webm'), out / 'current-f.webm', 'crop=iw/2:ih:iw/2:0,fps=30')
encode(Path('output/playwright/water-lab/comparison-P.mp4'), out / 'poseidon-p.webm', 'fps=30')
for name in ['current-f', 'poseidon-p']:
    data = inspect(out / f'{name}.webm')
    assert data['moving'] and data['frames'] > 90, data
    data['stillSize'] = list(Image.open(out / f'{name}.png').size)
    report['legacy'][name] = data

contact = Image.new('RGB', (1280, 3 * 388), '#151719')
draw = ImageDraw.Draw(contact)
for i, name in enumerate(shot_ids + ['current-f']):
    image = Image.open(out / f'{name}.png').convert('RGB')
    image.thumbnail((640, 360))
    x, y = (i % 2) * 640, (i // 2) * 388
    contact.paste(image, (x + (640-image.width)//2, y))
    draw.text((x+12, y+366), name, fill='#ffffff')
contact.save(out / 'contact.png')
(out / 'media.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
