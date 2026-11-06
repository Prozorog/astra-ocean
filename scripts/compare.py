"""Read the supplied GIF only; assemble contact/detail/motion evidence."""
from pathlib import Path
import json
import math
import shutil
import subprocess
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageStat

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r'C:\Main\WorkPlace\Muse spark\Ocaen simalation\floating-ocean\ocean simalation.gif')
OUT = ROOT / 'output' / 'playwright'
REFERENCE = ROOT / 'output' / 'reference'
REFERENCE.mkdir(parents=True, exist_ok=True)
TIMES = [0, .6, 1.2, 1.8, 2.4, 3, 3.63]
font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 16)
small = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 13)
frames = {}
with Image.open(SOURCE) as gif:
    metadata = {'frames': gif.n_frames, 'size': gif.size, 'source': str(SOURCE), 'duration_ms': gif.info.get('duration')}
for i in [0, 20, 40, 60, 80, 100]:
    frames[i] = Image.open(REFERENCE / f'reference-{i:03}.png').convert('RGB')

evidence = json.loads((OUT / 'evidence.json').read_text(encoding='utf-8'))
height = 90 + len(TIMES) * 313
sheet = Image.new('RGB', (1036, height), '#182a2b')
draw = ImageDraw.Draw(sheet)
draw.text((18, 15), 'FLOATING OCEAN / finished-water pass 3', font=font, fill='#deece6')
draw.text((18, 47), 'REFERENCE / 500 x 281', font=small, fill='#91b9bb')
draw.text((530, 47), 'WEBGL2 / 1280 x 720, reduced to 500 x 281', font=small, fill='#91b9bb')
rendered = {}
for row, time in enumerate(TIMES):
    index = 0 if time == 3.63 else round(time / .03)
    name = f'ocean-{time:.2f}'.replace('.', '-') + '.png'
    image = Image.open(OUT / name).convert('RGB')
    rendered[index] = image.resize((500, 281), Image.Resampling.LANCZOS)
    y = 82 + row * 313
    sheet.paste(frames[index], (18, y))
    sheet.paste(rendered[index], (530, y))
    draw.text((18, y + 285), f't = {time:4.2f} s    GIF frame {index:03}', font=small, fill='#bfd1ce')
    draw.text((530, y + 285), f't = {time:4.2f} s    frozen GPU frame', font=small, fill='#bfd1ce')
sheet.save(OUT / 'contact-sheet.png')
sheet.resize((777, round(height * .75)), Image.Resampling.LANCZOS).save(OUT / 'contact-sheet-small.png')
zero = Image.open(OUT / 'ocean-0-00.png').convert('RGB')
end = Image.open(OUT / 'ocean-3-63.png').convert('RGB')
difference = ImageChops.difference(zero, end)
difference.save(OUT / 'loop-difference.png')


def colour_mean(colours):
    if not colours:
        return None
    count = len(colours)
    rgb = [round(sum(pixel[channel] for pixel in colours) / count) for channel in range(3)]
    return {'rgb': rgb, 'hex': '#%02x%02x%02x' % tuple(rgb), 'pixels': count}


def luminance(pixel):
    return .2126 * pixel[0] + .7152 * pixel[1] + .0722 * pixel[2]


def orange_ball_center(image):
    candidates = set()
    for y in range(40, 220):
        for x in range(80, 420):
            r, g, b = image.getpixel((x, y))
            if r > 220 and 75 < g < 205 and b < 70:
                candidates.add((x, y))
    largest = []
    while candidates:
        start = candidates.pop()
        component, stack = [start], [start]
        while stack:
            x, y = stack.pop()
            for neighbour in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]:
                if neighbour in candidates:
                    candidates.remove(neighbour)
                    component.append(neighbour)
                    stack.append(neighbour)
        if len(component) > len(largest):
            largest = component
    return (sum(x for x, _ in largest) / len(largest), sum(y for _, y in largest) / len(largest)) if largest else (250, 140)


def crop_box(center, width, height):
    left = max(0, min(500 - width, round(center[0] - width / 2)))
    top = max(0, min(281 - height, round(center[1] - height / 2)))
    return (left, top, left + width, top + height)


# Each source is first normalized to the GIF's pixel scale. All crops are 2x,
# with the exact boxes retained below; no enhancement or relighting.
detail = Image.new('RGB', (1036, 775), '#182a2b')
dd = ImageDraw.Draw(detail)
dd.text((18, 15), '2x DETAIL / ball (left) + back mound (right)', font=font, fill='#deece6')
dd.text((18, 45), 'REFERENCE', font=small, fill='#91b9bb')
dd.text((530, 45), 'RENDER', font=small, fill='#91b9bb')
crops = []
for row, index in enumerate([0, 60, 100]):
    reference = frames[index]
    time = index * .03
    state = next(frame for frame in evidence['frames'] if abs(frame['requestedTime'] - time) < .001)
    render = rendered[index]
    reference_center = orange_ball_center(reference)
    render_center = (state['ballScreen'][0] * 500, state['ballScreen'][1] * 281)
    mask = Image.open(OUT / (state['filename'][:-4] + '-waterMask.png')).convert('RGB').resize((500, 281))
    ref_cloud = [(x, y) for y in range(30, 155) for x in range(80, 430) if (lambda p: p[1] > 125 and p[0] < p[1] * .9 and p[2] > p[1] * .85)(reference.getpixel((x, y)))]
    render_cloud = [(x, y) for y in range(10, 180) for x in range(50, 470) if mask.getpixel((x, y))[1] >= 100]
    def centroid(points, fallback):
        return (sum(x for x, _ in points) / len(points), sum(y for _, y in points) / len(points)) if points else fallback
    ref_mound = centroid(ref_cloud, (250, 95))
    render_mound = centroid(render_cloud, ((state['bounds']['left'] + state['bounds']['right']) * 250, state['bounds']['top'] * 281 + 35))
    boxes = {'frame': index, 'reference_ball': crop_box(reference_center, 80, 90), 'render_ball': crop_box(render_center, 80, 90),
             'reference_mound': crop_box(ref_mound, 160, 90), 'render_mound': crop_box(render_mound, 160, 90)}
    crops.append(boxes)
    y = 94 + row * 220
    dd.text((18, y - 21), f'FRAME {index:03} / t={time:.2f}s', font=small, fill='#bfd1ce')
    for x, image, ball_key, mound_key in [(18, reference, 'reference_ball', 'reference_mound'), (530, render, 'render_ball', 'render_mound')]:
        detail.paste(image.crop(boxes[ball_key]).resize((160, 180), Image.Resampling.NEAREST), (x, y))
        detail.paste(image.crop(boxes[mound_key]).resize((320, 180), Image.Resampling.NEAREST), (x + 174, y))
detail.save(OUT / 'detail-sheet.png')

colour_frames = []
for state in evidence['frames']:
    image = Image.open(OUT / state['filename']).convert('RGB')
    water = Image.open(OUT / (state['filename'][:-4] + '-waterMask.png')).convert('RGB')
    shadow = Image.open(OUT / (state['filename'][:-4] + '-shadowMask.png')).convert('RGB')
    all_water, body = [], []
    ball = state['ballBounds']
    for index, (pixel, mask) in enumerate(zip(image.get_flattened_data(), water.get_flattened_data())):
        x, y = index % image.width, index // image.width
        in_ball = ball['left'] - 4 <= x <= ball['right'] + 4 and ball['top'] - 4 <= y <= ball['bottom'] + 4
        if mask[0] > 250 and not in_ball and pixel[0] <= pixel[1] * 1.3:
            all_water.append(pixel)
            if mask[1] < 90 and mask[2] < 128:
                body.append(pixel)
    body.sort(key=luminance)
    count = max(1, round(len(body) * .15))
    line_colours, baseline_colours = [], []
    for y in range(60, image.height - 30):
        for x in range(100, image.width - 60):
            pixel = image.getpixel((x, y))
            if shadow.getpixel((x, y))[0] < 40 or water.getpixel((x, y))[0] > 10 or pixel[0] < pixel[1] * 1.35:
                continue
            clear = []
            for dx, dy in [(12, 0), (-12, 0), (0, 12), (0, -12), (20, 0), (-20, 0)]:
                qx, qy = x + dx, y + dy
                if shadow.getpixel((qx, qy))[0] < 3 and water.getpixel((qx, qy))[0] < 10:
                    clear.append(image.getpixel((qx, qy)))
            if clear:
                line_colours.append(pixel)
                baseline_colours.append(tuple(sum(p[c] for p in clear) / len(clear) for c in range(3)))
    line = colour_mean(line_colours)
    baseline = colour_mean(baseline_colours)
    darkness = 1 - sum(map(luminance, line_colours)) / sum(map(luminance, baseline_colours)) if line_colours else None
    colour_frames.append({'time': state['requestedTime'], 'whole_water': colour_mean(all_water), 'deep_body': colour_mean(body),
                          'trough_15_percent': colour_mean(body[:count]), 'crest_15_percent': colour_mean(body[-count:]),
                          'shadow_line': line, 'neighbour_floor': baseline, 'shadow_line_darkness': darkness})

# Explicit masked colour populations, not colours selected by eye.
first = evidence['frames'][0]
mask = Image.open(OUT / 'ocean-0-00-waterMask.png').convert('RGB')
ball_bounds = first['ballBounds']
cx, cy = (first['ballScreen'][0] * 1280, first['ballScreen'][1] * 720)
diameter = ball_bounds['diameterPixels']
body, mound, orange = [], [], []
for y in range(zero.height):
    for x in range(zero.width):
        pixel = zero.getpixel((x, y))
        water = mask.getpixel((x, y))
        in_ball = ball_bounds['left'] - 4 <= x <= ball_bounds['right'] + 4 and ball_bounds['top'] - 4 <= y <= ball_bounds['bottom'] + 4
        if water[0] < 250 or in_ball:
            continue
        r, g, b = pixel
        if r < g * 1.3:
            if water[1] < 38 and water[2] < 26:
                body.append(pixel)
            if water[1] > 153:
                mound.append(pixel)
        if r > 160 and r > 1.8 * g and 15 < g < 180 and b < g * .8 and abs(x - cx) < diameter * 1.3 and cy < y < cy + diameter * 2.6:
            orange.append(pixel)
body.sort(key=luminance)
dark_open = body[round(len(body) * .15):round(len(body) * .60)]
radius = max(2, round(diameter * .08))
ball_centre = [zero.getpixel((x, y)) for y in range(round(cy) - radius, round(cy) + radius + 1) for x in range(round(cx) - radius, round(cx) + radius + 1)]
floor_image = Image.open(OUT / 'floor-centre.png').convert('RGB')
floor_centre = [floor_image.getpixel((x, y)) for y in range(350, 371) for x in range(630, 651)]
colour_table = {
    'Dark open water': {'render': colour_mean(dark_open), 'reference': '#2e4a49'},
    'Mound average': {'render': colour_mean(mound), 'reference': '#5697a8'},
    'Orange reflection streak average': {'render': colour_mean(orange), 'reference': '#f3481a'},
    'Ball centre': {'render': colour_mean(ball_centre), 'reference': '#ffb347'},
    'Floor centre': {'render': colour_mean(floor_centre), 'reference': '#ce7363'},
}

# One-diameter scanlines beside the ball, at the reference's 500px image scale.
# Count resolved local maxima after a 0.65px Gaussian (grain suppression).
wavelets = []
for index in [0, 60, 100]:
    state = next(frame for frame in evidence['frames'] if abs(frame['requestedTime'] - index * .03) < .001)
    for name, image, center, d in [
        ('reference', frames[index], orange_ball_center(frames[index]), 32),
        ('render', rendered[index], (state['ballScreen'][0] * 500, state['ballScreen'][1] * 281), state['ballBounds']['diameterPixels'] * 500 / 1280),
    ]:
        gray = image.convert('L').filter(ImageFilter.GaussianBlur(.65))
        x0 = round(center[0] + d * .65)
        counts = []
        for offset in [.35, .5, .65, .8, .95]:
            y = max(0, min(280, round(center[1] + d * offset)))
            values = [gray.getpixel((max(0, min(499, x0 + x)), y)) for x in range(round(d))]
            peaks = [x for x in range(2, len(values) - 2) if values[x] > values[x - 1] and values[x] >= values[x + 1]
                     and values[x] - min(values[max(0, x - 2):x]) >= 3 and values[x] - min(values[x + 1:x + 3]) >= 3]
            counts.append(len(peaks))
        wavelets.append({'frame': index, 'source': name, 'diameter_at_500px': d, 'resolved_peak_counts': counts})

def lab_colour(pixel):
    rgb = [value / 255 for value in pixel]
    rgb = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in rgb]
    r, g, b = rgb
    xyz = [(.4124564*r + .3575761*g + .1804375*b) / .95047,
           .2126729*r + .7151522*g + .0721750*b,
           (.0193339*r + .1191920*g + .9503041*b) / 1.08883]
    f = [value ** (1/3) if value > .008856 else 7.787 * value + 16/116 for value in xyz]
    return (116*f[1]-16, 500*(f[0]-f[1]), 200*(f[1]-f[2]))

body_target, hot_target = lab_colour((254, 138, 6)), lab_colour((255, 194, 77))
pass3_frames = []
for state in evidence['frames']:
    stem = state['filename'][:-4]
    image = Image.open(OUT / state['filename']).convert('RGB')
    water = Image.open(OUT / f'{stem}-waterMask.png').convert('RGB')
    distance = Image.open(OUT / f'{stem}-distanceMask.png').convert('RGB')
    position = Image.open(OUT / f'{stem}-positionMask.png').convert('RGB')
    disk = Image.open(OUT / f'{stem}-ballMask.png').convert('RGB')
    shadow = Image.open(OUT / f'{stem}-shadowMask.png').convert('RGB')
    red_cracks = far_open = body_hits = hot_hits = disk_pixels = side_spill = back_spill = 0
    streaks, forwards, shadow_ratios = [], [], []
    for pixel, mask_pixel, dist, pos, ball_pixel, shadow_pixel, clear_floor in zip(
        image.get_flattened_data(), water.get_flattened_data(), distance.get_flattened_data(),
        position.get_flattened_data(), disk.get_flattened_data(), shadow.get_flattened_data(), floor_image.get_flattened_data()
    ):
        r, g, b = pixel
        if ball_pixel[0] > 250:
            disk_pixels += 1
            lab = lab_colour(pixel)
            body_hits += sum((a-z)**2 for a, z in zip(lab, body_target)) < 144
            hot_hits += sum((a-z)**2 for a, z in zip(lab, hot_target)) < 144
            continue
        if mask_pixel[0] > 250:
            if mask_pixel[1] < 38 and dist[0] / 255 * 4 > 3 * 1.24:
                far_open += 1
                if r > g + 20 and r > b + 20 and luminance(pixel) < 90:
                    red_cracks += 1
            if mask_pixel[1] < 38 and mask_pixel[2] < 128 and 110 < luminance(pixel) < 230 and max(pixel) - min(pixel) < 64:
                streaks.append(pixel)
            if r > 120 and r > 1.8*g and r > b*1.8:
                forward, lateral = (pos[0]/255 - .5)*12, pos[1]/255*6
                forwards.append(forward)
                side_spill += lateral > 1.24 + .03
                back_spill += forward < -1.24 - .03
        elif shadow_pixel[0] >= 90 and r > g * 1.35 and luminance(clear_floor) > 40:
            shadow_ratios.append(luminance(pixel) / luminance(clear_floor))
    pass3_frames.append({
        'time': state['requestedTime'], 'dark_red_pixels': red_cracks, 'far_open_pixels': far_open,
        'streak_colour': colour_mean(streaks),
        'body_deltaE12_share': body_hits / disk_pixels if disk_pixels else None,
        'hot_deltaE12_share': hot_hits / disk_pixels if disk_pixels else None,
        'deltaE_method': 'CIE76 Lab, D65; visible depth-tested disk pixels',
        'orange_side_pixels_beyond_1D': side_spill, 'orange_back_pixels_beyond_1D': back_spill,
        'orange_column_length_diameters': (max(forwards) - max(0, min(forwards))) / 1.24 if forwards else 0,
        'shadow_srgb_luminance_ratio': sum(shadow_ratios) / len(shadow_ratios) if shadow_ratios else None,
        'shadow_ratio_pixels': len(shadow_ratios), 'variance': state.get('variance'),
    })

patch = zero.crop((70, 45, 170, 145)).convert('L')
blurred = patch.filter(ImageFilter.BoxBlur(1.5))
residual = [a - b for a, b in zip(patch.get_flattened_data(), blurred.get_flattened_data())]
mean_residual = sum(residual) / len(residual)
grain_rms = math.sqrt(sum((v - mean_residual) ** 2 for v in residual) / len(residual)) / ImageStat.Stat(patch).mean[0]
comparison_dir = OUT / 'motion-comparison'
comparison_dir.mkdir(exist_ok=True)
render_dir = OUT / 'motion-render'
render_files = sorted(render_dir.glob('frame-*.jpg'))
clip = None
if len(render_files) == 121:
    for i, render_file in enumerate(render_files):
        pair = Image.new('RGB', (1000, 282), '#182a2b')
        pair.paste(Image.open(REFERENCE / f'reference-{i:03}.png').convert('RGB'), (0, 0))
        pair.paste(Image.open(render_file).convert('RGB').resize((500, 281), Image.Resampling.LANCZOS), (500, 0))
        pair.save(comparison_dir / f'frame-{i:03}.png')
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        try:
            from imageio_ffmpeg import get_ffmpeg_exe
        except ImportError:
            pass  # The frame-folder deliverable needs only Pillow.
        else:
            ffmpeg = get_ffmpeg_exe()
    if ffmpeg:
        clip = OUT / 'reference-vs-render.mp4'
        subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-framerate', '100/3', '-i', str(comparison_dir / 'frame-%03d.png'),
                        '-c:v', 'libx264', '-threads', '4', '-crf', '18', '-pix_fmt', 'yuv420p', str(clip)], check=True)

metrics = {'reference': metadata, 'loop_pixel_identical': difference.getbbox() is None,
           'loop_max_channel_difference': max(extent[1] for extent in difference.getextrema()), 'colour_frames': colour_frames,
           'colour_method': 'visible top mask; exclude projected ball and orange path; trough/crest = lower/upper body luminance 15%, excluding milk >= 0.35 and glints >= 0.5',
           'shadow_method': 'projected darkness >= 40/255 outside visible water, paired with clear floor 12-20 px away',
           'grain_highpass_rms_percent': grain_rms * 100, 'detail_crops_at_500px': crops,
           'colour_table': colour_table,
           'pass3': pass3_frames,
           'pass2_colour_method': 'frame 0; open top milk < .15, sun < .1, luminance percentiles 15-60%; mound milk > .6; red-orange pixels R>160 and R>1.8G within 1.3D lateral and 2.6D down; ball centre radius .08D; floor-only no-shadow centre 21px patch',
           'wavelets': wavelets, 'wavelet_method': 'five one-diameter horizontal scanlines beside ball at 500px; Gaussian .65px; local peak two-pixel prominence >=3 code values; report-only, not a substitute for visual review',
           'motion_frames': len(render_files), 'motion_clip': str(clip) if clip else None, 'motion_fallback': str(comparison_dir),
           'motion_encoder': ffmpeg if len(render_files) == 121 else None}
(OUT / 'comparison.json').write_text(json.dumps(metrics, indent=2), encoding='utf-8')
print(json.dumps(metrics, indent=2))
print(f'Contact: {OUT / "contact-sheet.png"}\nDetails: {OUT / "detail-sheet.png"}\nMotion: {clip or comparison_dir}')
if difference.getbbox() is not None:
    raise SystemExit('Pixel-identical loop seam HARD CHECK FAILED')
