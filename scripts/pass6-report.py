"""Write pass-6 evidence and explicitly list soft-target misses."""
import json
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent.parent;OUT=ROOT/'output/playwright/pass6-final'
def read(p):return json.loads((ROOT/p).read_text(encoding='utf-8'))
def n(v,d=3):return '—' if v is None else f'{v:.{d}f}'
def vs(a,d=2):return ' / '.join(n(x,d) for x in a)
def lk(label,file):return f'[{label}](output/playwright/pass6-final/{file})'
def pct(x):return n(x*100,1)+'%'
metrics=read('output/playwright/pass6-final/metrics.json')
systems={m:read(f'output/playwright/pass6-final/{m}-system.json')['system'] for m in ['phillips','jonswap']}
audits={m:read(f'output/playwright/pass6-audit-{m}/audit.json')['audit'] for m in systems}
motion={}
for model in systems:
 for page,filename in [('lab','motion'),('main','mainmotion')]:
  doc=read(f'output/playwright/pass6-motion-{model}/{filename}.json');rows=doc['motion']['rows'];p=np.array([r['gpu'] for r in rows]);dt=(np.diff([r['phase'] for r in rows])+3.63)%3.63
  step=np.linalg.norm(np.diff(p,axis=0),axis=1);acc=np.linalg.norm(np.diff(p,n=2,axis=0),axis=1)
  ratios=[float(step[i]/max(float(np.median(np.r_[step[i-5:i],step[i+1:i+6]])),1e-9)) for i in range(5,len(step)-5)]
  velocity=np.diff(p,axis=0)/np.maximum(dt[:,None],1e-9);normalized=np.linalg.norm(np.diff(velocity,axis=0),axis=1)/np.maximum((dt[:-1]+dt[1:])*.5,1e-9)/3600
  motion[model+'/'+page]=dict(frames=len(rows),fps=float(1/dt.mean()),p95=float(np.percentile(acc,95)),maximum=float(acc.max()),neighbourOutliers=sum(x>2.5 for x in ratios),maxNeighbourRatio=max(ratios),
   immersion=[min(r['immersion'] for r in rows),max(r['immersion'] for r in rows)],frameMs=np.percentile(dt*1000,[50,95,100]).tolist(),normalized60=np.percentile(normalized,[95,100]).tolist(),
   worldHeave=float(np.ptp(p[:,1])/10),visible=doc['motion']['paneVisible'],queueIdle=all(sum(line.startswith('job "') for line in doc[k].splitlines())==1 for k in ['queueBefore','queueAfter']))
(OUT/'motion-summary.json').write_text(json.dumps(motion,indent=2),encoding='utf-8')
lab=read('output/playwright/storm-box/lab-checks.json');surface=read('output/playwright/float-water/surface-checks.json');preview=read('output/playwright/preview/checks.json');perf=read('output/playwright/preview/performance.json')
for name,data in [('lab-checks',lab),('surface-checks',surface),('preview-checks',preview),('performance',perf)]:
 (OUT/f'{name}.json').write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')

lines=['# Floating Ocean — pass 6: волны, движение и A/B', '',
 'Превью: **http://localhost:4103/lab.html?variant=F**. В Tune → Sea model доступны '
 '**Turbulent box (Phillips)** и **Storm box (JONSWAP)**. Phillips выбран по умолчанию в lab и на главной.', '',
 '**Рекомендую Phillips:** он переносит энергию в целую волну размером с лист и даёт заметный '
 'подъём/снос шара. JONSWAP сохранён для сравнения с прежними hills. Полного совпадения с GIF '
 'нет; непройденные цели и ограничения измерений перечислены ниже. Успешная сборка не '
 'считается подтверждением визуального совпадения.', '',
 '## Сравнения', '',
 '- '+lk('Reference / Phillips / JONSWAP, 0–120 через 20, каждый тайл 500×281','contact.png')+'.',
 '- '+lk('Последовательные кадры 60–93 через 3, reference / Phillips / JONSWAP','consecutive-060-093.png')+'.',
 '- Два цикла, 28 fps, reference и модель по 500×281: '+lk('Phillips MP4','phillips-live.mp4')+' / '+lk('WebM','phillips-live.webm')+'; '+lk('JONSWAP MP4','jonswap-live.mp4')+' / '+lk('WebM','jonswap-live.webm')+'.',
 '- '+lk('Проверка настоящего переключателя Tune','phillips-toggle.json')+'. Видео записаны '
 'реальным проигрыванием видимой страницы, без seek во время записи и без цветокоррекции. '
 'MP4 добавляет один чёрный пиксель снизу для чётной высоты; скорость не меняется.', '',
 '## Что изменено', '',
 '- Добавлен явный `model: jonswap | phillips`. В Phillips нет meso shelf, peak taper, '
 'добавочного C2 gain и crestSharpening; только A и uniform chop. Глобальный __crossAngle '
 'не используется, peakOnly больше не выбирает crossing sea. В Tune скрыты неиспользуемые '
 'параметры JONSWAP, сохранение/загрузка JSON поддерживает model.',
 '- Phillips: A=0.0138, wind=55 m/s, Lw≈308.36 м ≥3 C0, counter-wind energy=0.4, '
 'направление 75°. Sphys=68.3365 м; каскады 82.0038 / 19.1342 / 4.7836 м, C0=1.2 S. '
 'ℓ=6 L2/64≈0.4485 м привязан к концу C2. Дискретные полосы не пересекаются. '
 'Нижняя мода делает ровно два цикла за 3.63 с; её экранный период 1.815 с.',
 '- Использована формула из задания; первоисточник модели — '
 '[J. Tessendorf, Simulating Ocean Water, slides 2001](https://jtessen.people.clemson.edu/reports/papers_files/waterslides2001.pdf). '
 'Одно A масштабирует весь спектр; измеренная RMS-нормализация не применяется.',
 '- Проверены **64 разных seeds в четырёх настройках**: A=.008/.018/.014/.016, '
 'C0/S=1.2/1.3, wind direction 45°/30°/75°, разные chop. Ранжирование использовало '
 'экранный ход/скорость шара, heave, углы, relief, дальнее breaking-событие и баланс '
 'осевых мод. Выбран seed **20839002**, затем A=.0138, chop=.95, phaseOffset=3.0. '
 'Исходные таблицы: [1](output/playwright/pass6-search1/phillips-search.json), '
 '[2](output/playwright/pass6-search2/phillips-search.json), '
 '[3](output/playwright/pass6-search3/phillips-search.json), '
 '[4](output/playwright/pass6-search4/phillips-search.json). Во втором поиске зафиксирована '
 'и затем исправлена ошибка reserved GLSL word в отдельном puff shader; FFT/point-search '
 'работал, но изображения того варианта не считаются валидной визуальной проверкой.',
 '- Локальный horizontal limiter включается при raw J<−.3 и ограничивает локальный strain; '
 'глобальный repair не применяется. Итоговый finite-difference J отдельно измерен в 121 фазе.',
 '- Шар читает полное смещение фиксированного материального центра из GPU maps текущего '
 'кадра. Ограничение x/z для track удалено. Пружина сохраняется только в физическом offset '
 'после броска/падения; отдельного притягивания видимой GPU-позы к центру кадра нет.',
 '- Удалён normal-only half-period band. Фильтруется естественный C2, неразрешённая '
 'дисперсия поступает в Toksvig roughness. После .065/.08 выбрана base roughness=.10, '
 'key=1.8. Softbox совмещён с key по высоте, тонкие полосы приглушены. Коррекция body '
 'linear RGB до (.0385,.0600,.0605) удерживает hue/saturation в заданном диапазоне; '
 'экспортируемые кадры не подвергаются grade.',
 '- Puffs разрешены только в 4-связных областях foam density≥.3 площадью ≥1.5% всего '
 'материального листа. Connected mask вычисляется для сходящегося цикла при rebuild, '
 'на GPU берётся пересечение соседних фаз; live density дополнительно ограничивает birth. '
 'Первые попытки all-patches / largest-only сравнены: largest-only давал исчезновение '
 'при смене крупнейшей области, поэтому сохранены все достаточно большие области. '
 'Основания опущены на .35 radius, шум даёт бугристые вершины и тёмные crevices. '
 'Тонкие streaks формируются из адвектированной плотности вдоль ветра; slip=4.5 м/с. '
 'Phillips foam decay=.14 с и birth time=.02 с. Это billboards/heightfield, не 3D fluid churn.',
 '- Расстояние камеры 21.35→20.35 корректирует framing всего листа примерно на 5%; '
 'отдельный масштаб движения шара не добавлялся. Геометрический размер шара сохранён.', '',
 '## W1: движение, по двум циклам видео', '',
 'Цели: ball y=.15–.21 H, x=.05–.09 W, median speed=1.3–2.1 px/frame. '
 'Приведены также p95 и исходные значения reference из задания.', '',
 '| Модель | Ball y/H | Ball x/W | Speed median / p95 px/frame | World heave / S |',
 '|---|---:|---:|---|---:|',
 '| Reference, задача | .186 | .069 | 1.73 / 4.39 | ≈.20 |']
ref=metrics['motion']['phillips']['reference']
lines.append(f"| Reference, повторный tracker | {n(ref['ballY'])} | {n(ref['ballX'])} | {vs([ref['speedMedian'],ref['speedP95']])} | — |")
for model in systems:
 m=metrics['motion'][model]['simulation'];s=systems[model]
 lines.append(f"| {model} | {n(m['ballY'])} | {n(m['ballX'])} | {vs([m['speedMedian'],m['speedP95']])} | {n(s['worldHeave'])} |")
lines += ['', 'Углы — фиксированные материальные точки C0+C1 при ±5, проецированные теми '
 'же матрицами камеры/листа в 204 фазах с шагом 1/28 с. Это измерение углов геометрии; '
 'оно отдельно от silhouette extrema, которые могут принадлежать другому участку гребня/пены.', '',
 '| Модель | Top y/H (.11–.16) | Bottom y/H (.16–.23) | Left x/W (.15–.26) | Right x/W (.10–.15) |',
 '|---|---:|---:|---:|---:|']
for model,s in systems.items():
 c=s['materialCorners'];lines.append(f"| {model} | {n(c['topY'])} | {n(c['bottomY'])} | {n(c['leftX'])} | {n(c['rightX'])} |")
lines += ['', 'Дополнительно: непосредственно из RGB-видео получены диапазоны крайних '
 'точек силуэта. Они не совпадают с постоянными материальными углами, когда гребень '
 'или пена становится новой крайней точкой.', '',
 '| Видео | Top y/H | Bottom y/H | Left x/W | Right x/W |', '|---|---:|---:|---:|---:|']
for model in systems:
 for label in ['reference','simulation']:
  m=metrics['motion'][model][label]
  lines.append(f"| {model} / {label} | {n(m['topY'])} | {n(m['bottomY'])} | {n(m['leftX'])} | {n(m['rightX'])} |")
lines += ['', 'Silhouette измерена непосредственно на видео, включая видимую пену. '
 'Цели width=.71–.79 W, height/width=.54–.69; relief=.12–.22 S.', '',
 '| Модель | Width min / median / max | H/W min / median / max | Relief min / max, % S (121 фаз) | Min final J | Max folded area |',
 '|---|---|---|---|---:|---:|']
for model,s in systems.items():
 m=metrics['motion'][model]['simulation'];a=audits[model]
 lines.append(f"| {model} | {vs(m['width'],3)} | {vs(m['heightWidth'],3)} | {vs([min(r['reliefPercent'] for r in a['rows']),a['maxRelief']],2)} | {n(a['minimumJacobian'],5)} | {pct(a['maxFoldedFraction'])} |")
lines += ['', '| Модель | Сильнейшая λ/S | Её доля variance | Variance при λ≥S/2 | Минимум/максимум envelope доминирующей моды |', '|---|---:|---:|---:|---:|']
for model,s in systems.items():
 d=s['strongest'];lines.append(f"| {model} | {n(d['wavelength']/s['parameters']['sheetSizeMetres'])} | {pct(d['varianceFraction'])} | {pct(s['longBandVarianceFraction'])} | {n(s['dominantEnvelope']['minOverMax'])} |")
lines += ['', 'Рост доминирующей моды от ≤30% её максимальной амплитуды до ≥90% '
 'измерен по фактическим h0 и квантованной частоте. Это component-envelope proxy, '
 'а не утверждение, что весь лист становится плоским:', '']
for model,s in systems.items():
 events=s['dominantEnvelope']['growth'];times=[e['seconds'] for e in events]
 lines.append('- '+model+': '+('rise time min/max='+vs([min(times),max(times)])+' с.' if times else '**нет такого перехода**.')+
    ' Общий long-band envelope min/max='+n(s['envelope']['minOverMax'])+'.')
lines += ['', 'Октавы Phillips: variance по исходным seeded коэффициентам после band ownership. '
 'Низшие bins содержат мало мод и зависят от seed; далее видно спадание height variance '
 'и примерно равную slope variance до экспоненциального cutoff.', '',
 '| Октава относительно k=2π/S | Height variance m² | Slope variance | Число мод |',
 '|---|---:|---:|---:|']
for o in systems['phillips']['octaves']:
 lines.append(f"| {o['octave']} | {n(o['heightVariance'],6)} | {n(o['slopeVariance'],6)} | {o['modes']} |")
lines += ['', '## W2: GPU-трассы, 10.89 с, вне бросков/падений', '',
 'Цели: p95 |Δ²position|≤.004; ни одного шага >2.5× медианы соседних ±5; '
 'immersion 20–40% каждого кадра. Позиции накапливаются на GPU, читаются один раз '
 'после trace. Нормализация к 60 Hz не подменяет сырой результат.', '',
 '| Модель / страница | Render FPS | Δ²p p95 / max | Шагов >2.5× | Immersion min / max | Frame ms p50 / p95 / max |',
 '|---|---:|---|---:|---|---|']
for label,m in motion.items():
 lines.append(f"| {label} | {n(m['fps'],1)} | {vs([m['p95'],m['maximum']],6)} | {m['neighbourOutliers']} | {vs([x*100 for x in m['immersion']],4)}% | {vs(m['frameMs'])} |")
lines += ['', 'Immersion считается относительно несущей поверхности в материальном центре, '
 'без декоративной пены. Видимые окна/состояние очереди и diagnostic normalized60 '
 'сохранены в '+lk('motion-summary.json','motion-summary.json')+'. На главной сравнивались '
 'исходный cap 60 Hz, отсутствие cap и cadence по native refresh. Без cap p95≈.1084, '
 'native-cadence p95≈.0734 против ≈.0258 у исходного cap; оставлен исходный. '
 'Это реальные непройденные пределы raw C1/W2, не fallback в CPU placement. '
 'Normalized60 p95 у Phillips также около .0052 > .004: остаётся вклад ускорений самого '
 'многомасштабного поля, поэтому весь промах нельзя объяснить только доставкой кадров. '
 'Две исходные трассы с параллельной heavy-нагрузкой сохранены как *-contended.json и '
 'заменены отдельными повторными записями.', '',
 '## W3–W4: по кадрам, без colour correction', '',
 'Цели: H=172–182°, S=.20–.32, median Y≈62–85; specks=40–100, площадь=.3–.9%, '
 'median speck=2–3 px, ≥60% glints на верхних 30% large luminance, fine std=9–13. '
 'Foam≈13% у шва, 2–3% mid-loop; mound=#5697a8±10, puff interior std≥12.', '',
 '| Модель / кадр | H° / S | Median Y | Specks | Glint % | Median area px | Lit-face % | Fine std | Foam % | Foam mean / puff interior mean | Puff std median |',
 '|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|']
for model in systems:
 for r in metrics['frames'][model]:
  lines.append(f"| {model}/{r['frame']} | {n(r['hue'],1)} / {n(r['saturation'])} | {n(r['luminance'][2],1)} | {r['glintSpecks']} | {n(r['glintPixelsPercent'])} | {n(r['medianSpeckPixels'],1)} | {n(r['glintsOnLitFaces']*100,1)} | {n(r['fineStd'],2)} | {n(r['foamCoveragePercent'],2)} | {r['foamMean']} / {r.get('puffMean') or '—'} | {n(r.get('medianInteriorStd'),2)} |")
lines += ['', 'Puff σ считается по отдельным GPU ID областям, эродированным на 1 native px, '
 'с ≥5 внутренними пикселями. В JSON есть число измеренных puffs, min/median/p95 σ '
 'и доля σ≥12; медиана не означает, что каждый полупрозрачный puff прошёл порог. '
 'Connected-area mask использует density=.3; projected foam coverage — диагностический '
 'surface coverage≥.5 и видимый объём, поэтому эти две площади различаются.', '',
 '## Проверки и производительность', '',
 '- `heavy npm.cmd run build`: PASS, включает `tsc --noEmit` и основную сборку.',
 '- `heavy npx vite build --config vite.lab.config.ts`: PASS. Обычное предупреждение '
 'о chunks >500 kB сохранено.',
 '- `lab-checks`: '+str(lab.get('allPassed'))+'; F/P/S загрузились, presets/seek/resume/loop/drop/tap проверены.',
 '- `float-surface-checks`: '+str(surface.get('passed'))+'; normal error='+n(surface['math']['maximumNormalError'],8)+', inverse error='+n(surface['math']['maximumInverseError'],6)+'.',
 '- Полный `preview-checks --headed`: '+ '; '.join(v['name']+'='+str(all(c.get('passed') for c in v['checks'].values())) for v in preview['variants'])+'. '+lk('Данные','preview-checks.json')+'. '
 'Floor-only helper дополнен скрытием aeration, чтобы измерять именно пол.',
 '- Оба seam t=0 / 3.63 pixel-identical: '+str(all(read(f'output/playwright/pass6-final/{m}-frames.json').get('seam') for m in systems))+'. '
 'Непрерывный переход без seek также проверен lab-checks.',
 '- Каждый 121-phase audit не содержит nonfinite; max CPU/GPU anchor error Phillips='+n(audits['phillips']['maxAnchorError'],8)+', JONSWAP='+n(audits['jonswap']['maxAnchorError'],8)+'.',
]
pm=perf.get('measurement',{})
lines += ['- Phillips, 1920×1080, DPR=1, scale=1, Iris Xe, controls видимы, grab/throw/splash/taps: '
    'valid='+str(perf.get('valid'))+', other heavy slot idle='+str(perf.get('queueIdle'))+', '
    'FPS='+n(pm.get('fps',0),2)+', frame p95='+n(pm.get('p95Ms',0),2)+' ms. '+lk('Данные','performance.json')+'. '
    'Это ниже 40.04 FPS pass 5 и 42.9 FPS pass 4. GPU means: water≈12.88 ms, '
    'floor≈7.46 ms, FFT/surface≈2.56 ms. Точный вклад новых эффектов не выделен '
    'контролируемым A/B; baked patch mask не загружается заново во время playback.', '',
 '## Самопроверка по кадрам', '',
 '1. **Да:** одна длинная волна доминирует над мелкой фактурой; Phillips strongest λ=1.2 S '
 'и >50% variance в одной моде. Но полного flat-to-crest рисунка reference нет. '+lk('Последовательность 60–93','consecutive-060-093.png')+'.',
 '2. **Да:** шар заметно поднимается/опускается и смещается; '+lk('живой Phillips','phillips-live.mp4')+'. '
 'Raw frame-jitter targets W2 целиком не пройдены — таблица выше.',
 '3. **Нет во всех фазах:** specks стали ≈2 px, но в части фаз lit-face share ниже 60% '
 'и fine std выше 13. '+lk('Кадр 80','phillips-080.png')+'.',
 '4. **Нет полностью:** отдельные snow caps меньше 1.5% отфильтрованы, есть связные '
 'breaking bands и streaks, но иногда одновременно видны две достаточно большие '
 'области и не совпадает coverage curve. '+lk('Кадр 0','phillips-000.png')+', '+lk('80','phillips-080.png')+'.',
 '5. **Да, такое впечатление ещё возможно:** локально широкие светлые отражения могут '
 'читаться как foil/plastic, billboards и рельеф пены как плотный голубой материал. '
 'Регулярная сетка равных mountains значительно слабее на Phillips, но точный reference '
 'не воспроизведён. '+lk('Кадр 20','phillips-020.png')+', '+lk('JONSWAP 40','jonswap-040.png')+'.', '',
 '## Непройденные цели и реальные попытки', '',
 '- W1: четыре spectral/seed searches, затем A/chop доведены под ход шара. Не все '
 'диапазоны углов и silhouette width достигнуты; все значения выше. Отдельный материал '
 'углов не привязывался к экранным координатам. Общий long-band envelope не падает '
 'до почти нуля: волна остаётся более постоянно развитой, чем reference. Рост отдельной '
 'моды не выдаётся за полное выравнивание всего листа.',
 '- W2: GPU placement и отсутствие track-clamp сохранены; проверены три режима подачи '
 'кадров, retained cap оказался менее дёрганым. Изменение времени между реальными '
 'кадрами даёт raw Δ²p и neighbour outliers; все провалы указаны, positions не ретаймлены.',
 '- W3: попытки .065/.08/.10 roughness, key=2/5/3/1.8, .44/.881 elevation softbox, '
 'два short-wave cutoff, затем выравнивание цвета. Phillips выполняет speck count/size/area; '
 'в некоторых фазах lit-face share <60% и fine std>13. JONSWAP остаётся мельче и резче. '
 'Слабый unresolved tail не усиливался ради количества бликов.',
 '- W4: сравнивались отсутствие connected filtering, all-connected и largest-only, '
 'две силы inner contrast, decay .24/.14 и birth .045/.02. Largest-only вызывал pop '
 'при смене крупнейшего компонента и отклонён. Сохранён min-area filter; у цикла '
 'остаётся второе breaking-событие, поэтому curve не равна 13%/2–3%. Mound means, '
 'индивидуальные faint-puff σ и все отклонения от палитры видны в JSON/таблице.',
]
for model in systems:
 m=metrics['motion'][model]['simulation'];c=systems[model]['materialCorners'];a=audits[model]
 targets={'ballY':(.15,.21),'ballX':(.05,.09),'speedMedian':(1.3,2.1)}
 for key,(lo,hi) in targets.items():
  if not lo<=m[key]<=hi:lines.append(f'- {model} **{key}={n(m[key])}**, цель {lo}–{hi}.')
 for key,(lo,hi) in {'topY':(.11,.16),'bottomY':(.16,.23),'leftX':(.15,.26),'rightX':(.10,.15)}.items():
  if not lo<=c[key]<=hi:lines.append(f'- {model} **corner {key}={n(c[key])}**, цель {lo}–{hi}.')
 if systems[model]['worldHeave']<.15:lines.append(f'- {model} **heave={n(systems[model]["worldHeave"])} S**, цель ≥.15 S.')
 if a['maxRelief']>22:lines.append(f'- {model} **max relief={n(a["maxRelief"],2)}% S**, цель ≤22%.')
 if m['width'][0]<.71 or m['width'][2]>.79:lines.append(f'- {model} **silhouette width min/max={vs([m["width"][0],m["width"][2]],3)}**, цель .71–.79.')
 foam_curve=[r['foamCoveragePercent'] for r in metrics['frames'][model] if r['frame'] in [0,60,120]]
 lines.append(f'- {model} **foam 0 / 60 / 120 = {vs(foam_curve,2)}%**, цель ≈13 / 2–3 / 13%.')
 for r in metrics['frames'][model]:
  gaps=[]
  if r['glintsOnLitFaces']<.6:gaps.append('lit-face='+pct(r['glintsOnLitFaces']))
  if not 9<=r['fineStd']<=13:gaps.append('fine std='+n(r['fineStd'],2))
  if not 40<=r['glintSpecks']<=100:gaps.append('specks='+str(r['glintSpecks']))
  if not .3<=r['glintPixelsPercent']<=.9:gaps.append('glint area='+n(r['glintPixelsPercent'])+'%')
  if not 2<=r['medianSpeckPixels']<=3:gaps.append('speck median='+n(r['medianSpeckPixels'],1)+' px')
  colour=r.get('puffMean') or r.get('foamMean')
  if colour:
   delta=max(abs(int(colour[i:i+2],16)-target) for i,target in zip([1,3,5],[86,151,168]))
   if delta>10:gaps.append('mound mean='+colour+', max RGB error='+str(delta)+' >10')
  if r.get('puffsStdAtLeast12Share') is not None and r['puffsStdAtLeast12Share']<1:gaps.append('puffs σ≥12: '+pct(r['puffsStdAtLeast12Share']))
  if gaps:lines.append(f'- {model}/{r["frame"]}: '+', '.join(gaps)+'.')
for label,m in motion.items():
 if m['p95']>.004:lines.append(f'- {label} **raw Δ²p p95={n(m["p95"],6)} >.004**; normalized60 p95={n(m["normalized60"][0],6)}.')
 if m['neighbourOutliers']:lines.append(f'- {label}: **{m["neighbourOutliers"]} neighbour-step outliers**, максимум {n(m["maxNeighbourRatio"],2)}×, цель ≤2.5×.')
 if not m['queueIdle']:lines.append('- '+label+': очередь heavy не была свободной на обеих границах trace; такой trace нельзя считать изолированным.')
for v in preview['variants']:
 for key,data in v['checks'].items():
  if not data.get('passed'):lines.append('- Preview '+v['name']+'/'+key+': '+data.get('error','failure').replace('\n',' ')+'.')
lines += ['', '## Метод, данные, восстановление', '',
 'Контактные кадры: 500×281 Lanczos, без grade. Glints: mean RGB>200, 8-connectivity, '
 'median component area в px. Lit faces — верхние 30% нормализованного по water mask '
 'Gaussian σ=6 luminance; fine=L−Gaussian(1.5), std после erosion 2 px. Y в экранных '
 '0–255 значениях. Video ball tracker использует orange chroma, связность, компактность '
 'и непрерывность положения; координаты не сглаживаются. Reference segmentation '
 'приближённая, поэтому corner silhouette extrema не выдаются за ручной tracking углов '
 'из задания. Для target comparison используются предоставленные значения reference '
 'и отдельно измеренные материальные углы модели. Фазы движения шара, ridge growth '
 'и mound не повторяют reference покадрово, что видно в полосе 60–93.', '',
 'Connected-mask путь проверен для quantized loop. При отключении loop используется '
 'последняя baked eligibility mask; полноценная маркировка новых live non-loop patches '
 'в этом проходе не реализована и не считается проверенной.', '',
 'Raw: '+lk('metrics.json','metrics.json')+', '+lk('motion summary','motion-summary.json')+', '
    +lk('Phillips system','phillips-system.json')+', '+lk('JONSWAP system','jonswap-system.json')+'. '
 '121-phase audits: [Phillips](output/playwright/pass6-audit-phillips/audit.json), '
 '[JONSWAP](output/playwright/pass6-audit-jonswap/audit.json).', '',
 'До правок сохранены [sources.zip](output/checkpoints/pass6-start-20261103-162144/sources.zip) '
 'и [SHA-256](output/checkpoints/pass6-start-20261103-162144/sha256.json). Новых '
 'зависимостей нет. Kept :4103 не перезапускался, чужие процессы не останавливались. '
 '`own-cleanup` выполняется при завершении; :4103 остаётся доступным.',
]
(ROOT/'REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(dict(report='REPORT.md',motion=motion,performance=pm.get('fps'),preview=preview.get('passed')),ensure_ascii=False,indent=2))
