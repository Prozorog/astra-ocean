import { Matrix4, ShaderMaterial, Vector3, Vector4 } from 'three';
import { STORM_VIEW } from './water/view';

export const KEY = new Vector3(-.7, 1.2, -.7).normalize();
export const DEBUG_VIEWS = ['Beauty', 'Normals', 'Height', 'Jacobian / foam', 'Aeration mask', 'Back-face (red)', 'Shadow mask', 'Ball-light only',
  'C0 only', 'C1 only', 'C2 only', 'Reflection only', 'Scatter only', 'Sun spec only'] as const;
export function ballMaterial(radius: number = STORM_VIEW.ballRadius, immersion: number = STORM_VIEW.immersion) {
  return new ShaderMaterial({
    toneMapped: false,
    uniforms: {
      uGlow: { value: 1 },
      uBody: { value: new Vector3(1.56, 0.41, 0.041) },
      uHot: { value: new Vector3(1.88, 0.67, 0.125) },
      uRim: { value: new Vector3(1.12, 0.115, 0.043) },
      uFringe: { value: new Vector3(1.75, 0.24, 0.045) },
      uWaterPlane: { value: new Vector4(0, 1, 0, -4) },
      uBallState: { value: null },
      uBallNormal: { value: null },
      uSheetMatrix: { value: new Matrix4() },
      uBallOffset: { value: new Vector3() },
      uImmersionOffset: { value: radius * (1 - 2 * immersion) },
      uBallRadius: { value: radius },
      uUseGpuBall: { value: false },
      uDiagnostic: { value: false },
    },
    vertexShader: /* glsl */`
      uniform sampler2D uBallState, uBallNormal;
      uniform mat4 uSheetMatrix;
      uniform vec3 uBallOffset;
      uniform float uImmersionOffset, uBallRadius;
      uniform bool uUseGpuBall;
      uniform vec4 uWaterPlane;
      varying vec3 vN, vP;
      varying vec4 vWaterPlane;
      void main() {
        vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
        vN = worldNormal;
        if (uUseGpuBall) {
          vec3 anchor = texture2D(uBallState, vec2(0.5)).xyz;
          vec3 carrierN = normalize(mat3(uSheetMatrix) * texture2D(uBallNormal, vec2(0.5)).xyz);
          vec3 contactWorld = (uSheetMatrix * vec4(anchor, 1.0)).xyz;
          vWaterPlane = vec4(carrierN, -dot(carrierN, contactWorld));
          vec3 centerLocal = anchor + vec3(0.0, uImmersionOffset, 0.0) + uBallOffset;
          vec3 centerWorld = (uSheetMatrix * vec4(centerLocal, 1.0)).xyz;
          vP = centerWorld + worldNormal * uBallRadius;
          gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
        } else {
          vec4 p = modelMatrix * vec4(position, 1.0);
          vP = p.xyz;
          vWaterPlane = uWaterPlane;
          gl_Position = projectionMatrix * viewMatrix * p;
        }
      }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec3 vN, vP; varying vec4 vWaterPlane;
      uniform float uGlow; uniform bool uDiagnostic;
      uniform vec3 uBody, uHot, uRim, uFringe;
      void main() {
        if (uDiagnostic) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 N = normalize(vN);
        vec2 disk = (viewMatrix * vec4(N, 0.0)).xy;
        float radial = clamp(length(disk), 0.0, 1.0);
        float centerMix = 1.0 - smoothstep(0.0, 0.85, radial);
        float rimMix = smoothstep(0.76, 1.0, radial);
        vec3 core = mix(uBody, uHot, centerMix * 0.85);
        vec3 col = mix(core, uRim, rimMix);
        float contact = 1.0 - smoothstep(0.006, 0.04, abs(dot(vec4(vP, 1.0), vWaterPlane)));
        gl_FragColor = vec4(mix(col, uFringe, contact * 0.55) * uGlow, 1.0);
      }`,
  });
}
export const shadowProjection = new Matrix4();
