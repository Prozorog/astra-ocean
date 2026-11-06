"""Encode and verify a frozen-phase 121-frame / 3.63-second look tile."""
import json
import subprocess
import sys
from pathlib import Path
import imageio_ffmpeg

tile = Path(sys.argv[1])
destination = tile / 'loop.webm'
tile.mkdir(parents=True, exist_ok=True)
source = Path(sys.argv[2]) if len(sys.argv) > 2 else tile / 'frames/%03d.png'
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-v', 'error', '-framerate', '100/3',
                '-i', str(source), '-vf', 'scale=640:360', '-an', '-frames:v', '121',
                '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '5', '-crf', '20', '-b:v', '0',
                '-threads', '4', '-row-mt', '1', str(destination)], check=True)
reader = imageio_ffmpeg.read_frames(str(destination), pix_fmt='rgb24')
meta = next(reader)
count = 0
try:
    for _ in reader:
        count += 1
finally:
    reader.close()
assert list(meta['size']) == [640, 360] and count == 121 and abs(meta['duration'] - 3.63) < .001, (meta, count)
report = {'size': list(meta['size']), 'frames': count, 'duration': meta['duration'], 'fps': meta['fps'], 'bytes': destination.stat().st_size}
(tile / 'media.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
