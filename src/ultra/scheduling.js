// Allow the loader to paint between bounded batches of GPU submissions.
export async function yieldFrame() {
  await new Promise(requestAnimationFrame);
  await new Promise(resolve => setTimeout(resolve, 0));
}
export async function compileMaterials(renderer, materials, mesh, camera) {
  const original = mesh.material;
  const jobs = materials.map(material => {
    mesh.material = material;
    return renderer.compileAsync(mesh, camera);
  });
  mesh.material = original;
  await Promise.all(jobs);
}
