import assert from 'node:assert/strict';

/** Actual two-sided final geometry: folds are legal, unshaded/NaN backs are not. */
export async function verifyBackfaces(page, singleTime = null) {
  return page.evaluate(async singleTime => {
    const THREE = await import('/node_modules/three/build/three.module.js'), api = window.__ocean, { renderer, camera, scene, top, lip, ball, floor } = api;
    const target = new THREE.WebGLRenderTarget(640, 360, { type: THREE.FloatType }), pixels = new Float32Array(640 * 360 * 4), back = new Uint8Array(640 * 360);
    const objects = [top, lip, ball, floor, ...scene.children.filter(o => o.isPoints)], visibility = objects.map(o => o.visible), previous = renderer.getRenderTarget(), clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha(), layer = camera.layers.mask;
    const originalDebug = api.settings.debug, clippedPhases = []; let backfacePixels = 0, invalidBackfacePixels = 0, nonfinite = 0, minimumBackfaceRadiance = Infinity;
    const render = () => { renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 640, 360, pixels); };
    try {
      for (let frame = 0; frame < (singleTime === null ? 121 : 1); frame++) {
        await window.__setTime(singleTime ?? frame * .03); objects.forEach(o => { o.visible = o === top; }); camera.layers.set(0); renderer.setClearColor(0, 0);
        top.material.uniforms.uDebug.value = 5; render(); for (let i = 0; i < back.length; i++) back[i] = pixels[i * 4] > .9 && pixels[i * 4 + 1] < .1 ? 1 : 0;
        top.material.uniforms.uDebug.value = 0; render(); let clipped = false;
        for (let i = 0; i < pixels.length; i += 4) {
          const finite = Number.isFinite(pixels[i]) && Number.isFinite(pixels[i + 1]) && Number.isFinite(pixels[i + 2]); if (!finite) nonfinite++;
          const pixel = i / 4, x = pixel % 640, y = Math.floor(pixel / 640);
          if (pixels[i + 3] > .99 && (x === 0 || x === 639 || y === 0 || y === 359)) clipped = true;
          if (back[i / 4]) { backfacePixels++; const radiance = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]); minimumBackfaceRadiance = Math.min(minimumBackfaceRadiance, radiance); if (!finite || pixels[i + 3] < .99 || radiance < 1e-8) invalidBackfacePixels++; }
        }
        if (clipped) clippedPhases.push(singleTime ?? frame * .03);
      }
    } finally { api.settings.debug = originalDebug; objects.forEach((o, i) => { o.visible = visibility[i]; }); renderer.setRenderTarget(previous); renderer.setClearColor(clear, alpha); camera.layers.mask = layer; target.dispose(); await window.__setTime(0); }
    return { phases: singleTime === null ? 121 : 1, width: 640, height: 360, backfacePixels, invalidBackfacePixels, nonfinite, clippedPhases, minimumBackfaceRadiance: Number.isFinite(minimumBackfaceRadiance) ? minimumBackfaceRadiance : null, actualBeautyGeometryAndDepth: true, criterion: 'Every visible reverse-side fragment is opaque, finite and shaded; all edges fit over the loop. No assertion that choppy surfaces never fold.', passed: invalidBackfacePixels === 0 && nonfinite === 0 && clippedPhases.length === 0 };
  }, singleTime);
}

export async function verifyMath(page) {
  const result = await page.evaluate(async () => {
    const api = window.__ocean, water = api.water, rows = []; let maximumNormalError = 0, maximumInverseError = 0, nonfinite = 0;
    for (const time of [0, .6, 1.2, 2.4]) {
      await window.__setTime(time);
      for (const [x, z] of [[1.2, -1.1], [-1, -2], [2, 1]]) {
        const qx = (Math.floor((x / 10 + .5) * 512) + .5) / 512 * 10 - 5, qz = (Math.floor((z / 10 + .5) * 512) + .5) / 512 * 10 - 5, e = 10 / 512;
        [[qx, qz], [qx + e, qz], [qx - e, qz], [qx, qz + e], [qx, qz - e]].forEach(([a, b], i) => water.setProbe(i + 2, a, b)); await water.readSample(time, true);
        const [c, xp, xm, zp, zm] = water.samples.slice(2, 7).map(s => ({ ...s }));
        const ax = xp.x - xm.x, ay = xp.y - xm.y, az = xp.z - xm.z, bx = zp.x - zm.x, by = zp.y - zm.y, bz = zp.z - zm.z;
        const nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax, length = Math.hypot(nx, ny, nz);
        const normalError = Math.hypot(c.nx - nx / length, c.ny - ny / length, c.nz - nz / length); maximumNormalError = Math.max(maximumNormalError, normalError);
        water.setProbe(7, qx - .04, qz + .025); await water.readSample(time, true); water.setProbe(7, c.x, c.z, true); await water.readSample(time, true); const inverse = water.samples[7];
        const inverseError = Math.hypot(inverse.x - c.x, inverse.y - c.y, inverse.z - c.z); maximumInverseError = Math.max(maximumInverseError, inverseError);
        if (![c.x, c.y, c.z, c.nx, c.ny, c.nz, normalError, inverseError].every(Number.isFinite)) nonfinite++;
        rows.push({ time, qx, qz, normalError, inverseError, valid: c.valid && inverse.valid, phaseExact: c.time === time && inverse.time === time, jacobian: c.jacobian });
      }
    }
    const diagnostics = water.diagnostics(); await window.__setTime(0);
    const T = await import('/node_modules/three/build/three.module.js'), u = api.top.material.uniforms, oldBase = u.uCarrierBase.value, oldZ = u.uDz.value, mirrored=new Float32Array(4*4*4);
    for(let row=0;row<4;row++)for(let column=0;column<4;column++){const at=(row*4+column)*4;mirrored[at+2]=2*(.5-(row+.5)/4)*water.parameters.sheetSizeMetres;mirrored[at+3]=1;}
    const base=new T.DataTexture(mirrored,4,4,T.RGBAFormat,T.FloatType),z=new T.DataTexture(new Float32Array([0,0,0,0]),1,1,T.RGBAFormat,T.FloatType);base.minFilter=base.magFilter=T.LinearFilter;base.needsUpdate=z.needsUpdate=true;
    let axisAlignedDownPickNormal;
    try {
      u.uCarrierBase.value=base;u.uDz.value=z;const screen=new T.Vector3(0,0,0).applyMatrix4(api.sheetRoot.matrixWorld).project(api.camera);
      const hit = await api.surface.pick((screen.x + 1) * innerWidth / 2, (1 - screen.y) * innerHeight / 2); axisAlignedDownPickNormal = hit?.normal.toArray();
    } finally { u.uCarrierBase.value=oldBase;u.uDz.value=oldZ;base.dispose();z.dispose(); }
    return { maximumNormalError, maximumInverseError, axisAlignedDownPickNormal, nonfinite, rows, fft: water.fftResult, cfl: water.interaction.cfl, diagnostics, method: 'Batched load-bearing GPU carrier positions/normals at arbitrary texel-centred parameters; independent central differences and inverse continuation. Decorative relief is excluded. Actual raster-pick round trip also tests the folded -Y axis, where sign(0) must not flip the normal.' };
  });
  assert(result.fft.passed, 'Actual GPU FFT transform validation'); assert.equal(result.nonfinite, 0);
  assert(result.rows.every(r => r.valid && r.phaseExact), 'Frozen queries must resolve the requested phase and branch');
  assert(result.maximumNormalError < .035, 'Carrier normals must match carrier displacement'); assert(result.maximumInverseError < .03, 'Surface inverse must remain on the sampled branch');
  assert(result.axisAlignedDownPickNormal && result.axisAlignedDownPickNormal[1] < -.9999 && Math.hypot(result.axisAlignedDownPickNormal[0], result.axisAlignedDownPickNormal[2]) < .0001, 'GPU pick must retain the negative-Y fold normal, including zero components');
  assert(result.cfl <= Math.SQRT1_2, '2D heightfield CFL'); return { ...result, passed: true };
}
