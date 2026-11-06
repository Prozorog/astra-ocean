import json, subprocess, sys
from pathlib import Path
import imageio_ffmpeg
for name in sys.argv[1:]:
    root=Path('output/perf')/name
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-v','error','-framerate','100/3','-i',str(root/'frames/%03d.png'),'-frames:v','121','-an','-c:v','libvpx-vp9','-lossless','1','-pix_fmt','yuv444p','-deadline','realtime','-cpu-used','5','-threads','4','-row-mt','1',str(root/'loop.webm')],check=True)
    reader=imageio_ffmpeg.read_frames(str(root/'loop.webm'),pix_fmt='rgb24',input_params=['-threads','4'],output_params=['-fps_mode','passthrough']);meta=next(reader);count=sum(1 for frame in reader);reader.close()
    assert count==121 and list(meta['size'])==[1280,720] and abs(meta['duration']-3.63)<.001
    (root/'media.json').write_text(json.dumps({'frames':count,'size':list(meta['size']),'duration':meta['duration'],'codec':'VP9 lossless YUV444; identical conversion for A/B','bytes':(root/'loop.webm').stat().st_size},indent=2),encoding='utf-8')
    print(name,count,meta['duration'])
