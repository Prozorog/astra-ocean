import { BufferGeometry, Float32BufferAttribute, PlaneGeometry } from 'three';
export function sheetGeometry(segments = 384): PlaneGeometry { return new PlaneGeometry(10, 10, segments, segments).rotateX(-Math.PI / 2); }
export function lipGeometry(segments = 256): BufferGeometry {
  const positions: number[] = [], indices: number[] = [], perimeter: [number, number][] = [];
  for (let edge = 0; edge < 4; edge++) for (let i = 0; i < segments; i++) { const v = -5 + 10 * i / segments; perimeter.push(edge === 0 ? [v, -5] : edge === 1 ? [5, v] : edge === 2 ? [-v, 5] : [-5, -v]); }
  perimeter.push(perimeter[0]); for (const [x, z] of perimeter) positions.push(x, 0, z, x, -.035, z);
  for (let i = 0; i < perimeter.length - 1; i++) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); return geometry;
}
