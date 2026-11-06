# Water Lab — source study and implementation contracts

Main and F now share the live FFT, heightfield, final-surface probes and material in `src/water/`. F opens with **Storm box** and retains **F baseline** in Tune/JSON; P/S retain their independent engines and original presentation defaults. Current usage/contracts are in `README.md`; current measurements and remaining visual differences are in `REPORT.md`. The older comparison figures below are historical evidence, not verification of Storm box.

## Sources read

All checkouts are under `.references/`, outside `src/`, ignored and not built/shipped.

### Poseidon — MIT, owenyuwono

Source: https://github.com/owenyuwono/poseidon

Read `src/ocean/{Ocean,OceanCascade,spectrum,fft,maps,gaussianNoise,oceanSurfaceMaterial,water,params}.js`, the material's construction/reflection/scatter/glitter sections, `src/main.js`, and its deterministic capture utility.

Reuse in **P**: its actual WebGPU/TSL spectrum, conjugate packing, four packed complex fields, butterfly-table inverse FFT, separate-submit stage barriers, map generation, advected build/decay foam, detail texture, exact dielectric Fresnel (n=1.34), Henyey–Greenstein crest scattering, GGX glitter knee, and Jerlov transport attenuation. Replace the camera-centred radial grid with a finite square, use a physically scaled scene, rotate the custom normal with the sheet, replace the panorama function with the shared studio sky, and add the lab's ember/floor/output. Parameter/loop changes are explicitly marked in the vendor fork; do not quietly replace its ocean with F.

Reuse as a reference in **F**: wavelength ownership, seed/conjugate contracts, coherent horizontal derivatives, wavenumber-weighted choppiness, persistent foam and the GGX knee. F is a separate WebGL2 backend, not a wrapper around P.

Important source observations: the checked-out `directionSpectrum` actually evaluates Horvath cosine-2s spreading. It is described as Donelan–Banner in comments, but does not evaluate the beta/sech-squared Donelan–Banner function. F will explicitly use the normalized Donelan–Banner function from the papers/gasgiant source. P retains its own directional model. The current Poseidon material also contains authored far-field reflection limits, distance effects, a fore/aft lean and a short-wave tail roll-off. They are part of P, not evidence that every knob is a physical constant; F does not import them.

The original demo is installed only in its reference checkout. Attempt it in headed hardware Chrome and save three storm-wind views. Those images are upstream-demo evidence, not substitutes for a live lab variant if the port works.

### gasgiant / FFT-Ocean — MIT, Ivan Pensionerov

Source: https://github.com/gasgiant/FFT-Ocean

Read `InitialSpectrum.compute`, `WavesSettings.cs`, `TimeDependentSpectrum.compute`/packing through the equivalent Acerola and Poseidon ports, `FastFourierTransform.compute` through Poseidon's port, and `Ocean.shader`.

Reuse in **F**:

- Horvath 2015 fetch/wind parameterization: alpha = 0.076 (g fetch / U10²)^−0.22, omegaPeak = 22 (U10 fetch / g²)^−0.33; g=9.81 m/s², fetch in metres.
- JONSWAP sigma 0.07/0.09, gamma 3.3, omega^−5 tail, deep-water dispersion and derivative. No target-RMS normalization or arbitrary sheet-unit gravity.
- Normalized Donelan–Banner beta/sech² directional lobe, wind sea plus a separate swell lobe at +20°. The swell weight is spectral energy, not an extra carpet mode.
- Hermitian pairing and packed real-field algebra, with an explicit one-sided spectral-energy conversion. Unit-variance Gaussian real/imaginary samples and the two conjugate time-evolution terms give E|h(k,t)|²=4a²; therefore F uses a=0.5*sqrt(S(omega) D(theta) dOmega/dk DeltaK²/k). The upstream sqrt(2E) convention produces eight times that one-sided energy with the same random-number convention. P's density weights are divided by eight for the same physical comparison. This is a Fourier/PSD convention correction, not target-RMS fitting.
- The published crest/view subsurface-scatter approach; the actual lab optical order follows the ATLAS recipe supplied in the brief rather than Unity's Standard surface shader.

Primary references: [Tessendorf 2001](https://www.researchgate.net/publication/264839743_Simulating_Ocean_Water), [Horvath 2015, DOI 10.1145/2791261.2791267](https://doi.org/10.1145/2791261.2791267), [Flügge 2017](https://tore.tuhh.de/bitstream/11420/1439/1/GPGPU_FFT_Ocean_Simulation.pdf), [War Thunder ocean presentation](http://developer.download.nvidia.com/assets/gameworks/downloads/regular/events/cgdc15/CGDC2015_ocean_simulation_en.pdf).

### Garrett Gunnell / Water — MIT

Source: https://github.com/GarrettGunnell/Water

Read `FFTWater.compute`, especially initialization, quantized dispersion, conjugate packing, packed displacement/slope fields and foam assembly. Reuse the packing/sign convention and loop-frequency quantization as an independent cross-check of gasgiant. The repeat period is physical time 3.63*tau seconds; display time is mapped to physical time by tau. Report Hs from the represented coefficients and measured relief separately from hero exaggeration.

### David Li / waves — MIT

Source: https://github.com/dli/waves

Read `simulation.js` Stockham subtransform and scheduling. Reuse the fragment ping-pong Stockham indexing in **F**, extended to two RGBA MRT attachments (four complex transforms), positive inverse twiddles, and one final centred-spectrum permutation. The inverse is the unnormalised synthesis sum; the initial coefficients explicitly carry the one-sided physical PSD convention described above. Validate a centred DC impulse and one-bin complex sinusoid before showing ocean output. Compare float32/half storage with actual GPU work before choosing the production target type.

### Three.js interactive water and Evan Wallace — MIT

Sources:

- https://github.com/mrdoob/three.js/blob/r186/examples/webgl_gpgpu_water.html
- https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_compute_water.html
- https://github.com/evanw/webgl-water

Read the official finite-difference neighbour/previous-height update, explicit WebGPU read/write ping-pong, water-level/normal probing, and Evan's `water.js` drop, height/velocity and moved-sphere volume shader.

Reuse in **F**: the 256² height/velocity layer, fixed CFL-safe step, time damping, bounded drops and moved-sphere columns. The current 12×8 asynchronous batch reads the load-bearing C0+C1+heightfield carrier, not decorative foam. Base geometry supplies carrier XZ, tangent-Z alpha preserves carrier height; carrier tangents are differentiated independently of the visual foam relief. Request/receipt timestamps distinguish actual sample age from time since callback. Main buoyancy integrates its own XYZ velocity and samples outside the sphere-column mask: the fictitious depression inside the solid must not drive buoyancy. F's diagnostic presentation remains a material-point pose, not evidence of live inertial floating.

### Seascape technique — attribution only, no copied source

Alexander Alekseev, **Seascape**, https://www.shadertoy.com/view/Ms2SD1, CC BY-NC-SA. No Shadertoy shader source is downloaded, pasted or ported. **S** is an original implementation from the mathematical technique stated in the task: periodic value-noise domain warp, sine/cosine choppy wave shape, opposing motions, octave frequency ×1.9, amplitude ×0.22, UV rotation and choppiness relaxing toward 1. Three geometry octaves, five shading octaves. Every octave translates by an integer number of its common sine/noise periods per loop; the speed control is integer cycles per loop so it remains periodic.

## Physical and presentation decisions

- P/S retain the original hero convention, S/8 ember and ±9° pitch/roll. F has a parameterized small ember and fixed `STORM_VIEW`, also used by main; changing it does not alter P/S. All use a 3.63 s display loop. No bend/twist or global no-fold claim.
- **F baseline** retains S=160 m, periods 160/37/9, U10=18 m/s, fetch=30 km, tau=2.8, gamma=3.3, swell input 0.4, uniform hero gain 2.5, mesoGain=1 and chop=1. **Storm box** separates the 68.3365 m visible window from its 85.4206/19.7535/4.8049 m FFT periods and uses an explicitly artistic peak gain plus a bounded resolved-detail shoulder. Baseline is a reproducible spectral preset, not a pixel-identical copy of the old material/view.
- F's half-open, disjoint bands at S=160 m are below (subject to the discrete Fourier lattice).

| Cascade | L (m) | N | Wavenumber ownership (rad/m) | Wavelength span (m) |
| --- | --- | --- | --- | --- |
| C0 | 160 | 256 | 0.039270–1.675516 | 160–3.75 |
| C1 | 37 | 128 | 1.675516–3.622737 | 3.75–1.734375 |
| C2 | 9 | 64 | 3.622737–7.446738 | 1.734375–0.84375 |

- **Brief inconsistency:** L=9 m, N=64 and six texels/wavelength cannot also yield a 0.3 m shortest wave. 0.3 m is only 2.13 texels. Preserve the explicit six-texel anti-stipple rule, giving 0.84375 m, and report this choice rather than silently aliasing the smallest cascade.
- Choppiness stays coherent with spectral derivatives and short-wave attenuation. The old local J-based displacement rescale was removed: it introduced d*grad(scale) creases without a final-J guarantee. Final 512² tangents/J are finite differences of actual C0+C1 + quadratic crest + foam relief + heightfield geometry. Original compression is labelled separately. Folds may occur and both sides are shaded.
- The resolved-detail shoulder is `1 + (mesoGain-1) W(log(k/kp))`, with smooth rise over 5–9 kp, plateau 9–15 kp, and fall over 15–24 kp. Storm box uses mesoGain=3; the large modes below 5 kp and the C2 normal tail are not amplified by this shoulder. CPU diagnostics and GPU evolution share the logarithmic limits; height, displacement and all derivatives receive the same gain. Enabled detail also rolls short-wave choppiness down by 12 kp to avoid turning the added ripples into small folded cells. Baseline's old choppiness roll-off is retained. JSON import/export validates mesoGain in 1–5; there is no new user mode or GUI control.
- Bulk aeration uses the C0+C1 strain tensor filtered over 0.1 input peak wavelength, selected on large crests; C2 whitecaps remain separate. The coarse source Jacobian is not the final geometric Jacobian. Sustained compression can keep entraining water at the crest: gating birth by `-dJ/dt` incorrectly extinguished that event at maximum compression. This source is an artistic breaking potential, not a fluid-collapse solver or a global phase/cloud overlay.
- Material-coordinate history stores **R bulk density / G short whitecaps / B R-weighted fold moment / A coarse source J**. RGB is transported and diffused together; B is added only with newly entrained bulk water. Residual slip is 1.1 m per animation second, diffusion 0.16 m²/s, bulk decay 0.28 s at 1×; no extra physical tau multiplier or second orbital advection. Convergence checks all RGB channels over at least three cycles; zero-dt resume restores the full displayed RGBA cache.
- Visual fold height is `relief * B*(1.5-0.5R)`, bounded by the unchanged 0.9 m relief because `0 <= B <= R <= 1`. Irregular multi-scale birth lobes are modulated by the resolved C0+C1 high-pass height, then transported with R. The former elongated isocontour ribs and independent UV churn are removed. Density tapering replaces the former `B/(R+0.25)` thickness recovery at wet edges. This is artistic aeration morphology, not simulated overturning. Complete finite-difference visual normals include the relief; carrier probes exclude it.
- Storm box uses seed **123456789**, common phase **1.8 s**, tau **3.04**, normalized wind angular-width multiplier **1.7**, peak gain **5.5**, mesoGain **3**, chop **1.32**, and zero quadratic sharpening. Large-wave amplitude, lattice periods, visible size, camera and sphere radius were not changed in the material-character pass. A narrower meso-direction lobe was tried and discarded for insufficient visual benefit; it is not another hidden spectral rule.
- F/main retain dielectric Fresnel, environment reflection, GGX and scattering. Roughness separates macro-normal pixel variance from unresolved C2 mip moments; base-level bilinear moment variance is subtracted and C2 within-pixel gradients fade out when mip filtering already covers the footprint. It is not a global roughness blur. Resolved C0/C1 slopes are not counted a second time; dense bubbles add their own interface variance. The effective Beer-type optical column varies continuously through the wave height, returning turquoise slope midtones without Lambert terrain shading or exposure gain; it is explicitly not a ray-traced thickness of the cut sheet. Bubble optical depth follows transported R/B. There remains exactly one HDR → Neutral → sRGB output.
- The original compact environment is retained; direct GGX key energy is reduced from 0.55 to 0.20 after sun-only isolation identified the silver islands. Individual bright points and wet Fresnel reflection remain. The F sphere footprint uses reflected angular variance with `alpha=rough²` and emitter-area attenuation, without forcing the ray above the horizon. Its source now has a hot spot and dim limb rather than a uniformly bright disk. This is an analytic finite-emitter approximation, not scene-traced reflection; phase 0 remains too short/merged compared with the reference. Shared S optics remain unchanged.
- One radius 0.575 controls F/main mesh, reflection and metre-space sphere columns; P/S keep 1.25. Main floating/landing/return share one damped XYZ state with no bobbing→track velocity reset. Four support queries use the same GPU carrier outside the sphere-volume mask, with texel padding rather than an enlarged ball. Carrier raster picks preserve the frontmost branch and bounded inverse continuation does not promise global uniqueness. Camera is unchanged; no horizon guard is introduced.
- P keeps its original metre-space optics at sea-level y=0; floor and camera are translated down by the same 64 m, so framing/floor separation remain identical. Its custom normal/detail vectors and sea-up rotate with the mesh. Height-dependent crest optics read displaced `positionLocal.y`, not altitude from the rigid tumble. Signed GPU probes use `fragmentNode`, not colour-clamped `colorNode`.
- P retains the upstream common N=256 for all three cascades; F uses the requested mixed 256/128/64 resolutions. This is reported as a performance/detail difference rather than calling the two implementations identical.
- GPU readback captures use an RGBA8 offscreen target for P; they do not rely on the lifetime of WebGPU's presentation texture. All palette/crop metrics come from actual beauty and surface/foam masks, not material constants.
- The lab is a comparison instrument: 2×2 synchronized tiles, no decorative dashboard. Teal utility chrome, coral image fields, system UI labels and monospace phase/physical readouts; a shared phase ruler is the signature. Tile focus/Esc, sliders, JSON presets, tap/B interaction and capture hooks are real controls.

## Running and reproducing the comparison

- Open `http://localhost:4103/lab.html?variant=F` to run only F on the current kept server. `?t=1.8&freeze=1&variant=F` freezes it. The grid remains available deliberately; current F opens with Storm box, while Tune offers F baseline.
- Play/Space, scrub, ¼×/1×, each tile's Tune panel, JSON save/load, and F's tap/B controls are functional. B starts a two-metre sphere-bottom drop above the local mean surface; the sphere's submerged-column change drives the GPU heightfield.
- Historical `best-F.json` used heroHeight=3.5, chop=1.15 and Jthr=0.35. Those pre-Storm captures are not the current default. Storm box saves the actual window, cascade lengths, peak gain, meso shoulder gain, angular width, crest correction, seed, common phase and foam transport settings; import rejects invalid ranges, zero angular width, fractional seeds and empty cascade bands.
- Gain scales coherent height/displacement/derivatives. Physical Hs, gained linear Hs, measured nonlinear relief and truncated/discrete swell representation are reported separately. There is no hidden RMS normalization.
- One measured output calibration adjusts F's dark-body radiance to linear `(0.048,0.068,0.064)` and S's base radiance to `(0.060,0.085,0.082)`. It does not change spectra, geometry or Fresnel. P retains its mature optical palette; its bluer output is an explicit comparison difference.
- Loop-off F retains true dispersion; a nonperiodic seek reconstructs preceding foam history for at least three display loops or seven decay constants. Heightfield uses display-time CFL substeps, not another tau factor.
- `heavy node scripts/lab-checks.mjs http://localhost:4103 --variant=F` exercises only F, including preset round-trip, convergence/resume, arbitrary carrier probes, continuous cycles and real heightfield propagation/volume forcing. Resume now compares the actual beauty image as well as coverage; continuous-cycle comparison checks R/G/B rather than density alone, so a fold-moment flash cannot hide behind an unchanged density mask.
- `heavy node scripts/lab-capture.mjs` saves defaults, six best-look grids, 121 motion frames per candidate, matched detail phases, loop endpoints, the non-loop contrast and the four F wind presets. `heavy python scripts/lab-compare.py` makes the detail/contact sheets, screen-colour measurements and two-loop MP4s.
- `heavy node scripts/lab-interaction.mjs` records real taps and sphere-volume drops at Calm wind to make the interactive layer legible. `heavy python scripts/lab-encode-interaction.py` encodes and decodes that actual recording.
- Run `heavy node scripts/lab-performance.mjs` only when the other heavy slot is idle. It measures one focused 1920×1080 native-hardware candidate at a time, after warmup, with before/after queue evidence.
- Current build commands: `heavy npm run build` (typecheck + main), then `heavy npx vite build --config vite.lab.config.ts`. No new runtime dependencies are installed. Legacy capture scripts with a 4103 default must receive the actual URL; their old output is not current evidence.

## Historical verified behaviour — pre-Storm lab study

- Headed native-hardware checks pass all seven groups: F/P/S availability, actual water retained during paused enlargement, play/quarter-speed/scrub/Esc, GUI/preset import/export plus rejection of a zero-metre patch, scrubbed-foam continuity, finite-difference tap propagation/decay, and gravity-driven sphere-volume forcing.
- F's FFT isolation errors: constant 2.384×10^-7; one-bin complex sinusoid 2.813×10^-5. P's original validation: constant 0; sinusoid 2.974×10^-8.
- Frozen t=0 versus t=3.63 is pixel-identical for all three candidates: maximum RGB difference 0. F with true dispersion selected does not repeat at 3.63.
- GPU buoyancy was chosen instead of a CPU 64² mirror. F's asynchronous 3×3 probe includes C0+C1 and the interaction heightfield. Frozen cached/probed height difference is 0 m at all three captured phases. Live readback has latency; it is not represented as a zero-age CPU solver.
- The 256² field is exactly zero before any input. A measured tap RMS decays from 0.006826 m to 1.044×10^-8 m after the settling wait. The sampled post-drop field is finite with maximum 1.069 m; moved-sphere volume forcing actually runs.
- A late verification found a genuine lab bug: resuming a scrubbed F phase reused the final warmup phase's foam. Before correction, 54,177 visible water pixels changed at zero elapsed time, maximum foam-channel delta 255. The GPU phase restore fixes it: 0 changed pixels, maximum delta 0. The permanent headed check catches this transition.
- Typecheck and the isolated production build pass after that fix. Comparison movies were decoded with the existing FFmpeg library because this host has no `ffprobe` on PATH; no global tool installation was needed.

## Historical native hardware performance

1920×1080 focused canvas, best-look presets, actual rendered-frame count over 12 seconds after 2.5 seconds of warmup. The other heavy slot was free in every before/after snapshot; no software renderer was used. p95 is the last up-to-900 retained frame intervals within that window, not reciprocal GPU time. F was remeasured after the foam-resume correction; P/S rendering paths were unchanged.

| Candidate | Native backend | Mean fps | p95 frame interval |
| --- | --- | --- | --- |
| F | Iris Xe / ANGLE D3D11, WebGL2 | 117.5 | 16.1 ms |
| P | Intel gen-12lp, WebGPU | 62.2 | 25.6 ms |
| S | Iris Xe / ANGLE D3D11, WebGL2 | 94.3 | 18.4 ms |

The actual WebGPU run used headed Chromium with WebGPU enabled. Other browsers need a working native WebGPU adapter for P; its explicitly labelled upstream-capture fallback is not represented as a live simulation. P keeps three 256² transforms, so these are not resolution-matched FFT costs. F uses RGBA32F FFT scratch for derivative precision and RGBA16F sampled maps after trying both target formats.

F's final live measurement recorded a 42.3 ms last probe readback and a 0.195 m cached-versus-fresh GPU height difference at that snapshot. This is a latency tradeoff of the selected async probe, not a claim of live 1 mm buoyancy. The frozen same-phase height difference remains 0 m. Full intervals, hardware and queue snapshots are in `output/playwright/water-lab/performance.json`.

## Historical comparison results and selection boundary

Visual judgment from the synchronized grid, paired detail crops and decoded movie frames:

- **Water realism: P, then F, then S.** P has the most connected crest trains/broad troughs, compression-aligned whitecap bands, and coherent angle-dependent blue-water transport. F is close but more glitter-dominated. S retains regular cellular hollows and a matte/terrain-like reading in this hero view despite the prescribed choppy-octave math.
- **Reference resemblance: F, then P, then S. Recommend F for the next integration task.** F's dark teal is closest to the measured reference, its ember reflection remains saturated red-orange rather than P's pinkish mixture, and its fine wavelets/whitecaps preserve the reference's dark/wet contrast. This is not a claim of a finished GIF match.

Colours below are actual masked screenshot means at frame 0. Coverage/relief ranges use the three requested phases (0, 1.8, 3.0 s), not a claimed whole-loop extremum. “Mound” means intermediate foam coverage; none of the candidates creates the reference's large coherent cauliflower mound.

| Candidate | Dark open water | Thin whitewater | Whitecap coverage | Crest-to-trough / S |
| --- | --- | --- | --- | --- |
| Reference target | `#2e4a49` | `#5697a8` | — | — |
| F, best preset | `#2d4c4e` | `#5e9299` | 3.70–6.45% | 4.85–5.80% |
| P, best preset | `#0f3a4d` | `#849a9e` | 4.98–7.94% | 4.98–5.58% |
| S, best preset | `#304a4a` | None; no whitecap model | 0% | 4.05–4.43% |

F's requested defaults **do not meet** the 3–8% whitecap target: measured coverage is 0.0913%, 0.00575%, 0.00216% at those phases. The physical one-sided spectrum gives Hs=1.496 m and peak wavelength=37.965 m; the separate best-look preset raises coherent hero gain from 2.5 to 3.5 and chop from 1 to 1.15, with no RMS normalization. Rendered hero Hs is then 5.236 m. The default four-wind screenshots intentionally retain the specified 2.5/1.0 gains.

Remaining look differences:

- F: lower large-form relief than the GIF; fragmented whitecaps instead of one large blue-whitewater mass; a reflection footprint that is too broad/bright.
- P: too navy/blue, grey-pale whitewater, and pink contamination in the orange reflection. Its original Jerlov/material palette and three 256² cascades are retained as a meaningful mature-implementation comparison, not silently replaced by F.
- S: still sculpted/cellular rather than storm water; sparse broad reflection arcs and no whitewater. Raising its height to 0.65 made the terrain reading worse, so the best preset stays at 0.35.
- Shared: the explicitly requested S/8 ember radius produces a disk roughly twice the GIF's diameter, biasing the wave-scale cue and widening its reflection. It is consistent across all candidates, not secretly resized to win the comparison. No candidate reproduces the GIF's floor-shadow filaments; the lab requested a common coral floor, not a new shadow port.

### Artifacts

All paths below are under `output/playwright/water-lab/`.

- Six 1920×1080 grids: `grid-000.png`, `grid-020.png`, `grid-040.png`, `grid-060.png`, `grid-080.png`, `grid-100.png`.
- Paired two-times detail sheets at frames 0/60/100: `detail-F.png`, `detail-P.png`, `detail-S.png`. `contact-sheet.png` includes the reference and all three candidates. Crops normalize framing to the reference's 500×281 resolution, then enlarge exactly 2×. Reference ember detection uses its connected disk, not the orange-reflection centroid.
- Two-loop side-by-side movies: `comparison-F.mp4`, `comparison-P.mp4`, `comparison-S.mp4`. All three were decoded successfully: 1280×720, 242 frames, 7.26 s. `media-verification.json` and `media-proof-*.png` record the decoded containers/frames.
- F physical-default wind views: `F-calm.png`, `F-rough.png`, `F-storm.png`, `F-gale.png`.
- Actual F wave-equation interaction: `F-interaction.mp4` (1280×720, 7.63 s), from three taps and two sphere-volume drops at wind 10. The native WebM is retained. MP4 output is explicitly 60 fps CFR for ordinary browser decoding; it is not a claim that every encoded frame is a distinct captured simulation frame.
- Original Poseidon at storm wind 18: `poseidon-original/rail.png`, `poseidon-original/swell.png`, `poseidon-original/aerial.png`. Native Intel WebGPU, all three ready, no application errors. That temporary upstream server was stopped; these are captures, not a fake live P tile.
- Presets: `best-F.json`, `best-P.json`, `best-S.json`, `best-all.json`, `specified-defaults.json`. Load through **Load JSON** on the grid to reproduce the compared settings. Frozen phase hooks are `window.__lab.ready` and `await window.__lab.setTime(t)`.
- Raw surface/control evidence: `capture.json`, `comparison.json`, `checks.json`, `interaction.json`, `interaction-media.json`.

### Integration status

| Candidate | Browser/rendering requirement | Buoyancy and interaction migration |
| --- | --- | --- |
| F | Integrated: main and lab share WebGL2 modules under `src/water/`, with one output transform per page. | Twelve arbitrary batched carrier samples with full normals and bounded fold continuation; raster-depth taps, shared physical radius, heightfield impulses/volume/tilt, actual surface shadow and bloom depth. |
| P | Native WebGPU. Main renderer, custom post/shadow passes and other custom materials need a WebGPU/TSL port; WebGL render targets cannot be shared directly. | Original displaced-vertex GPU probe is present. The F heightfield would need a WebGPU compute adaptation; P/S do not pretend to have F's interactive simulation. |
| S | WebGL2 analytic material; the simplest surface-provider contract, but not the fastest measured shader automatically. | CPU three-octave buoyancy is present. Reuse F's heightfield for interactions; a whitecap model and substantial look work are still needed. |

F is now integrated on main. The old baked atlas, CPU surface, worker/cache and their consumers were retired only after successful main GPU rendering/picking and interaction smoke. Original source/config is recoverable from `output/checkpoints/before-storm-box/sources.zip`. P/S and sound remain independent. `REPORT.md` identifies the current builds, native performance and visual evidence; the historical numbers above are not reused as new results.

## License handling

`THIRD_PARTY_NOTICES.md` retains the upstream MIT copyright/permission notices for code used or adapted. Copied Poseidon modules stay in a clearly attributed lab-only vendor subtree. S credits the Seascape technique without importing CC BY-NC-SA code. Reference checkouts and their npm dependencies are excluded from the production build.
