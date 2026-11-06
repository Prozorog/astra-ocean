"""Encode the actual two-loop playback captures, without retiming or grading."""
from pathlib import Path
import subprocess
import imageio_ffmpeg
folder=Path(__file__).resolve().parent.parent/'output/playwright/pass6-final'
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
for model in ['phillips','jonswap']:
    subprocess.run([ffmpeg,'-y','-v','error','-threads','4','-filter_threads','4',
        '-i',str(folder/f'{model}-live.webm'),'-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-c:v','libx264','-threads','4','-crf','18','-pix_fmt','yuv420p',
        '-fps_mode','passthrough',str(folder/f'{model}-live.mp4')],check=True)
    print(model,'encoded')
