# Third-party notices — Floating Ocean and Water Lab

Ultra-Water adaptations for the main floating chunk live under `src/vendor/ultra-water/`. Poseidon source remains under `src/lab/vendor/poseidon/`; lab changes are described in `docs/water-notes.md`. Research checkouts are not shipped.

## Poseidon

https://github.com/owenyuwono/poseidon

MIT License

Copyright (c) 2026 owenyuwono

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## FFT-Ocean

https://github.com/gasgiant/FFT-Ocean

MIT License

Copyright (c) 2020 Ivan Pensionerov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Water / Acerola

https://github.com/GarrettGunnell/Water

MIT License

Copyright (c) 2023 Garrett Gunnell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Waves / fragment Stockham FFT

https://github.com/dli/waves

MIT License

Copyright (c) 2014 David Li (http://david.li)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## WebGL Water

https://github.com/evanw/webgl-water

MIT License

Copyright 2011 Evan Wallace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Three.js and interactive-water examples

https://github.com/mrdoob/three.js

MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Seascape technique — attribution, no copied shader code

Alexander Alekseev, Seascape, https://www.shadertoy.com/view/Ms2SD1 (CC BY-NC-SA). Variant S independently implements the mathematical technique specified in the task. No Shadertoy shader source was copied, included or ported.

## Ultra-Water — pass 8

Source: https://github.com/Humpalumps/Ultra-Water

Research checkout: `.references/ultra-water`, commit `30ea65ecb0a66b137aa200d099965634bdd84d51`.
Step 1 ran the unmodified upstream renderer for evaluation captures. The user selected the Close storm view. Step 2 adapts the following MIT files into `src/vendor/ultra-water/`; alterations are marked `ASTRA PASS8`:

- `water/OceanSim.js`: existing four-cascade FFT, JONSWAP/swell, recovery foam; finite periods, requested loop/pace/gain/damping controls and periodic foam replay.
- `water/OceanSurface.js`: existing LEAN, GGX, Fresnel, glints, Beer absorption, crest scatter, lace/billow and whitewater flow; finite sheet, studio and existing ember adaptations.
- `water/Spray.js`: existing ballistic spray and floater splash; FFT crest emitters replace shoreline emitters.
- `water/bakeTextures.js`: procedural lace/billow texture, unchanged apart from the attribution header.
- `engine/fullscreen.js`: fullscreen pass utility, unchanged apart from the attribution header.
- `engine/PostFX.js`: AgX, dual-filter bloom and dither; deterministic clock, independent grain and snapshot output adaptations.

`LICENSE` and the complete upstream `THIRD_PARTY_NOTICES.md` are also preserved in that directory. `scripts/vendor-pass8.py` records the adaptations. The island, shore/breaker bathymetry, caustics, underwater/Snell rendering, aerial atmosphere, planar island reflection and Earth curvature are omitted for scope, not because of a licence restriction.

MIT License

Copyright (c) 2026 Humpalumps

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Ultra-Water's adapted code

The upstream `THIRD_PARTY_NOTICES.md` was read before evaluation. It identifies
the following MIT-licensed adaptations, covered by the MIT permission and
warranty terms printed above:

- three.js: Copyright © 2010–2026 three.js authors. Sky cloud layer and AgX tone mapping. https://github.com/mrdoob/three.js
- Hash without Sine: Copyright (c) 2014 David Hoskins. Hash functions in post, sky, terrain, water, spray and texture baking. https://www.shadertoy.com/view/4djSRW
- UnrealEngineSkyAtmosphere: Copyright (c) 2020 Epic Games, Inc. Atmosphere reference implementation. https://github.com/sebh/UnrealEngineSkyAtmosphere

Runtime npm dependencies are three.js and lil-gui, each MIT licensed with its
own notice in the research checkout's `node_modules` directory. The checkout
contains no separately licensed texture or model assets. No nonpermissive
Ultra-Water pieces were found or included. The reference GIF is user-supplied
comparison material; no authorship or redistribution licence is claimed.
