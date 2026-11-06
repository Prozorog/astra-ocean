// Water Lab adaptation: analytic studio sky, replacing upstream panorama I/O.
import { vec3, float, mix, max, min, pow, normalize, dot, atan, sin, cos, asin, abs, smoothstep, fwidth } from 'three/tsl';
export function skyColor(direction, shading) {
  const R = normalize(direction).toVar();
  const zenith = vec3(shading.zenith), horizon = vec3(shading.horizon);
  const sky = mix(horizon, zenith, pow(max(R.y, float(0)), float(.65))).toVar();
  const az = atan(R.x, R.z), el = asin(R.y.clamp(-1, 1));
  const angle = atan(sin(az.sub(Math.atan2(-.75, .60))), cos(az.sub(Math.atan2(-.75, .60))));
  const aa = max(fwidth(el), float(.002));
  const strip = float(1).sub(smoothstep(aa.add(.035), aa.add(.055), abs(el.sub(.4363323))))
    .mul(float(1).sub(smoothstep(float(.55), float(.65), abs(angle))));
  const opposite = atan(sin(angle.sub(Math.PI)), cos(angle.sub(Math.PI)));
  const second = float(1).sub(smoothstep(aa.add(.026), aa.add(.042), abs(el.sub(.1745329))))
    .mul(float(1).sub(smoothstep(float(.8), float(.91), abs(opposite))));
  sky.addAssign(vec3(.89, .95, 1).mul(strip.mul(2.6).add(second.mul(.7))));
  const sun = float(1).sub(smoothstep(float(.00008), float(.00012), float(1).sub(dot(R, shading.sunDir))));
  sky.addAssign(vec3(.79, .90, 1).mul(sun.mul(18)));
  sky.mulAssign(mix(float(.55), float(1), smoothstep(float(0), float(.06), R.y)));
  return mix(vec3(.006512, .016807, .019382), sky, smoothstep(float(-.001), float(0), R.y));
}
