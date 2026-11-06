import { yieldFrame } from './scheduling.js';
const root = '/output/cache/ultra-water';
let manifest;
export async function cacheKey(simulation) {
  const s = simulation.sim;
  const source = JSON.stringify([s.initMat.fragmentShader, s.evolveMat.fragmentShader, s.assembleMat.fragmentShader,
    s.params, s.initMat.uniforms.uSeed.value, simulation.lengths]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function inflate(address, expected) {
  const response = await fetch(address);
  if (!response.ok || !response.body) throw Error('Ocean cache unavailable');
  // Vite serves .gz with Content-Encoding; fetch has already decoded that body.
  // Static hosts without that header use the same native streaming decoder here.
  const bytes = response.headers.get('content-encoding')?.includes('gzip')
    ? await response.arrayBuffer()
    : await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if (bytes.byteLength !== expected) throw Error('Ocean cache size mismatch');
  return new Uint16Array(bytes);
}
async function upload(renderer, target, data, progress, background) {
  const gl = renderer.getContext(), stride = target.width * target.height * 4;
  renderer.initRenderTarget(target);
  let budget = performance.now();
  for (let layer = 0; layer < target.depth; layer += 8) {
    const layers = Math.min(8, target.depth - layer);
    // Preserve every RGBA16F bit. Bounded subimage uploads avoid a large
    // single transfer and leave time for the loader (or the live Main view).
    renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, renderer.properties.get(target.texture).__webglTexture);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, target.width, target.height, layers,
      gl.RGBA, gl.HALF_FLOAT, data.subarray(layer * stride, (layer + layers) * stride));
    progress((layer + layers) / target.depth);
    if (background || performance.now() - budget >= 8) { await yieldFrame(); budget = performance.now(); }
  }
  renderer.setRenderTarget(null);
}
export async function loadPeriodicCache(simulation, progress, background) {
  if (simulation.sim.evolveMat.uniforms.uSpectrumBlend.value !== 0) return false;
  try {
    manifest ??= fetch(`${root}/manifest.json`).then(r => r.ok ? r.json() : {});
    const key = await cacheKey(simulation), records = await manifest, record = records[key];
    simulation.cacheLookup = { key, available: Object.keys(records).length, found: !!record };
    if (!record) return false;
    const foam = await inflate(`${root}/${key}/foam.gz`, 256 * 256 * 121 * 8);
    await upload(simulation.renderer, simulation.history, foam, n => progress(n * .9), background);
    const spray = await inflate(`${root}/${key}/spray.gz`, 32 * 32 * 121 * 8);
    await upload(simulation.renderer, simulation.sprayHistory, spray, n => progress(.9 + n * .1), background);
    simulation.brewing = { ...record.brewing, loadedExactCache: true, key, warmStepsThisLoad: 0 };
    return true;
  } catch (error) { simulation.cacheLoadError = String(error); return false; } // GUI/custom spectra use the same recurrence.
}
