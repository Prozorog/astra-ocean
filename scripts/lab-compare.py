"""Offline lab comparison. Reads existing reference PNGs; never writes the GIF."""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/playwright/water-lab'
REFERENCE = ROOT / 'output/reference'
CAPTURE = json.loads((OUT / 'capture.json').read_text(encoding='utf-8'))
BG, FG, MUTED = '#182c2e', '#dfefea', '#a4c1bb'
try:
    FONT = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 14)
    TITLE = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 20)
except OSError:
    FONT = TITLE = ImageFont.load_default()

def colour(pixels):
    if not pixels:
        return None
    rgb = tuple(round(sum(p[i] for p in pixels) / len(pixels)) for i in range(3))
    return {'rgb': rgb, 'hex': '#%02x%02x%02x' % rgb, 'pixels': len(pixels)}

def luminance(p):
    return .2126 * p[0] + .7152 * p[1] + .0722 * p[2]

def clamp_crop(image, centre, size):
    w, h = size
    x = max(0, min(image.width - w, round(centre[0] - w / 2)))
    y = max(0, min(image.height - h, round(centre[1] - h / 2)))
    return image.crop((x, y, x + w, y + h))

def reference_ball(image):
    points = {(x, y) for y in range(image.height) for x in range(image.width)
              if (lambda p: p[0] > 220 and 95 < p[1] < 235 and p[2] < 100 and p[1] > p[2] + 45)(image.getpixel((x, y)))}
    # Reflection bars are red-orange too. A disk-sized connected component,
    # not their combined centroid, owns the reference ember crop.
    best = []
    while points:
        seed = points.pop()
        group, pending = [seed], [seed]
        while pending:
            x, y = pending.pop()
            for point in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if point in points:
                    points.remove(point)
                    group.append(point)
                    pending.append(point)
        if len(group) > len(best):
            best = group
    if not best:
        raise ValueError('Reference ember not found')
    return ((min(p[0] for p in best) + max(p[0] for p in best)) / 2,
            (min(p[1] for p in best) + max(p[1] for p in best)) / 2)

def crest_centre(image, mask=None, ball=None):
    if mask is None:
        candidates = [(x, y) for y in range(20, 200, 2) for x in range(40, 460, 2)
                      if (lambda p: p[1] > 125 and p[0] < p[1] * .9 and p[2] > p[1] * .88)(image.getpixel((x, y)))]
        if candidates:
            return (sum(x for x, _ in candidates) / len(candidates), sum(y for _, y in candidates) / len(candidates))
        return (250, 95)
    # Average a patch rather than picking a single normal/sparkle texel. Blue
    # is the variant's slope diagnostic; green is actual foam coverage.
    best, centre = -1, (250, 100)
    for cy in range(35, 240, 10):
        for cx in range(70, 440, 10):
            if ball and math.hypot(cx - ball[0], cy - ball[1]) < 50:
                continue
            values = []
            for y in range(cy - 25, cy + 26, 5):
                for x in range(cx - 35, cx + 36, 5):
                    p = mask.getpixel((x, y))
                    if p[0] > 240:
                        values.append(p[2] + p[1] * .35)
            if len(values) >= 65:
                score = sum(values) / len(values)
                if score > best:
                    best, centre = score, (cx, cy)
    return centre

# One detail sheet per candidate: reference and candidate, three matched times.
for variant, result in CAPTURE['variants'].items():
    sheet = Image.new('RGB', (1240, 990), BG)
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 12), f'WATER LAB / {variant} / 2x DETAIL', fill=FG, font=TITLE)
    for row, state in enumerate(result['frozen']):
        frame = state['frame']; y = 65 + row * 305
        ref = Image.open(REFERENCE / f'reference-{frame:03d}.png').convert('RGB')
        render = Image.open(OUT / state['filename']).convert('RGB').resize((500, 281), Image.Resampling.LANCZOS)
        mask = Image.open(OUT / f'{variant}-{frame:03d}-mask.png').convert('RGB').resize((500, 281), Image.Resampling.NEAREST)
        ref_ball = reference_ball(ref)
        ball = (state['evidence']['ballScreen'][0] * 500, state['evidence']['ballScreen'][1] * 281)
        for column, (image, centre, crest, label) in enumerate([(ref, ref_ball, crest_centre(ref), 'REFERENCE'), (render, ball, crest_centre(render, mask, ball), variant)]):
            x = 20 + column * 610
            draw.text((x, y - 23), f'{label} / FRAME {frame:03d} / {frame * .03:.2f}s', fill=MUTED, font=FONT)
            sheet.paste(clamp_crop(image, centre, (120, 130)).resize((240, 260), Image.Resampling.NEAREST), (x, y))
            sheet.paste(clamp_crop(image, crest, (180, 130)).resize((360, 260), Image.Resampling.NEAREST), (x + 246, y))
    sheet.save(OUT / f'detail-{variant}.png')

metrics = {'referenceTargets': {'open': '#2e4a49', 'mound': '#5697a8'}, 'variants': {}, 'cropMethod': 'All images normalized to 500x281; fixed 120x130 ball and 180x130 crest windows, enlarged exactly 2x. Crest uses a patch of slope/foam diagnostic, not a bright single pixel.'}
if '--details-only' in sys.argv:
    raise SystemExit(0)
if 'F' in CAPTURE['available']:
    before = Image.open(OUT / 'F-true-dispersion-start.png').convert('RGB')
    after = Image.open(OUT / 'F-true-dispersion-end.png').convert('RGB')
    metrics['FTrueDispersionDoesNotRepeat'] = ImageChops.difference(before, after).getbbox() is not None
    metrics['FSpecifiedDefaultCoveragePercent'] = [state['evidence']['foamCoverage'] * 100 for state in CAPTURE['defaultF']]
for variant, result in CAPTURE['variants'].items():
    rows = []
    for state in result['frozen']:
        image = Image.open(OUT / state['filename']).convert('RGB')
        mask = Image.open(OUT / f"{variant}-{state['frame']:03d}-mask.png").convert('RGB')
        water, open_water, mound, dense = [], [], [], []
        count, caps = 0, 0
        for pixel, signal in zip(image.getdata(), mask.getdata()):
            if signal[0] <= 240:
                continue
            count += 1
            if signal[1] >= 128:
                caps += 1
            water.append(pixel)
            if signal[1] < 35 and not (pixel[0] > 100 and pixel[0] > pixel[1] * 1.3):
                open_water.append(pixel)
            if 64 <= signal[1] <= 204 and pixel[0] < pixel[1] * 1.15:
                mound.append(pixel)
            if signal[1] > 230:
                dense.append(pixel)
        open_water.sort(key=luminance)
        dark = open_water[len(open_water) * 15 // 100:len(open_water) * 60 // 100]
        rows.append({'frame': state['frame'], 'time': state['time'], 'darkOpenWater': colour(dark), 'wholeOpenWater': colour(open_water), 'wholeWater': colour(water), 'mound': colour(mound), 'denseWhitecaps': colour(dense), 'whitecapCoveragePercent': 100 * caps / count if count else None, 'reliefPercent': state['evidence']['reliefPercent']})
    a, b = Image.open(OUT / f'{variant}-seam-start.png'), Image.open(OUT / f'{variant}-seam-end.png')
    difference = ImageChops.difference(a.convert('RGB'), b.convert('RGB'))
    metrics['variants'][variant] = {'frames': rows, 'pixelIdenticalFrozenSeam': difference.getbbox() is None, 'maxSeamChannelDifference': max(v[1] for v in difference.getextrema()), 'presets': f'best-{variant}.json'}

# Shared reference + all candidates contact sheet at frames 0,60,100.
columns = ['reference'] + CAPTURE['available']
contact = Image.new('RGB', (20 + len(columns) * 510, 1000), BG)
draw = ImageDraw.Draw(contact); draw.text((20, 14), 'WATER LAB / SAME CAMERA / RIGID TUMBLE / NO BEND', fill=FG, font=TITLE)
for column, name in enumerate(columns):
    draw.text((20 + column * 510, 48), name.upper(), fill=MUTED, font=FONT)
    for row, frame in enumerate([0, 60, 100]):
        image = Image.open(REFERENCE / f'reference-{frame:03d}.png' if name == 'reference' else OUT / f'{name}-{frame:03d}.png').convert('RGB').resize((500, 281), Image.Resampling.LANCZOS)
        x, y = 20 + column * 510, 78 + row * 305
        contact.paste(image, (x, y)); draw.text((x, y + 283), f'{frame:03d} / {frame * .03:.2f}s', fill=MUTED, font=FONT)
contact.save(OUT / 'contact-sheet.png')

# Two exact 121-frame loops, side-by-side in the requested 1280x720 output.
for variant, result in CAPTURE['variants'].items():
    output = OUT / f'comparison-{variant}.mp4'
    writer = imageio_ffmpeg.write_frames(str(output), (1280, 720), fps=100 / 3, codec='libx264', pix_fmt_in='rgb24', pix_fmt_out='yuv420p', output_params=['-crf', '18', '-preset', 'fast', '-threads', '4', '-movflags', '+faststart'])
    writer.send(None)
    try:
        for index in range(242):
            frame = index % 121
            ref = Image.open(REFERENCE / f'reference-{frame:03d}.png').convert('RGB').resize((640, 360), Image.Resampling.LANCZOS)
            render = Image.open(OUT / result['motion'][frame]).convert('RGB').resize((640, 360), Image.Resampling.LANCZOS)
            image = Image.new('RGB', (1280, 720), BG); image.paste(ref, (0, 180)); image.paste(render, (640, 180)); draw = ImageDraw.Draw(image)
            draw.text((20, 140), 'REFERENCE', fill=MUTED, font=TITLE); draw.text((660, 140), f'VARIANT {variant}', fill=MUTED, font=TITLE)
            draw.text((20, 568), f'LOOP {index // 121 + 1}/2   {frame:03d}/120   {frame * .03:0.2f}s', fill=MUTED, font=FONT)
            writer.send(image.tobytes())
    finally:
        writer.close()
    metrics['variants'][variant]['mp4'] = str(output)
    metrics['variants'][variant]['videoFrames'] = 242
    metrics['variants'][variant]['videoSeconds'] = 7.26

metrics['colourMethod'] = 'Visible water mask; dark open sample is 15–60th luminance percentile of non-foam/non-orange pixels. Mound is intermediate actual foam coverage 64–204/255, excluding orange; dense whitecaps >230/255. S has no whitecap model, so mound is null rather than fabricated.'
(OUT / 'comparison.json').write_text(json.dumps(metrics, indent=2), encoding='utf-8')
print(json.dumps(metrics, indent=2))
