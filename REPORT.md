# Pass 10 — Settings without the reference

- Checkpoint: `output/checkpoints/pass10-start-20261104-232237/` preserves both Settings source files before edits. The renderer, main-page sources, look and original ocean caches were not changed.
- The top now shows assigned Main and Storm loops, role chips, captions and a decorative Calm → Main → Storm strip. Assignment updates the matching player in phase with a 600 ms highlight and no scrolling. The existing grid, badges, controls, storage guards and defaults remain.
- Tile pictures open a native preview dialog with assignment buttons and Close. Esc returns focus to the tile. Grid videos pause behind it; off-screen top players pause while their clock phase is carried until they resume. Main supplies the normal page clock. The reference has no video, poster or preload on Settings; its original file remains in `output/`.
- Checks passed through `heavy`: `npm run build` (including typecheck), and the Settings part of `preview-checks` on desktop and 390 px mobile. Coverage includes zero reference requests, defaults 5/3, tile assignments 4/9 and reset, dialog assignment/sync/Esc/focus, paused background grid, off-screen/visibility pause, controls, 600/599 px breakpoint, storage and gear → Settings → Back with the new Main look. Dialog sync differences were 10.7 ms desktop / 10.1 ms mobile, within one 30 ms frame. There were no console errors or HTTP/fetch failures; seven normal `ERR_ABORTED` cancellations of superseded/closed media requests per viewport are recorded separately. Hidden-document handling uses the existing harness's emulated visibility event.
- Screenshots and results: `output/playwright/pass10/desktop.png`, `mobile.png`, `dialog-desktop.png`, `dialog-mobile.png`, and `checks-desktop.json` / `checks-mobile.json`. The main build's third-party notices were restored after building.
- Nothing remains unimplemented in this pass. The grid's existing style is preserved; at 600 px the top is side by side, below 600 px it stacks without overflow at 390 px. Temporary-process cleanup leaves kept :4103 running.

---

# Floating Ocean — pass 9: accepted look, Storm and Settings

Main: http://localhost:4103/ · Settings: http://localhost:4103/settings.html · Before/after: http://localhost:4103/compare.html

## Decisions and scope

- The user accepted Main tile 5: `peakWaves=2`, `heightGain=1.00`, the darker charcoal teal colour and reduced reflections. The accepted scatter `[.004,.018,.017]`, absorption `[.40,.12,.10]`, ember-water light `.18`, glints `.2`, studio emitters `.45`, foam and cinematic settings are unchanged.
- Storm is tile 3: `peakWaves=1`, `heightGain=1.35`; all other look parameters equal Main. Round 1 is closed. Rounds 2–4 are cancelled.
- Pass 9 source checkpoint, made before app edits: `output/checkpoints/pass9-start-20261104-180850/sources.zip`. It also preserves the previous REPORT and old F entry.
- No resolution, DPR, 4× scene MSAA, 512² sheet, four 256² cascades, foam/glints/spray detail, 9 motion-blur taps, 12 DOF taps or bloom levels were lowered. There is no dynamic resolution or fixed frame-rate cap.

## Storm and Settings

The control range is `.25 … 1.375`. Calm remains `.25`; opening Main is `1`, exactly two-thirds of the travel, with a tick. Its readout is Rough; the right end reads Storm. Slider, wheel and `[ ]` share this range. Floating-point key steps snap exactly back to Main.

Both spectra use seed 1337, the same grid/cascade lengths (96, 13.6, 1.92, .336 m) and the same 3.63-second frequency quantisation. Between Main and Storm, the evolve shader mixes only their existing h0 amplitudes and linearly mixes their gains. At anchors it compiles the original evolve arithmetic and selects the appropriate h0 texture, avoiding compiler reassociation that otherwise changed a few horizontal displacement texels. Below Main the existing height scaling remains.

Each anchor has the original 121-layer periodic Jacobian foam and spray history. Live intermediate values use the upstream recurrence. Settling on an anchor blends live to cached foam over 0.5 seconds. Storm history is prepared after reveal, with bounded background uploads or a time-sliced recurrence fallback. GPU ember placement continues to sample the current maps. Deterministic intermediate seeks build a separate periodic cache; live dragging never re-bakes.

Foam storage is exactly **63,438,848 bytes per anchor** (63.44 MB / 60.5 MiB), **126,877,696 bytes for both**. Spray history adds 991,232 bytes per anchor. A diagnostic seek/record at an intermediate value can retain one additional 63.44 MB periodic cache in that page, released on replacement/disposal.

`settings.html` retains reference/enlarged synchronized playback, scrub/restart and the 3×3 grid. Each tile has Main look / Storm look buttons and assignment badges. Defaults are Main 5 / Storm 3. Every localStorage access is guarded; malformed/denied storage falls back to defaults. Gear in the dock or **G** opens Settings in the same tab; Help lists G. H still opens lil-gui. `/pick.html` redirects to Settings. IntersectionObserver pauses off-screen tile videos; visibilitychange pauses all videos in a hidden document. Reference and enlarged clips stay active when the document is visible. The 390 px layout has no horizontal overflow.

## Lossless optimizations and rejected candidates

Each retained rendering stage has the full four-HD-still / 121-frame 720p / paused-frame proof under `output/perf/<stage>/quality.json`. These are diagnostics against the accepted renderer, not look targets. Stage measurements use visible Iris Xe windows with the other heavy slot idle. Short GPU-completion microbenchmarks isolate candidates; final interactive numbers follow below.

| Change | Measured effect | Quality / decision |
|---|---|---|
| One live evolve, ping-pong previous outputs, only ripple history copied | FFT simulation 4.98 → 2.31 ms in paired micro runs; completed frame 72.24 → 66.61 ms | Stage 01: all 126 images bit-identical. Canonical t−1/30 remains for deterministic captures. Live velocity scales by simulated Δt. Paused frames retain their last velocity. |
| MRT velocity trial | 66.61 → 73.49 ms completed frame; extra MSAA attachment cost exceeded saved vertex pass | Rejected. Live silhouette/blur differences reached 127/255. Canonical fallback could match, but there was no speed gain. Full-resolution original velocity pass retained. |
| One MSAA scene buffer plus single-sample refraction copy | Estimated 1080p attachment storage falls 248.83 → 149.30 MB (−99.53 MB); copy/restore time itself does not improve | Retained for memory. Stage 03 bit-identical. Opaque renders into scene target; resolved colour/depth copy into separate refraction textures prevents feedback. Exact restore remains necessary. |
| Delete restore completely | Trial completed frame 63.94 → 50.93 ms on the MRT candidate | Rejected: maximum 171/255 edge/depth differences. The cheaper direct path is not applied. |
| Cinematic early-out | Final per-pass timing below; only exact-zero neighbourhood velocity skips 9 redundant blur samples | A .5 px cutoff failed (max 93/255). Exact-zero alternative passes all 126 images within 1/255; sample counts and DOF remain unchanged. Tile-max option not applied. |
| preserveDrawingBuffer=false | Compositor-only effect is not independently resolved by GPU pass timers | Requested flag applied. Same-call capture, 2× PNG snapshot and real captureStream recording pass. No claimed isolated FPS gain. |
| Converged, time-budgeted warm-up; parallel compile; duplicate seek removed | 484 → 363 full steps; frame-0 max difference reaches exactly zero. Surface/post compile while linked FFT brews; 8 ms submission budgets | Stage 06 within 1/255. Time alone was insufficient to halve opening, so exact cache loading below was added. |
| Exact persistent histories for all nine tile settings | Opening uses zero warm-up steps; final timings below | RGBA16F histories exported from the same converged GPU recurrence, gzip-compressed without quantisation. Source/parameter SHA-256 keys invalidate stale histories. Native decompression and bounded uploads preserve all bits. Custom GUI spectra fall back to converged baking. Cached stage 11b passes the full golden set. |
| Metadata readbacks every other rendered frame | Half the scheduled metadata reads; weighted per-frame GPU times below show the small cost | Ball display still samples current GPU maps, independent of readback completion. Surface/interaction checks and both no-stair-step traces pass. No large FPS gain is attributed to metadata reads alone. |
| Idle paused frames skipped | Stable paused view submits zero new frames in the check window | Camera, tilt, storm, ball, ripples, splashes and GUI changes invalidate idle. Real inputs still render. |
| Cull already-discarded back faces | Completed micro frame 53.72 → 49.96 ms; water 18.55 → 17.95 ms | Stage 08 within 1/255. Fixed above-water uCamSide=-1 means these are exactly the faces the fragment shader discarded. |
| Exact depth prepass, without extra MSAA resolve | Completed micro frame 49.96 → 45.94 ms; combined water/depth 17.95 → 16.20 ms | Stage 09 within 1/255. Same full 512² vertices, same depth/coverage, original colour shader. Avoids shading occluded folds. |
| GPU queue backpressure (two in-flight frames) | 1080p 21.67 → 22.20 fps; p95 159.3 → 83.4 ms in the staged interactive run | No fixed rate cap: a fast GPU renders each display tick. Wall time accumulates across busy ticks; wave pace and normalized shutter remain correct. Canonical images unchanged. |

Exact cache files occupy 380.12 MB compressed across all nine variants. The selected Main history alone is downloaded at opening; Storm follows after reveal. No cache download changes the rendered precision. These generated MIT-derived data are packaged with the main build.

## Quality proof

Final golden set: **126 images**, max channel difference **1/255**, worst 8×8 block MSE **0.104167**. Minimum finite PSNR: **67.57 dB**. All pixels satisfy the ±1/255 gate. See `output/perf/final/quality.json`; amplified maps are under `differences/`.

`compare.html` shows the baseline and optimized frozen loops with synchronization, scrub/restart and A/B flip. Both 1280×720 videos decode as 121 frames / 3.63 seconds and use the same lossless VP9 YUV444 encoder. PNGs are the RGB precision proof; video colour conversion is shared. Additional live-velocity comparisons/difference maps show the finite-difference shutter change at 20/30/60 simulated FPS, with motion blur disabled as the control.

Live-velocity controls at the same phase:

| FPS | Motion-only max / PSNR / worst 8×8 MSE | No-blur max | Paused max |
|---|---|---|---|
| 20 | 18 / 67.02 dB / 1.968750 | 0 | 0 |
| 30 | 0 / identical / 0.000000 | 0 | 0 |
| 60 | 16 / 66.63 dB / 2.932292 | 0 | 0 |

| Anchor | Original tile PNG frames | Max channel difference | Worst 8×8 MSE | Original lossy WebM max difference |
|---|---:|---:|---:|---:|
| Main / tile 5 | 121 | 1 | 0.119792 | 100 |
| Storm / tile 3 | 121 | 1 | 0.119792 | 93 |

The PNG comparison isolates renderer consistency. The old CRF-20/chroma-subsampled tile WebMs already differ from their original PNGs; those codec differences are reported rather than treated as a renderer mismatch. `output/perf/anchors/quality.json` contains every frame. **0 / 3.63 s seams are pixel-identical at Main, Storm and 50% of their morph**, including deterministic foam and grain.

## Performance

Run conditions: visible foreground browser, Iris Xe / ANGLE D3D11, 1920×1080 and 1280×720 at DPR 1. Other heavy jobs were monitored; contested/background runs were discarded. Each running sample lasts 20 s and includes play, slider movement, ember drag and orbit. CPU timing is the render callback; GPU pass times use EXT_disjoint_timer_query_webgl2. All raw conditions and first-10-second loading frames are retained in the JSON files.

The original pre-edit baseline remains in `output/perf/baseline/performance.json`. A repeat of its archived sources (`baseline-recheck`) uses the final timer sampler, including ripple cost and zero-work samples, for aligned GPU pass attribution. The original baseline remains the opening/running comparison below.

| Size | Original baseline (fps; p50 / p95 / max) | Final (fps; p50 / p95 / max) | CPU p50 / p95 / max, baseline → final |
|---|---|---|---|
| 1920×1080 | 18.90 fps; 14.20 / 152.80 / 222.30 ms | 22.24 fps; 41.70 / 83.60 / 97.40 ms | 1.20 / 2.80 / 4.00 → 1.00 / 2.30 / 3.80 |
| 1280×720 | 32.92 fps; 27.70 / 62.60 / 110.80 ms | 41.06 fps; 20.90 / 48.60 / 55.70 ms | 0.80 / 2.00 / 3.80 → 0.80 / 1.80 / 8.30 |

GPU backpressure spreads submissions more evenly. The median submission interval rises while mean FPS and the long tail improve; the p50 target remains unmet.

| Size | First reveal baseline → final | Longest loading task baseline → final | First 10 s frame p50 / p95 / max baseline → final |
|---|---|---|---|
| 1920×1080 | 1866.30 → 1133.70 ms | 591.00 → 114.00 ms | 48.30 / 145.80 / 166.50 → 42.00 / 55.60 / 152.90 ms |
| 1280×720 | 1288.10 → 1019.00 ms | 114.00 → 98.00 ms | 20.80 / 76.60 / 83.40 → 27.50 / 34.80 / 69.30 ms |

Per-pass GPU values are **mean; p50 / p95 / max ms per sampled rendered frame**, including zero work where a pass is skipped. Final sampling uses every third frame to avoid aliasing the every-other-frame metadata cadence. Water includes the depth prepass and spray; restore includes the refraction copy. GPU sums exclude browser compositing and untimed clears.

### GPU passes · 1920×1080

| Pass | Archived baseline repeat | Final |
|---|---|---|
| simulation | 4.28; 4.21 / 5.09 / 6.36 | 2.33; 2.14 / 3.23 / 3.74 |
| ripples | 0.09; 0.12 / 0.15 / 0.68 | 0.13; 0.12 / 0.16 / 0.23 |
| history copies | 0.24; 0.23 / 0.30 / 1.07 | 0.05; 0.04 / 0.06 / 0.08 |
| access | 0.03; 0.03 / 0.04 / 0.07 | 0.61; 0.58 / 0.75 / 1.45 |
| opaque | 5.54; 5.36 / 6.62 / 10.27 | 5.41; 5.27 / 6.32 / 6.99 |
| restore | 7.27; 7.23 / 8.41 / 9.76 | 8.61; 8.53 / 9.85 / 10.40 |
| water | 23.36; 22.92 / 27.23 / 28.46 | 18.90; 18.54 / 22.50 / 23.69 |
| velocity | 1.13; 1.05 / 1.43 / 2.92 | 1.08; 0.95 / 2.20 / 2.77 |
| cinematic | 3.51; 3.45 / 4.13 / 4.71 | 3.39; 3.32 / 4.03 / 4.51 |
| PostFX | 1.60; 1.50 / 2.15 / 3.48 | 1.47; 1.39 / 1.92 / 2.33 |
| readbacks | 0.04; 0.00 / 0.20 / 0.46 | 0.09; 0.00 / 0.28 / 0.69 |
| GPU pass mean sum | 47.10 | 42.06 |

### GPU passes · 1280×720

| Pass | Archived baseline repeat | Final |
|---|---|---|
| simulation | 3.80; 3.74 / 4.32 / 5.30 | 2.18; 2.10 / 3.26 / 3.97 |
| ripples | 0.10; 0.12 / 0.14 / 0.17 | 0.08; 0.08 / 0.11 / 0.17 |
| history copies | 0.21; 0.21 / 0.26 / 0.33 | 0.04; 0.04 / 0.06 / 0.08 |
| access | 0.03; 0.03 / 0.04 / 0.06 | 0.24; 0.24 / 0.32 / 0.60 |
| opaque | 1.93; 1.91 / 2.19 / 2.48 | 1.92; 1.85 / 2.28 / 3.68 |
| restore | 2.39; 2.35 / 2.74 / 3.11 | 2.94; 2.88 / 3.36 / 5.14 |
| water | 15.11; 13.94 / 19.13 / 20.40 | 12.30; 11.62 / 15.36 / 16.98 |
| velocity | 1.02; 0.93 / 1.48 / 2.22 | 0.93; 0.87 / 1.26 / 2.42 |
| cinematic | 1.42; 1.35 / 1.85 / 2.30 | 1.42; 1.37 / 1.83 / 2.06 |
| PostFX | 0.60; 0.53 / 0.99 / 1.93 | 0.58; 0.55 / 0.83 / 1.06 |
| readbacks | 0.10; 0.10 / 0.20 / 0.56 | 0.08; 0.09 / 0.22 / 0.36 |
| GPU pass mean sum | 26.72 | 22.70 |

## Checks and packaging

- Main typecheck/build and unchanged internal lab build: `{'workers': 4, 'typecheck': True, 'mainBuild': True, 'labBuild': True, 'noticesMatch': True}`. Notices are byte-identical to the root copy in both output directories.
- Built-output browser smoke: True; exact Main cache loads, renderer=f still uses Ultra-Water, pick redirects to Settings, 390 px layout fits, 1280×720 comparison videos play in sync and A/B flip works.
- UTF-8 without BOM and media decode: True. Both frozen loops are 121 frames / 3.63 s. The live captureStream file is 52 variable-rate frames / 3.47 s; see the live recording limit below.
- `lab-checks`: True; F/P/S remain the internal lab backends. No lab port was made.
- `float-surface-checks`: True; independent corner-texel bilinear reconstruction verifies current GPU carrier at both anchors; full geometry/cascades/MSAA, sphere forcing and frame-rate-independent buoyancy are checked.
- Desktop/mobile `preview-checks`: True; tap, held ember/throw/collision splash, orbit, slider/wheel/keys, idle, 2× snapshot, real WebM recording, Settings persistence/reset/round-trip, no 390 px overflow and blocked storage. Native hidden-state limitation below is recorded explicitly.
- Ball smoothness: True; 481 samples over 4 simulated seconds at each anchor with CPU metadata deliberately held fixed. Current GPU maps still drive the ember; both traces contain zero held/zero-motion steps. `output/playwright/pass9/ball-trace/trace.json` and per-anchor rows retain the measurements.
- Seams: True; `output/perf/anchors/seams.json`. Golden and live-motion proof paths are listed above.
- `src/entry.ts` imports only Ultra-Water. Deleted only the unreferenced old main entry `src/main.ts`, superseded `src/ultra/pick.js`, and rejected trial `src/ultra/mrt.js`. `output/perf/import-graph-before-cleanup.json` and the final graph plus both builds prove reachability. Shared old code required by lab remains.

## Licences and vendored files

Base: Ultra-Water Close storm, upstream commit `30ea65ecb0a66b137aa200d099965634bdd84d51`. Research checkout stays in `.references/ultra-water`, outside src and outside build outputs. MIT notice is preserved in root `THIRD_PARTY_NOTICES.md`, vendored LICENSE/notices, and both build outputs. Dependencies were installed with --ignore-scripts in pass 8.

Vendored renderer files: `water/OceanSim.js`, `water/OceanSurface.js`, `water/Spray.js`, `water/bakeTextures.js`, `engine/fullscreen.js`, `engine/PostFX.js` under `src/vendor/ultra-water/`. Pass-9 vendor edits carry ASTRA PASS9 comments: two-spectrum selection/mix, cached/live foam blend, crest velocity, existing spray history blend, deferred foam-texture compile and equivalent back-face culling. No new spectrum or water shading term was added. Generated exact history data derive from these MIT sources.

Island/shore/breaker bathymetry, caustics, underwater/Snell window, aerial perspective, planar island reflection, Earth curvature and upstream scene assets are not shipped in the chunk. No non-permissive upstream code/assets were vendored; no licence-driven exclusions from the selected water pieces were necessary. Existing MIT notices for Poseidon, FFT-Ocean, Water/Acerola, dli/waves, Evan Wallace and Three.js remain for shared/lab code. User-provided Wetsun reference remains internal comparison media; author was not found.

## Targets, limitations and what is still wrong

- 1920×1080 opening is not halved: 1133.70 ms versus 933.15 ms target.
- 1920×1080 longest loading task remains 114.00 ms (50 ms target).
- 1080p p50 remains 41.70 ms (16.7 ms target).
- 1080p p95 remains 83.60 ms (25 ms target).
- 1080p max remains 97.40 ms (50 ms target).
- 1080p is 22.24 fps, below 45 fps; no quality preset was silently applied.
- 1080p first-10-second maximum remains 152.90 ms (50 ms post-reveal target).
- 1280×720 opening is not halved: 1019.00 ms versus 644.05 ms target.
- 1280×720 longest loading task remains 98.00 ms (50 ms target).
- A native hidden/occluded document could not be induced in this Windows automation Chromium: it reported visible even behind a foreground tab or when minimized. The Settings visibilitychange handler was therefore tested with an explicitly emulated hidden state; all videos paused. Native event delivery itself is not claimed as verified. IntersectionObserver/off-screen playback and foreground synchronization are tested separately.
- Live MediaRecorder capture decodes successfully but its last available frame ends at 3.47 s for the configured 3.63 s wall-clock recording. It is variable-rate recording, not the exact 121-frame frozen export. Both frozen comparison loops remain exactly 3.63 s. This live recorder endpoint limitation is not hidden.
- Full removal of restore, MRT velocity and the .5 px blur cutoff were tested and rejected as described above. They are not in the active renderer. Lower resolution/MSAA/cascade/mesh/blur/DOF/bloom presets were not applied.
- Quality-cost option available for user approval: remove the exact restore stage (measured trial gain, but visible edge/depth differences); the .5 px blur cutoff also changes sharp glints and is not applied. MRT was slower and is not recommended as a speed option. No unmeasured preset FPS is promised.
- A 1280×720 viewport measured 41.06 fps. Lowering internal resolution for a 1080p window would lose detail; that preset is neither implemented nor applied, and its upscaled-window FPS is not claimed as measured.
- The user has no unresolved stated complaint about the accepted appearance: dark colour and reduced reflections are accepted. The remaining stated complaint is loading/runtime lag; the measured remaining limits above are not hidden. User eye review of before/after is requested at the final STOP.
- No required check or unimplemented feature is intentionally omitted from this report. Soft performance targets that remain unmet, rejected quality-changing candidates, the native visibility-test limit and the extra deterministic-cache memory are listed explicitly.

`own-cleanup` is run before the STOP; kept :4103 remains running. No process belonging to another project was killed. All builds, captures, checks and benchmarks run through heavy; browser/test workers are bounded and no watch-mode test was started. No files outside this project were deleted.
