# Floating Ocean

## Current version — Astra Ocean

The main page uses the Ultra-Water floating chunk. Open Settings to choose the Main and Storm looks. See [REPORT.md](REPORT.md) for the current implementation and checks; the notes below include earlier development passes.

Install [Git LFS](https://git-lfs.com/) before cloning so the generated videos and ocean caches are downloaded:

```sh
git lfs install
git clone https://github.com/Prozorog/astra-ocean.git
cd astra-ocean
npm ci
npm run dev -- --port 4103
```

Open `http://localhost:4103/`; Settings is at `/settings.html`. Build with `npm run build`; build the internal lab with `npx vite build --config vite.lab.config.ts`.

Required generated runtime assets are included through Git LFS. Local checkpoints, build outputs and the third-party visual reference with unidentified authorship are excluded. Third-party licence notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Earlier development notes

A live, deterministic GPU spectral ocean on a suspended sheet, with a playable ember and transient water interactions. Existing Three.js 0.186.1, Vite 8.3.5, TypeScript and WebGL2 stack; no new dependencies or runtime reference images/video.

## Run

Use the existing installation. Check the project's server before starting another:

```text
own-start --keep npm run dev -- --port {port}
heavy npm run build
heavy npx vite build --config vite.lab.config.ts
```

Kept server: **http://localhost:4100/**. Shared-engine comparison: **http://localhost:4100/lab.html?variant=F**. `own-cleanup` stops temporary verification servers, not this kept server.

## Preview controls

Grab and flick the ember; tap the water; drag elsewhere to orbit. Hover tilts the sheet and fast movement excites a damped heightfield disturbance. The wheel changes Storm, **not zoom**. The ember falls, splashes, can skip twice, then returns to its surface-following track. Transient water disturbances and particles decay; no reset occurs at the background loop boundary.

The existing dock contains playback, speed, Storm, four moods, opt-in sound, PNG export, one-loop recording, hero-camera reset and shortcuts. It hides after three seconds of inactivity. Mobile retains horizontal scrolling and 44px controls. Reduced motion disables the arrival drop, hover tilt and slosh; deliberate grab/tap remains available.

| Key | Action |
| --- | --- |
| Space | Play / pause background waves |
| 1 / 2 / 3 | 0.25× / 0.5× / 1× |
| [ / ] | Calmer / stormier |
| M | Coral → Midnight → Mint → Sand |
| S | Sound on / off; AudioContext starts only on this gesture |
| P | Download `floating-ocean.png`, offscreen at twice the canvas dimensions |
| L | Download `floating-ocean-loop.webm`, one loop at current speed/mood |
| R | Return to hero view; orbit inactivity also returns after four seconds |
| H / D | Developer controls / optional lip specks |

Moods crossfade the real floor, vignette, environment, scatter/foam, emitter and reflection uniforms over 0.8 seconds. Recording clears transients and awaits an exact GPU phase zero before its media clock starts. Snapshot preserves the current simulation state.

## Model and artistic controls

Main and F share `src/water/`: the existing Stockham GPU FFT, spectrum, heightfield and material. P/S keep their own engines and presentation defaults. F's Tune menu includes **F baseline** (original spectral settings) and **Storm box**; JSON includes seed, common phase, window/cascade lengths and gain settings, with actual import validation.

Storm box: 10 display units = 68.3365 m visible window; FFT periods 85.4206 / 19.7535 / 4.8049 m; N=256/128/64; six-texel minimum wavelength and half-open, nonoverlapping bands. Wind=18 m/s, fetch=30 km, gamma=3.3, swell input=0.65. The finite window is not the FFT period; its opposite edges need not meet.

A peak-only gain of 5.5 falls from full gain at 2kp to unity at 8kp in log-k. It replaces the former uniform gain; the short tail is not boosted identically. There is **no target-RMS normalization**. Storm box uses choppiness 1.4, disables the quadratic crest correction, and limits the artistic entrained-layer relief input to 0.9 m. These extensions are **not a full breaking-fluid solver**. Discrete represented swell energy and dominant wavelength are reported separately from their inputs.

C0+C1 drive large compression foam; C2 has a separate whitecap source. Foam history lives in undeformed material metres (orbital motion is not applied twice), with residual slip 1.1 m/display-second, diffusion 0.16 m²/display-second and decay 0.28 display-seconds at 1×. Startup checks periodic convergence for at least three cycles and retains a converged history cycle for seeking; waves are always computed live. Quantized dispersion and common phase=1.2 s give a 3.63 s display loop, with two cycles per loop for the dominant discrete mode (1.815 s), not arbitrary unquantized timing.

The 512² visual geometry contains C0+C1, foam relief and the 256² heightfield; the displayed sheet uses 320 segments. Finite-difference tangents/Jacobian describe this actual geometry, including the relief. The spare tangent-Z alpha retains the **carrier height before decorative foam**, without another map. C2 adds shading-only unresolved ripples and slope-variance filtering. Foam RGBA stores macro history, short whitecaps, normalized connected-fold morphology, and previous compression J; morphology is built once per 256² foam update, not repeatedly at every 512² normal tap.

Batched **12×8 GPU probes (1536 bytes)** provide arbitrary carrier positions/normals, XYZ velocity, request/receipt timestamps and result sequence. Contacts use bounded inverse continuation and bounded prediction; failed fold inversions do not claim a globally unique inverse. Taps depth-rasterize the carrier, not decorative foam. One radius, **0.575 display units**, still drives mesh, reflection, contact and sphere-column forcing. Nominal immersion is 30% of diameter; crests may obscure the ember.

The main ball has its own XYZ position/velocity. GPU equilibria and measured fluid velocities drive independent pressure/damping terms; a readback correction is not treated as an extra current. Analytic response intervals are at most 1/120 animation-second during floating, without a render-delay buffer. Floating and post-throw return share that state, without zeroing bobbing→track velocity. Four support samples sit outside the moved-sphere column mask, padded by 1.5 heightfield texels: the fictitious surface inside the solid is not a buoyant support. Their fitted carrier plane drives the contact fringe, sphere forcing and impacts. The rendered radius/camera are not enlarged or shifted.

Recording starts from the current live phase/state and runs for one period. It no longer seeks to phase zero or clears the ball/heightfield on start/stop; the previous play/pause state is restored. Explicit frozen seek remains separate.

Tap impulses, moved-sphere columns and tilt drive the CFL-safe heightfield in display time, without a second tau multiplication or duplicate analytic rings. Storm smoothly scales the existing spectrum/foam without rebuilding FFT or warming history on pointer moves; it is an artistic intensity control, not a physically exact variable-wind sea.

Main uses its existing HDR post chain only: scene-linear lighting → Neutral → sRGB once. Water-body radiance is not Lambert/cavity-shaded as terrain. Entrained bubbles replace transmitted body radiance while preserving the wet Fresnel interface, environment and broken specular highlights. Optical thickness follows the moving fold profile rather than imposing an opaque coat across the entire compression mask; C2 whitecaps remain separate. Reflections retain short camera-facing support. Floor/shadow, bloom strength, camera and UI are unchanged.

## Capture contracts

- `?t=1.2&freeze=1`: frozen, input-locked, UI hidden, no intro.
- `?ui=0`: UI hidden only; interaction/playback preserved.
- **`await window.__setTime(seconds)`**: asynchronous exact-phase seek, clears transients, restores hero view. `__ready` stays false until GPU queries/render resolve.
- `window.__play()`: resume; `freeze=1` still locks input.
- `window.__evidence()`: actual GPU initialization/probe data, parameters, render/device, frame intervals, GPU timings and interaction state.
- `await window.__ocean.advance(seconds, dt)`: deterministic continuous capture step; does not seek/reset at loop boundaries.
- `window.__ocean.setScale(value)`: explicit optional 0.8–1.0 internal render scale. Default 1.0; no automatic reduction.

The developer panel preserves Storm, spectral swell, chop, ripples, tumble, time, glow, grain, shadow, loop and debug views. Spectral edits rebuild only on finish; ordinary Storm input does not rebuild.

## Verification and artifacts

```text
heavy node scripts/preview-checks.mjs http://localhost:4100 --headed
heavy node scripts/lab-checks.mjs http://localhost:4100 --variant=F
heavy node scripts/float-surface-checks.mjs http://localhost:4100
heavy node scripts/float-motion-checks.mjs --url=http://localhost:4100 --stage=final --seam
heavy node scripts/water-shape-checks.mjs --url=http://localhost:4100 --stage=final
heavy node scripts/verify-idle.mjs http://localhost:4100 --headed
heavy python scripts/float-motion-metrics.py
heavy python scripts/float-water-media.py
heavy node scripts/preview-performance.mjs http://localhost:4100
```

Every browser/test/build/encoder runs through `heavy`; no watch mode. Performance requires native 1920×1080, DPR=1, render scale=1, hardware GPU and the other heavy slot idle. `REPORT.md` distinguishes recording overhead from native performance and lists remaining visual differences.

Current evidence is in `output/playwright/float-water/`: continuous before/final idle and throw videos/traces, live tap across a loop boundary, same-phase ablations, seven matched reference/before/result phases and fully decoded comparison movies. `float-surface-checks` verifies decorative-layer independence, both carrier/visual normals, own-sphere interior exclusion and 30/60/120 FPS × .25/.5/1/2 clock invariance. Earlier `storm-box/` captures are historical, not fresh verification.

Recovery: `output/checkpoints/before-buoyancy-crest-20261031-141648/sources.zip` and its verified SHA-256 manifest. The older migration checkpoint is also retained. No Git history is assumed.

## Source map

- `water/spectrum.ts`, `gpu-fft.ts`, `ocean.ts`, `heightfield.ts`: spectrum, live FFT, transported foam, final geometry, GPU probes and transient water.
- `water/material.ts`, `lighting.ts`, `geometry.ts`, `view.ts`, `surface.ts`, `time.ts`: shared optics, mesh/view, contact/picking and loop contracts.
- `waves.ts`: UI/interaction settings only; no bake, bend/twist, rim taper or CPU spectral sampler.
- `buoyancy.ts`, `interactions.ts`, `droplets.ts`, `sound.ts`: GPU-surface following, grab/throw, tilt, particles and unchanged procedural audio.
- `materials.ts`, `shadow.ts`, `post.ts`, `gpu-timing.ts`: ember, curvature shadow, single output chain and timing.
- `preview.ts`, `moods.ts`, `capture.ts`, `style.css`, `main.ts`: existing UI, palettes, async export and integration.
