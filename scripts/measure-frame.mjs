export async function measureFrame(page, saveMasks = false) {
  return page.evaluate(async saveMasks => {
    const api = window.__ocean, { renderer, scene, camera, top, lip, ball, floor } = api;
    const THREE = await import('/node_modules/three/build/three.module.js');
    if (!window.__captureProbe) {
      const { PHYSICAL_VERTEX } = await import('/src/water/material.ts');
      window.__captureProbe = { target: new THREE.WebGLRenderTarget(1, 1), pixels: new Uint8Array(0),
        white: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
        black: new THREE.ShaderMaterial({ side: THREE.DoubleSide, toneMapped: false, uniforms: top.material.uniforms, vertexShader: PHYSICAL_VERTEX, fragmentShader: 'void main(){gl_FragColor=vec4(0.,0.,0.,1.);}' }) };
    }
    const probe = window.__captureProbe, width = renderer.domElement.width, height = renderer.domElement.height, { target } = probe;
    target.setSize(width, height); if (probe.pixels.length !== width * height * 4) probe.pixels = new Uint8Array(width * height * 4); const { pixels } = probe;
    const previous = renderer.getRenderTarget(), clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha(), layer = camera.layers.mask;
    const objects = [top, lip, ball, floor], materials = objects.map(o => o.material), visibility = objects.map(o => o.visible), debug = top.material.uniforms.uDebug.value, shadowDebug = floor.material.uniforms.uShadowDebug.value;
    const points = scene.children.filter(o => o.isPoints), pointVisibility = points.map(o => o.visible);
    const render = () => { renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels); };
    const png = () => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'), image = context.createImageData(width, height); for (let y = 0; y < height; y++) image.data.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4); context.putImageData(image, 0, 0); return canvas.toDataURL('image/png'); };
    try {
      renderer.setClearColor(0, 1); camera.layers.set(0); floor.visible = false; points.forEach(o => { o.visible = false; });
      top.visible = lip.visible = false; ball.visible = true; ball.material = probe.white; render();
      let fullDiskPixels = 0, bx0 = width, bx1 = 0, by0 = height, by1 = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 250) { fullDiskPixels++; const x = i / 4 % width, y = height - 1 - Math.floor(i / 4 / width); bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
      top.visible = lip.visible = true; top.material = lip.material = probe.black; render();
      let visibleDiskPixels = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 250) visibleDiskPixels++; const ballMask = saveMasks ? png() : null;
      ball.visible = lip.visible = false; top.material = materials[0]; top.material.uniforms.uDebug.value = 100; render();
      let waterPixels = 0, aeratedPixels = 0, glintPixels = 0, maskSum = 0, x0 = width, x1 = 0, y0 = height, y1 = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 250) { waterPixels++; if (pixels[i + 1] >= 90) aeratedPixels++; if (pixels[i + 2] >= 128) glintPixels++; maskSum += pixels[i + 1] / 255; const x = i / 4 % width, y = height - 1 - Math.floor(i / 4 / width); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const waterMask = saveMasks ? png() : null; top.material.uniforms.uDebug.value = 101; render();
      let orangePixels = 0, orangeRadius = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > 12) { orangePixels++; orangeRadius = Math.max(orangeRadius, pixels[i] / 255 * 6 * api.water.ballRadius); } const distanceMask = saveMasks ? png() : null;
      top.visible = false; floor.visible = true; camera.layers.set(2); floor.material.uniforms.uShadowDebug.value = true; render(); const shadowMask = saveMasks ? png() : null;
      const anchor = api.water.sample, onAnchor = Math.hypot(ball.position.x - anchor.x, ball.position.z - anchor.z) < 1e-5;
      const localWater = onAnchor ? undefined : await api.surface.samplePoint(ball.position.x, ball.position.z, true), waterHeight = onAnchor ? anchor.y : localWater.valid ? localWater.position.y : null;
      const state = window.__evidence(), radius = api.water.ballRadius;
      return { ...state, frameTimes: undefined, gpu: undefined,
        bounds: { left: x0 / width, right: (x1 + 1) / width, top: y0 / height, bottom: (y1 + 1) / height, width: (x1 + 1 - x0) / width, height: (y1 + 1 - y0) / height, heightOverWidth: (y1 + 1 - y0) / (x1 + 1 - x0), clipped: x0 === 0 || y0 === 0 || x1 === width - 1 || y1 === height - 1 },
        ballBounds: { left: bx0, right: bx1 + 1, top: by0, bottom: by1 + 1, diameterPixels: Math.max(bx1 + 1 - bx0, by1 + 1 - by0) },
        fullDiskPixels, visibleDiskPixels, ballVisibleFraction: visibleDiskPixels / fullDiskPixels, ballDiameterOverWaterWidth: Math.max(bx1 + 1 - bx0, by1 + 1 - by0) / (x1 + 1 - x0),
        ballImmersionDiameterFraction: waterHeight === null ? null : (waterHeight + radius - ball.position.y) / (2 * radius),
        waterPixels, aeratedPixels, aerationCoverage: aeratedPixels / waterPixels, meanAeration: maskSum / waterPixels,
        coverageMeaning: 'Screen fragments with shader foam coverage >=90/255 divided by visible top-water fragments; NOT physical area or reference GIF colour mask.',
        glintPixels, glintThreshold: 'GGX key-light radiance >=0.5 before output, not compressed-GIF white pixels', orangePixels, orangeRadiusWorld: orangeRadius, orangeRadiusDiameters: orangeRadius / (2 * radius),
        waterMask, shadowMask, ballMask, distanceMask };
    } finally { objects.forEach((o, i) => { o.material = materials[i]; o.visible = visibility[i]; }); points.forEach((o, i) => { o.visible = pointVisibility[i]; }); top.material.uniforms.uDebug.value = debug; floor.material.uniforms.uShadowDebug.value = shadowDebug; camera.layers.mask = layer; renderer.setRenderTarget(previous); renderer.setClearColor(clear, alpha); }
  }, saveMasks);
}

export async function measureVariance(page) {
  return page.evaluate(async () => {
    const { computeMaterial, floatTarget } = await import('/src/water/gpu-fft.ts'), { water, renderer } = window.__ocean;
    const target = floatTarget(256), pixels = new Float32Array(256 * 256 * 4), previous = renderer.getRenderTarget();
    const shader = computeMaterial('uniform sampler2D uD0,uD1,uFinal;uniform vec3 uLengths;uniform float uSize;in vec2 vUv;out vec4 col;void main(){vec2 p=(vUv-.5)*uSize;float a=texture(uD0,p/uLengths.x+.5).y,b=texture(uD1,p/uLengths.y+.5).y;col=vec4(a,b,texture(uFinal,vUv).y-a-b,1.);}', { uD0: { value: water.cascades[0].maps.textures[0] }, uD1: { value: water.cascades[1].maps.textures[0] }, uFinal: { value: water.geometry.texture }, uLengths: { value: water.geometryMaterial.uniforms.uLengths.value }, uSize: { value: water.parameters.sheetSizeMetres } });
    try { water.pass.draw(shader, target); renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels); const means = [0, 0, 0], sums = [0, 0, 0]; let count = 0;
      for (let i = 0; i < pixels.length; i += 4) { count++; for (let band = 0; band < 3; band++) { const delta = pixels[i + band] - means[band]; means[band] += delta / count; sums[band] += delta * (pixels[i + band] - means[band]); } }
      const variance = sums.map(s => s / count), total = variance.reduce((a, b) => a + b, 0);
      return { bands: ['C0 linear gained height', 'C1 linear gained height', 'quadratic crest + foam relief + heightfield'], count, means, variance, percent: variance.map(v => v / total * 100), method: '256² uniform material-window samples in physical metres. Independent variances / sum; excludes covariance, rigid tumble and shading-only C2 slopes.' };
    } finally { renderer.setRenderTarget(previous); target.dispose(); shader.dispose(); }
  });
}
