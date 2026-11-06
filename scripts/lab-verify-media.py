"""Use the existing FFmpeg decoder; ffprobe is not installed on this host."""
import json
from pathlib import Path
from PIL import Image, ImageStat
import imageio_ffmpeg

root = Path('output/playwright/water-lab')
report = {}
for variant in ['F', 'P', 'S']:
    path = root / f'comparison-{variant}.mp4'
    reader = imageio_ffmpeg.read_frames(str(path), pix_fmt='rgb24')
    metadata = next(reader)
    proof = Image.new('RGB', (1280, 1080), '#182c2e')
    count = 0
    deviations = []
    try:
        for index, frame in enumerate(reader):
            count += 1
            if index in [0, 20, 40, 60, 80, 100]:
                image = Image.frombytes('RGB', metadata['size'], frame)
                row, column = divmod([0, 20, 40, 60, 80, 100].index(index), 2)
                proof.paste(image.resize((640, 360)), (column * 640, row * 360))
                deviations.append(ImageStat.Stat(image.crop((640, 180, 1280, 540))).stddev)
    finally:
        reader.close()
    assert count == 242, (variant, count)
    assert metadata['size'] == (1280, 720)
    assert abs(metadata['duration'] - 7.26) < .04
    assert all(max(value) > 20 for value in deviations), 'A decoded comparison tile is blank'
    proof.save(root / f'media-proof-{variant}.png')
    report[variant] = {'size': metadata['size'], 'fps': metadata['fps'], 'seconds': metadata['duration'],
                       'decodedFrames': count, 'bytes': path.stat().st_size, 'nonblank': True}
(root / 'media-verification.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report, indent=2))
