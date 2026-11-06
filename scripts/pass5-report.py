"""Assemble the report from saved measurements; never change scene parameters."""
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/playwright/pass5-rework'
MOTION = ROOT / 'output/playwright/pass5-rework-motion'

def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))

def n(value, digits=2):
    return f'{value:.{digits}f}'

def vals(items, digits=1):
    return ' / '.join(n(value, digits) for value in items)

def link(name, filename):
    return f'[{name}](output/playwright/pass5-rework/{filename})'

metrics = read('output/playwright/pass5-rework/metrics.json')
frames = read('output/playwright/pass5-rework/frames.json')
audit = read('output/playwright/pass5-rework/audit.json')['audit']
performance = read('output/playwright/preview/performance.json')
lab = read('output/playwright/storm-box/lab-checks.json')
surface = read('output/playwright/float-water/surface-checks.json')
preview = read('output/playwright/preview/checks.json')

motion = {}
for label, filename in [('Lab', 'motion'), ('Main', 'mainmotion')]:
    doc = json.loads((MOTION / f'{filename}.json').read_text(encoding='utf-8'))
    rows = doc['motion']['rows']
    p = np.array([row['gpu'] for row in rows])
    dt = (np.diff([row['phase'] for row in rows]) + 3.63) % 3.63
    steps = np.linalg.norm(np.diff(p, axis=0), axis=1)
    second = np.linalg.norm(np.diff(p, n=2, axis=0), axis=1)
    ratios = [float(steps[i] / max(float(np.median(np.r_[steps[i-5:i], steps[i+1:i+6]])), 1e-9))
              for i in range(5, len(steps)-5)]
    velocity = np.diff(p, axis=0) / np.maximum(dt[:, None], 1e-9)
    normalized = np.linalg.norm(np.diff(velocity, axis=0), axis=1)
    normalized /= np.maximum((dt[:-1] + dt[1:]) * .5, 1e-9) * 3600
    residual = p - np.array([r['anchor'] for r in rows]) - np.array([r['offset'] for r in rows]) - [0, .23, 0]
    alone = all(sum(line.startswith('job "') for line in doc[key].splitlines()) == 1
                for key in ['queueBefore', 'queueAfter'])
    motion[label] = dict(frames=len(rows), elapsedSeconds=float(dt.sum()), fps=float(1/dt.mean()),
        p95=float(np.percentile(second,95)), maximum=float(second.max()),
        stepMedian=float(np.median(steps)), stepMaximum=float(steps.max()),
        heldFrames=int((steps<1e-6).sum()), neighbourOutliers=sum(r>2.5 for r in ratios),
        maxNeighbourRatio=max(ratios), frameMs=np.percentile(dt*1000,[50,95,100]).tolist(),
        normalized60=np.percentile(normalized,[95,100]).tolist(),
        immersion=[min(r['immersion'] for r in rows),max(r['immersion'] for r in rows)],
        heightfieldRange=np.percentile(residual[:,1],[0,50,100]).tolist(),
        paneVisible=doc['motion']['paneVisible'], queueIdle=alone,
        renderer=doc['motion']['renderer'], errors=doc['errors'])
(MOTION/'summary.json').write_text(json.dumps(motion,indent=2,ensure_ascii=False),encoding='utf-8')
for name, data in [('lab-checks',lab),('surface-checks',surface),('preview-checks',preview),('performance',performance)]:
    (OUT/f'{name}.json').write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')

lines = [
    '# Floating Ocean — pass 5: переработка после отклонённого результата', '',
    'F: **http://localhost:4103/lab.html?variant=F** · главная: **http://localhost:4103/**', '',
    '**Предыдущий результат отклонён пользователем: вода выглядела искусственным материалом.** '
    'Успешные проверки не подтверждали визуальное качество. После замечания изменены формы '
    'волн, отражения, направленная рябь и способ изображения пены. Новый вариант сохранён '
    'отдельно. **Совпадения с GIF и выполнения всех мягких целей нет.** Все известные '
    'расхождения перечислены ниже; вариант не объявляется принятым пользователем.', '',
    '## Изображения и живое воспроизведение', '',
    '- '+link('GIF / отклонённый pass 5 / новая поверхность, кадры 0 и 40','rework-comparison.png')+'.',
    '- '+link('Reference / before pass 4 / after, семь фаз по 500×281','contact.png')+'.',
    '- '+link('Три непрерывных цикла reference / F, MP4','reference-f-live.mp4')+'; '+
        link('исходный WebM','reference-f-live.webm')+'. Записано реальное проигрывание видимой '
        'страницы, без seek, замены кадров, изменения скорости и цветокоррекции. MP4 добавляет '
        'к высоте 281 один чёрный пиксель снизу для yuv420p.',
    '- [Lab во время trace](output/playwright/pass5-rework-motion/lab-pane.png); '
        '[главная во время trace](output/playwright/pass5-rework-motion/main-pane.png).',
]
for kind,label in [('whole','весь лист'),('ball','окрестность шара'),('crest','гребень'),('foam','пена')]:
    lines.append('- Кропы ×2, '+label+': '+', '.join(link(str(f),f'crop-{kind}-{f:03d}.png') for f in [0,40,100])+'.')
lines += ['', '## Реализация', '',
    '- Шар и вода читают одну позицию/нормаль из 1×1 float MRT **текущего кадра**: C0+C1 и '
    'актуальный interaction heightfield. CPU-пробы остались для физики контактов/бросков и '
    'picking, видимую позу не задают. Fallback с экстраполяцией не использован. Offset '
    'физики сглажен критически затухающей пружиной ω=12 rad/s.',
    '- C0/C1 и несущая карта используют float32 вместо half-float, чтобы убрать квантование '
    'позиции. Максимальная ошибка CPU-зеркала относительно GPU в 121 фазе: '+n(audit['maxAnchorError'],8)+
    ' единицы. Устранена обратная связь: нейтральный tracked-шар больше не возбуждает воду '
    'запаздывающей высотой контакта, вытеснение рассчитывается в материальных координатах.',
    '- Optical-column brightening удалён. Body linear RGB=(0.04,0.06,0.0585). Gaussian-пятна '
    'окружения заменены прямоугольным тёплым softbox, узкими полосами и приглушённым '
    'тёплым studio environment. Сохранены R.y≥0 и коррекция N·V.',
    '- Полный короткий спектральный хвост восстановлен; mesoGain=1.5. C2 и дополнительная '
    'normal-only выборка с половинным периодом 4.5 м видимы как нормали, roughness=0.032. '
    'В Toksvig roughness уходит добавочная дисперсия неразрешённой части mip. C2 направлен '
    'вдоль основного ветра, несущие волны образуют crossing sea. Key energy=2.0, реальный '
    'угловой диаметр sun disc 0.5–0.8° задаётся через отражённый луч.',
    '- Проверены crossing angles 50°/70°/90° на фиксированном seed и выполнен новый поиск '
    'события. Выбраны 70°, input energy secondary/primary=0.75, пики 34.35/37.96 м, '
    'периоды каскадов 160/37/9 м. Seed=20417044, phaseOffset=0.3, heroHeight=4.6, '
    'chop=0.81, crestSharpening=0.34. Пенное событие у шва находится на дальней половине.',
    '- Плотный голубой покров заменён ослабленным поверхностным слоем и 3136 мягкими '
    'инстансированными foam puffs. Они читают текущие карты на GPU, перекрываются шумовыми '
    'краями, имеют эллипсоидальную глубину и diffuse blue ambient без specular. Это '
    'приближение объёма billboards, не 3D-симуляция заворачивающегося гребня. Верхняя '
    'граница surface relief≈0.184 единицы, объём добавляет до≈0.25: суммарная верхняя '
    'граница≈0.434. Это граница конструкции, не измеренный максимум каждого кадра.',
    '- Шар emissive-only; белого specular dot нет. Bloom ослаблен и сужен. Orange point '
    'light использует регуляризованный 1/d² и затухает к 1.55 диаметра. Отражение '
    'умножается на Fresnel, синусоидальная «лестница» удалена; разрывы создают нормали '
    'ряби. Это аналитическое приближение, не полная трассировка отражения шара.',
    '- F и главная используют общие ball/floor/shadow/post, HDR target с 4× MSAA. '
    '?variant=F показывает reference/F; P/S импортируются по требованию. Ошибка или '
    'истечение 45 секунд выводит причину в тайле. Полная сетка проверена с F/P/S.', '',
    '## C2: цвет и яркость', '',
    'Цели: H=172–182°, S=0.20–0.32; Y p5/p25/p50/p75/p95 = 38–52 / 48–70 / '
    '60–82 / 74–104 / 112–146; пол #d67462±6. Большинство brightest 5% должно быть '
    'тёплым минимум в четырёх из семи фаз.', '',
    '| Кадр | H° | S | Y p5 / p25 / p50 / p75 / p95 | Тёплых в ярких 5% | Пол |',
    '|---|---:|---:|---|---:|---|',
]
for row in metrics:
    a=row['after'];lines.append(f"| {row['frame']} | {n(a['hue'])} | {n(a['saturation'],3)} | {vals(a['luminance'])} | {n(100*a['brightWarmShare'],1)}% | {a['floorHex']} |")
lines += ['', 'Повторный анализ GIF тем же приближённым mask приведён отдельно. Он не '
    'заменяет заданные пользователем целевые интервалы.', '',
    '| Reference кадр | H° | S | Y p5 / p25 / p50 / p75 / p95 |','|---|---:|---:|---|']
for row in metrics:
    a=row['reference'];lines.append(f"| {row['frame']} | {n(a['hue'])} | {n(a['saturation'],3)} | {vals(a['luminance'])} |")
lines += ['', '## C3–C5: рябь, форма и пена', '',
    'Цели: specks 40–100 (14–98 допустимо в отдельном кадре); glint pixels 0.1–1%; '
    'std fine/mid/large 9–13 / 8–10.5 / 16–24; relief 12–22% S; above mean 0.36–0.46; '
    'crest J≈0–0.15 без global folding. Foam≈13% у шва, 2–3% в середине, mound #5697a8±10.', '',
    '| Кадр | Specks | Glint pixels | Std fine / mid / large | Relief % S | Above mean | Min J | Foam % | Mound |',
    '|---|---:|---:|---|---:|---:|---:|---:|---|']
for row in metrics:
    a=row['after'];lines.append(f"| {row['frame']} | {a['glintSpecks']} | {n(a['glintPixelsPercent'],3)}% | {vals(a['bandStd'],2)} | {n(a['reliefPercent'])} | {n(a['areaAboveMean'],3)} | {n(a['minJacobian'],4)} | {n(a['foamCoveragePercent'])} | {a['foamHex']} |")
rows=audit['rows']
lines += ['', '121 фаза: min J='+n(audit['minimumJacobian'],6)+'; max folds fraction='+n(audit['maxFoldedFraction'],6)+
    '; nonfinite='+str(sum(r['nonfinite'] for r in rows))+'; relief min/max='+
    vals([min(r['reliefPercent'] for r in rows),audit['maxRelief']],2)+'% S; above mean min/max='+
    vals([min(r['areaAboveMean'] for r in rows),max(r['areaAboveMean'] for r in rows)],3)+'.', '',
    'Foam diagnostic mask включает surface coverage≥0.5 и новые объёмные puffs при alpha≥0.16. '
    'Это оценка видимой площади, не идентичная старой чисто поверхностной методике.', '',
    '## C6: шар и его свет', '',
    'D — диаметр шара. Цели: p90 in-water orange pixels на 1–2.8D, площадь 0.1–1.1 '
    'площади диска, ≥80% со стороны камеры. World и screen distances указаны отдельно. '
    'Цвета: медианы центра/верхней средней зоны/верхней кромки. Палитра-цель '
    '#ffb347 / #ff9909 / #e8501a; halo 1.6–2 радиуса.', '',
    '| Кадр | Диаметр px | Центр / body / limb | Halo r, ΔY≥1 | Orange p90 world / screen D | Orange/disc | Camera side |',
    '|---|---:|---|---:|---|---:|---:|']
for row in metrics:
    a=row['after'];r=a['reflection']['visibleColour'];lines.append(f"| {row['frame']} | {n(a['ballDiameter'])} | {a['ballCore']} / {a['ballBody']} / {a['ballLimb']} | {n(a['bloomHaloRadiusAtDeltaY1'])} | {vals([r['p90WorldDiameters'],r['p90ScreenDiameters']],2)} | {n(r['discAreaRatio'],3)} | {n(100*r['cameraSideShare'],1)}% |")
lines += ['', 'Orange mask — разность beauty и идентичного кадра без света/отражения шара '
    'в воде: ΔR>8, R>75, R>1.1G, R>1.35B, вне проекции диска. Шар, bloom и студия '
    'одинаковы. Это причинный вклад шара, включая ближний scatter, а не тёплый softbox. '
    'Float surface pass даёт мировые позиции. Отдельная чистая reflection radiance '
    'до перекрытия пеной с порогом linear R>0.12 сохранена в frames.json; два результата '
    'не подменяют друг друга.', '',
    '## C1: живое движение', '',
    'Два отдельных trace по три цикла, 10.89 с, с видимым окном, без бросков/падений. '
    'На главной записано установившееся track-состояние. Позиция накапливается в GPU strip '
    'и читается один раз после проигрывания, без per-frame CPU/GPU stall. Вторая разность '
    'считается для вектора позиции в локальных единицах листа. Цели: p95 |Δ²p|≤0.004, '
    'max≤0.01; ни одного шага>2.5× медианы соседних ±5; immersion 20–40% каждого кадра; 60+ FPS.', '',
    '| Страница | Кадров | Render FPS | Δ²p p95 / max | Шаг median / max | Выбросов >2.5× | Immersion min / max | Кадр ms p50 / p95 / max |',
    '|---|---:|---:|---|---|---:|---|---|']
for name,r in motion.items():
    lines.append(f"| {name} | {r['frames']} | {n(r['fps'])} | {vals([r['p95'],r['maximum']],6)} | {vals([r['stepMedian'],r['stepMaximum']],6)} | {r['neighbourOutliers']} | {vals([100*x for x in r['immersion']],4)}% | {vals(r['frameMs'],2)} |")
lines += ['', 'Окна visible='+str(all(r['paneVisible'] for r in motion.values()))+
    '; другой heavy slot свободен до/после каждого trace='+str(all(r['queueIdle'] for r in motion.values()))+
    '. Видео записано отдельно и не участвует в таблице. При неравномерных интервалах '
    'кадров raw Δ²p включает изменение dt; оно не вычитается. Диагностическая нормализация '
    'к 60 Hz p95/max: Lab '+vals(motion['Lab']['normalized60'],6)+', Main '+vals(motion['Main']['normalized60'],6)+
    '. Она не считается прохождением C1. Quiet heightfield под шаром Main min/median/max: '+
    vals(motion['Main']['heightfieldRange'],6)+' единицы; до исправления feedback минимум был −0.173.', '',
    '## Проверки', '',
    '- `heavy npm.cmd run build`: PASS, включает typecheck `tsc --noEmit` и основную сборку.',
    '- `heavy npx vite build --config vite.lab.config.ts`: PASS. Остаётся предупреждение '
    'о размере отдельных chunks >500 kB.',
    '- `heavy node scripts/lab-checks.mjs http://localhost:4103`: '+('PASS' if lab.get('allPassed') else 'FAIL')+
    '; engines='+', '.join(lab['checks']['backends'].get('available',[]))+'; '+link('данные','lab-checks.json')+'.',
    '- `heavy node scripts/float-surface-checks.mjs http://localhost:4103`: '+('PASS' if surface.get('passed') else 'FAIL')+
    '; normal error='+n(surface['math']['maximumNormalError'],8)+', inverse error='+n(surface['math']['maximumInverseError'],6)+
    '; '+link('данные','surface-checks.json')+'.',
    '- Полный `heavy node scripts/preview-checks.mjs http://localhost:4103 --headed`: '+
    '; '.join(v['name']+'='+('PASS' if all(c.get('passed') for c in v['checks'].values()) else 'FAIL') for v in preview.get('variants',[]))+
    '; '+link('полный результат','preview-checks.json')+'.',
]
for filename in ['checks-grab-throw-mobile.json','checks-tap-mobile.json']:
    path=ROOT/'output/playwright/preview'/filename
    if path.exists():
        data=json.loads(path.read_text(encoding='utf-8'))
        (OUT/filename).write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')
        lines.append('- Отдельная повторная проверка '+filename+': '+('PASS' if data.get('passed') else 'FAIL')+'; '+link('результат',filename)+'.')
lines += ['- Pixel-identical seam t=0 против t=3.63: '+str(frames['seam']['pixelIdentical'])+
    '. Кадр 120 — t=3.60, он не выдаётся за endpoint. Непрерывный переход без seek '
    'также проверен lab-checks.',
    '- HDR MSAA samples='+str(audit['msaaSamples'])+'. Shadow luminance ratio min/p05/median='+
    vals([audit['shadow'][k] for k in ['min','p05','median']],3)+'. Цель 0.65–0.75 '
    'не выполняется для всего feathered footprint.', '', '## Производительность', '',
]
measurement=performance.get('measurement',{});fps=measurement.get('fps',0)
lines += ['`heavy node scripts/preview-performance.mjs http://localhost:4103`: 1920×1080, '
    'DPR 1, scale 1, Iris Xe, видимые controls, настоящие grab/throw/splash/taps. Valid='+
    str(performance.get('valid'))+', other slot idle='+str(performance.get('queueIdle'))+
    ', FPS='+n(fps)+', frame p95='+n(measurement.get('p95Ms',0))+' ms. Порог прошлого '
    'прохода 42.9 FPS '+('пройден' if fps>=42.9 else '**не пройден**')+'. '+link('Полные данные','performance.json')+'.',
    ('Вероятные дополнительные затраты — 4× MSAA HDR/depth, float32 carrier maps и '
     'foam puffs. Контролируемого A/B по каждому эффекту не было: точный вклад не измерен. '
     'Снижение не скрыто; render scale/разрешение симуляции для замера не понижались.' if fps<42.9 else
     'Скорость не ниже указанного результата прошлого прохода; это не синхронный A/B '
     'при полностью одинаковом состоянии общей машины.'), '',
    '## Самопроверка', '',
    '1. **Да:** основные склоны тёмные серо-зелёные; прежних широких cyan plates нет. '
    'Узкие светлые отражённые линии остаются. '+link('Whole 40','crop-whole-040.png')+'.',
    '2. **Нет, не полностью:** направленная мелкая рябь есть, но фактура слишком резкая '
    'и часть бликов соединяется в линии; specks ниже основной цели. '+link('Crest 100','crop-crest-100.png')+'.',
    '3. **Да, с отличиями:** crossing ridges и near-cusp участки есть, folds не обнаружены. '
    'Размеры чаш и композиция гребней отличаются от GIF. '+link('Whole 40','crop-whole-040.png')+'.',
    '4. **Нет, полного churn нет:** пена возвышается и разбивает силуэт мягкими объёмами, '
    'но читается как группы процедурных puffs. Нет свободного заворачивания и масштаба '
    'взвеси reference. '+link('Foam 0','crop-foam-000.png')+'.',
    '5. **Да:** emissive ball без белого specular dot; точный красный limb не получен. '+link('Ball 0','crop-ball-000.png')+'.',
    '6. **Да, с ограничением:** оранжевый свет доходит до воды, отражение дробится рябью. '
    'World distance/area/camera share в цели; экранная длина кадров 60/100 короче D. '
    'Дорожка слабее и иной формы, чем в GIF. '+link('Ball 100','crop-ball-100.png')+'.',
    '7. **Нет по всем строгим условиям C1:** ступеньки readback устранены, immersion '
    'стабилен, но raw Δ²p/соседние шаги при реальном frame pacing не проходят целиком. '+
    link('Живое видео','reference-f-live.mp4')+'; [trace](output/playwright/pass5-rework-motion/summary.json).',
    '8. **Да, впечатление материала ещё возможно:** избыток мелких ярких линий местами '
    'даёт металлическую фактуру, пена местами выглядит голубыми комками. Визуальное '
    'совпадение не объявляется достигнутым. '+link('Whole 0','crop-whole-000.png')+', '+link('Foam 0','crop-foam-000.png')+'.', '',
    '## Все известные промахи и попытки', '',
    '- **C1:** raw p95/max, соседние выбросы и фактический FPS приведены выше. Сделаны '
    'GPU placement, float32, исправление feedback; проверены исходный cap 60 Hz и снятие '
    'cap. Последнее усиливало чередование коротких/длинных кадров; оставлен исходный '
    'pacing. GPU-поза не устраняет задержки доставки кадров браузером.',
    '- **C2:** p50 кадра 40=58.59<60; p95 у шва≈146.95/146.77>146. Тёплое большинство '
    'brightest 5%: 0/7 вместо ≥4/7. Дважды менялись body/environment, затем Gaussian '
    'окружение заменено softbox/полосами. Более сильное потепление возвращало крупные '
    'материальные блики. Тот же простой warm classifier на reference также зависит '
    'от mask/голубой пены; целевая граница при этом не изменена.',
    '- **C3:** specks 25–34 вместо 40–100, glint pixels 0.074–0.123%; fine std '
    '14.09–15.37 вместо 9–13; large кадров 20/40≈15.48/15.60<16. Проверены '
    'ограниченный/полный tail, две силы detail normal, crossing/направленный C2, key=2 '
    'и 3, форма sun disc. Дополнительная энергия усиливала жёсткую фактуру и слияние бликов.',
    '- **C4:** above mean кадров 20/60/80≈0.478/0.486/0.478>0.46; min J кадра '
    '20≈0.204>0.15. Relief в пределах цели. Проверены 50/70/90°, узкий/полный спектр, '
    'несколько chop/sharpening. Усиление chop вводило folds. Reference bowls не повторены.',
    '- **C5:** seam foam≈10.95/10.78% вместо≈13%; середина 40/60≈3.01/3.49%; '
    '80/100≈7.56/7.58% дают лишнее позднее событие. Mound кадра 20=#598c9d: G/B '
    'на 11 ниже цели; остальные ближе. Проверены широкая/узкая compression source, '
    'decay, новый seed/phase, heightfield-only слой, непрозрачные и мягкие puffs. '
    'Общее увеличение density поднимало пену и между событиями. Полного churn нет.',
    '- **C6:** centre≈#fead3e, body≈#fea32b, limb≈#fe970a: body светлее и limb '
    'недостаточно красный. Halo≈1.55–1.60r, часть фаз ниже 1.6. Дважды уменьшались '
    'bloom energy/kernel и point scatter; убраны нижняя граница Fresnel и лестница '
    'полос. Экранная длина отражения двух фаз короче цели.',
    '- **C7:** floor mean≈#d47361 в ±6. Shadow p05≈0.697 в цели, darkest '
    'tendril≈0.610 и median footprint≈0.827 вне 0.65–0.75. Проверены более крутая '
    'projection и два веса soft/tendril; весь footprint не соответствует диапазону.',
]
for v in preview.get('variants',[]):
    for name,result in v['checks'].items():
        if not result.get('passed'):
            lines.append('- **Первый полный preview-check, '+v['name']+'/'+name+':** '+result.get('error','failure').replace('\n',' ')+'. Результаты отдельных повторов указаны выше; исходная ошибка сохранена.')
if fps<42.9:
    lines.append('- **Performance:** '+n(fps)+' FPS ниже 42.9; причины и ограничения измерения указаны выше.')
lines += ['', '## Метод и восстановление', '',
    'Beauty приведены к 500×281 Lanczos без grade/exposure correction. F mask — diagnostic '
    'red, projected ball исключён цветовым критерием. Reference mask приближённо выделяется '
    'цветом и связной областью; исходной сегментации задания нет. Повторные значения GIF '
    'поэтому отличаются от исходной таблицы. Y=0.2126R+0.7152G+0.0722B в экранных '
    '0–255 значениях. Fine=L−Gaussian(1.5), mid=Gaussian(1.5)−Gaussian(6), large=Gaussian(6); '
    'Gaussian нормализован по mask, граница эродирована на 2 px. Specks: mean RGB>200, '
    '8-connectivity. Absolute count зависит от исходного capture resolution/downsample.', '',
    'Данные: '+link('metrics.json','metrics.json')+', '+link('frames.json','frames.json')+', '+
    link('121-phase audit','audit.json')+', [motion summary](output/playwright/pass5-rework-motion/summary.json). '
    'Промежуточные варианты pass5-attempt*, pass5-wide-spectrum, pass5-fine-sea, '
    'pass5-aeration-volume и pass5-soft-aeration сохранены как попытки, не финальные замеры.', '',
    'Checkpoint до правок: [sources.zip](output/checkpoints/pass5-resume-20261103-014641/sources.zip), '
    '[SHA-256](output/checkpoints/pass5-resume-20261103-014641/sha256.json). '
    'Отклонённая поверхность: [checkpoint](output/checkpoints/pass5-rejected-rubber/sources.zip). '
    'Новых зависимостей нет; GIF не используется как текстура воды.', '',
    'После прерывания прежний :4103 перестал отвечать: ERR_CONNECTION_REFUSED и пустой '
    'registry. Новый kept-сервер поднят через own-start на том же порту после подтверждения '
    'отсутствия прежнего. Чужие процессы не останавливались. `own-cleanup` выполняется '
    'при завершении, kept :4103 остаётся доступным.',
]
report=ROOT/'REPORT.md'
backup=ROOT/'output/checkpoints/pass5-rejected-rubber/REPORT-before-rework.md'
if report.exists() and not backup.exists():
    backup.write_bytes(report.read_bytes())
report.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(dict(report=str(report),motion=motion,performanceFPS=fps,
    checks=dict(lab=lab.get('allPassed'),surface=surface.get('passed'),preview=preview.get('passed'))),ensure_ascii=False,indent=2))
