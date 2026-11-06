"""Encode the headed-browser F recording; no synthetic interaction frames."""
import json
import subprocess
from pathlib import Path
import imageio_ffmpeg
from PIL import Image

out = Path('output/playwright/water-lab')
source, destination = out / 'F-interaction.webm', out / 'F-interaction.mp4'
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-i', str(source), '-an',
                '-vf', 'fps=60', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
                '-threads', '4', '-movflags', '+faststart', str(destination)], check=True)
reader = imageio_ffmpeg.read_frames(str(destination), pix_fmt='rgb24')
metadata = next(reader)
selected = []
try:
    for index, frame in enumerate(reader):
        if index in [0, 60, 120, 180, 240]:
            image = Image.frombytes('RGB', metadata['size'], frame)
            image.save(out / f'interaction-frame-{index:03d}.png')
            selected.append(index)
finally:
    reader.close()
report = {'file': str(destination), 'bytes': destination.stat().st_size,
          'seconds': metadata['duration'], 'size': metadata['size'], 'fps': metadata['fps'],
          'decodedFrames': index + 1, 'inspectedFrameIndices': selected}
assert report['bytes'] > 10000 and report['seconds'] > 6 and report['size'] == (1280, 720)
(out / 'interaction-media.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
