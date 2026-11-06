import { DoubleSide, Matrix3, Matrix4, ShaderMaterial, Vector2, Vector3 } from 'three';
import { FOAM_BILLOW_GLSL, STUDIO_GLSL } from './lighting';
import { LOOP, wrapTime } from './time';
import { STORM_VIEW } from './view';
import { PHILLIPS_WIND_ANGLE } from './spectrum';
import type { PhysicalOcean } from './ocean';
export const PHYSICAL_VERTEX = `uniform sampler2D uGeometry,uCarrierBase,uDz;uniform float uSize;uniform bool uCarrier;varying vec3 vWorld;varying vec2 vBase;varying float vHeight;void main(){vBase=position.xz;vec2 uv=vBase/10.+.5;vec3 d=texture2D(uGeometry,uv).xyz;if(uCarrier){d=texture2D(uCarrierBase,uv).xyz;d.y=texture2D(uDz,uv).w;}vHeight=d.y;vec3 p=position+d*(10./uSize);vec4 world=modelMatrix*vec4(p,1.);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`;
// Linear-HDR aeration midtone calibrated for #5f97a6 between #355f69 and #a9c9d0.
export function updateAeratedMidColor(material: ShaderMaterial): void {
  const u = material.uniforms, shadow: Vector3 = u.uMoundShadow.value, top: Vector3 = u.uMoundTop.value;
  u.uMoundMid.value.set(
    shadow.x * .78 + top.x * .22,
    shadow.y * .585 + top.y * .415,
    shadow.z * .508 + top.z * .492,
  );
}
export function physicalMaterial(ocean: PhysicalOcean): ShaderMaterial {
  const material = new ShaderMaterial({ side: DoubleSide, toneMapped: false, uniforms: {
    uGeometry: { value: ocean.geometry.texture }, uDx: { value: ocean.geometry.textures[1] }, uDz: { value: ocean.geometry.textures[2] }, uFoam: { value: ocean.history }, uFrozenFoam: { value: ocean.frozenFoam.texture },
    uCarrierBase: { value: ocean.baseGeometry.texture },
    uFoamPatches: { value: ocean.foamPatches },
    uWindDirection: { value: new Vector2() },
    uBallState: { value: ocean.ballState.textures[0] },
    uGrad0: { value: ocean.cascades[0].maps.textures[1] }, uGrad1: { value: ocean.cascades[1].maps.textures[1] }, uGrad2: { value: ocean.cascades[2].maps.textures[1] },
    uLengths: { value: new Vector3().fromArray(ocean.parameters.cascadeLengths) },
    uSize: { value: ocean.parameters.sheetSizeMetres }, uHs: { value: 1 }, uFrame: { value: 0 }, uTime: { value: 0 }, uFrozen: { value: true }, uSmallRipples: { value: 1 }, uStorm: { value: 1 },
    uCarrier: { value: false },
    uBall: { value: new Vector3() }, uBallOffset: { value: new Vector3() }, uImmersionOffset: { value: ocean.ballRadius * (1 - 2 * STORM_VIEW.immersion) },
    uUseGpuBall: { value: true }, uSheetMatrix: { value: new Matrix4() },
    uRadius: { value: ocean.ballRadius }, uSheet: { value: new Matrix3() }, uLip: { value: false }, uDiagnostic: { value: false }, uDebug: { value: 0 }, uGlow: { value: 1 },
    uDeep: { value: new Vector3(.0385, .06, .0605) }, uScatter: { value: new Vector3(.032, .125, .119) }, uBubble: { value: new Vector3(.042, .115, .118) },
    uMoundShadow: { value: new Vector3(.076, .158, .185) }, uMoundMid: { value: new Vector3() }, uMoundTop: { value: new Vector3(.45, .62, .67) }, uEnvironmentTint: { value: new Vector3(1, 1, 1) }, uReflectionRadiance: { value: new Vector3(18, 5.6, .55) },
  }, vertexShader: PHYSICAL_VERTEX,
    fragmentShader: `precision highp float;precision highp sampler2DArray;uniform sampler2D uGeometry,uDx,uDz,uFoam,uGrad0,uGrad1,uGrad2,uBallState;uniform sampler2DArray uFrozenFoam;
      uniform float uSize,uHs,uFrame,uTime,uRadius,uGlow,uDebug,uSmallRipples,uStorm,uImmersionOffset;uniform vec2 uWindDirection;uniform bool uFrozen,uLip,uDiagnostic,uUseGpuBall;uniform mat3 uSheet;uniform mat4 uSheetMatrix;uniform vec3 uBall,uBallOffset,uDeep,uScatter,uBubble,uLengths,uMoundShadow,uMoundMid,uMoundTop,uEnvironmentTint,uReflectionRadiance;varying vec3 vWorld;varying vec2 vBase;varying float vHeight;
      ${STUDIO_GLSL}
      vec3 compactSky(vec3 R,float rough){
        float ry=max(R.y,0.);
        vec3 bounce=linearRGB(vec3(138.,90.,80.)/255.);
        vec3 warmGrey=linearRGB(vec3(111.,102.,96.)/255.);
        vec3 zenith=linearRGB(vec3(58.,56.,54.)/255.);
        vec3 horizonBand=mix(warmGrey*.45,bounce*.3,.18*exp(-ry*9.));
        vec3 sky=mix(horizonBand,zenith,smoothstep(.12,.85,ry));
        sky+=vec3(.72,.76,.73)*(.75+.25*ry);
        float az=atan(R.x,R.z),el=asin(clamp(ry,0.,1.));
        float keyAz=-2.35619449,angle=atan(sin(az-keyAz),cos(az-keyAz));
        vec3 softKeyColor=linearRGB(vec3(255.,241.,220.)/255.);
        float blur=rough*.12;
        float softbox=(1.-smoothstep(.6+blur,.8+blur,abs(angle)))*(1.-smoothstep(.08+blur,.18+blur,abs(el-.881)));
        vec3 stripColor=linearRGB(vec3(226.,238.,245.)/255.);
        float strip1=(1.-smoothstep(.012+blur,.025+blur,abs(el-.3)))*(1.-smoothstep(.8,1.05,abs(angle+.65)));
        float opposite=atan(sin(angle-PI),cos(angle-PI));
        float strip2=(1.-smoothstep(.009+blur,.019+blur,abs(el-.58)))*(1.-smoothstep(.65,.9,abs(opposite)));
        return sky+softKeyColor*softbox*1.+stripColor*(strip1*.22+strip2*.12);
      }
      float waterHorizon(vec2 uv,vec3 localLight){float occlusion=0.;vec2 direction=normalize(localLight.xz);float centre=texture2D(uGeometry,uv).y;for(int i=1;i<=4;i++){float distance=float(i)*uSize*.025;vec2 q=uv+direction*distance/uSize;float rise=texture2D(uGeometry,q).y-centre;occlusion=max(occlusion,rise-distance*localLight.y/max(length(localLight.xz),.1));}return exp(-max(0.,occlusion)*.8);}
      ${FOAM_BILLOW_GLSL}
      void main(){vec2 metres=vBase*(uSize/10.),uv=vBase/10.+.5;vec3 V=normalize(cameraPosition-vWorld);
        if(uLip){
          if(uDiagnostic){gl_FragColor=vec4(0.,0.,0.,1.);return;}
          vec3 wall=normalize(cross(dFdx(vWorld),dFdy(vWorld)));if(dot(wall,V)<0.)wall=-wall;
          float fw=dielectric(max(dot(wall,V),0.));vec3 sw=compactSky(reflect(-V,wall),.12);
          vec3 wallColor=uDeep*.45*(1.-fw)+fw*sw*uEnvironmentTint;
          if(uDebug==1.)wallColor=wall*.5+.5;if(uDebug==5.)wallColor=gl_FrontFacing?vec3(0.,.4,0.):vec3(1.,0.,0.);
          gl_FragColor=vec4(wallColor,1.);return;
        }
        vec3 ballWorld=uUseGpuBall?(uSheetMatrix*vec4(texture2D(uBallState,vec2(.5)).xyz+vec3(0.,uImmersionOffset,0.)+uBallOffset,1.)).xyz:uBall;
        vec2 uv2=metres/uLengths.z+.5;
        float footprint=max(length(dFdx(uv2)*64.),length(dFdy(uv2)*64.));
        vec4 filteredDetail=texture2D(uGrad2,uv2);
        vec4 g0=vec4(0.),g1=vec4(0.),g2=filteredDetail;
        if(uDebug==8.)g0=texture2D(uGrad0,metres/uLengths.x+.5);if(uDebug==9.)g1=texture2D(uGrad1,metres/uLengths.y+.5);
        vec3 tx=texture2D(uDx,uv).xyz,tz=texture2D(uDz,uv).xyz,baseNormal=normalize(uSheet*cross(tz,tx));if(!gl_FrontFacing)baseNormal=-baseNormal;
        vec2 detailSlope=g2.xy;
        tx.y+=detailSlope.x*uSmallRipples;tz.y+=detailSlope.y*uSmallRipples;vec3 N=normalize(uSheet*normalize(cross(tz,tx)));if(!gl_FrontFacing)N=-N;
        float facing=dot(N,V);if(facing<.025)N=normalize(N+V*(.025-facing));vec3 R=reflect(-V,N);R=normalize(vec3(R.x,max(R.y,0.),R.z));
        // LEAN/Toksvig takes ONLY the sub-pixel part of the slope variance beyond what the current mip resolves.
        float unres2=max(0.,g2.z-dot(g2.xy,g2.xy));
        vec3 area=cross(tz,tx),localN=normalize(area),csx=vec3(-tz.z,0.,tz.x),csz=vec3(tx.z,0.,-tx.x);
        float sensitivity=max(0.,dot(csx,csx)+dot(csz,csz)-pow(dot(localN,csx),2.)-pow(dot(localN,csz),2.))/(2.*max(dot(area,area),1e-6));
        float variance=sensitivity*uSmallRipples*uSmallRipples*unres2;
        float rough=clamp(pow(pow(.1,4.)+variance,.25),.1,.24);
        vec4 film=texture2D(uFoam,uv);if(uFrozen){float a=mod(floor(uFrame),121.),b=mod(a+1.,121.);film=mix(texture(uFrozenFoam,vec3(uv,a)),texture(uFrozenFoam,vec3(uv,b)),fract(uFrame));}vec2 history=film.rg;
        history*=uStorm*uStorm;
        float mass=clamp(history.r,0.,1.),caps=smoothstep(.25,.8,history.g)*.65,coverage=1.-(1.-mass)*(1.-caps);
        if(uDiagnostic){gl_FragColor=vec4(1.,coverage,clamp(1.-abs(dot(N,uSheet*vec3(0.,1.,0.))),0.,1.),1.);return;}
        // Feathered foam edge with noise erosion and dither; never a crisp boundary or translucent cyan cover.
        vec2 qScene=vBase;
        float billowVal=.5;if(mass>.15||caps>.3)billowVal=foamBillow(qScene);
        float edgeNoise=(cloud(qScene*5.5+vec2(3.1,8.7))-.5)*.28+(cloud(qScene*14.+vec2(9.4,1.9))-.5)*.16;
        float dither=(labHash(floor(gl_FragCoord.xy)+vec2(floor(uFrame)*13.,floor(uFrame)*29.))-.5)*.10;
        float rawFoam=max(mass*(.85+.3*clamp(film.b/max(film.r,.01),0.,1.)),caps*.75);
        float foamMask=smoothstep(.22,.64,rawFoam+edgeNoise+dither)*clamp(rawFoam*1.45,0.,1.);
        foamMask*=mix(.18,1.,smoothstep(.35,.7,caps));
        vec2 flow=vec2(dot(qScene,uWindDirection),dot(qScene,vec2(uWindDirection.y,-uWindDirection.x)));
        float streak=pow(cloud(flow*vec2(1.5,24.)+vec2(7.1,4.3)),5.);
        foamMask=max(foamMask,.58*smoothstep(.1,.35,mass)*(1.-smoothstep(.5,.75,mass))*streak);
        float F=dielectric(max(dot(N,V),0.));vec3 sky=compactSky(R,rough)*uEnvironmentTint;
        vec3 L=normalize(vec3(-.7,1.2,-.7)),sunColor=linearRGB(vec3(255.,242.,216.)/255.);
        float H=max(vHeight,0.)/max(uHs,.1),nv=max(dot(N,V),0.);
        vec3 localLight=normalize(vec3(dot(uSheet[0],L),dot(uSheet[1],L),dot(uSheet[2],L)));float visibility=waterHorizon(uv,localLight);
        vec2 near=vec2(.55/uSize,0.);float surrounding=(texture2D(uGeometry,uv+near).y+texture2D(uGeometry,uv-near).y+texture2D(uGeometry,uv+near.yx).y+texture2D(uGeometry,uv-near.yx).y)*.25;
        float cavity=exp(-max(0.,surrounding-vHeight)*.22);
        // Slopes get light only from Fresnel*env, Atlas crest scatter on thin backlit crest tips, recent-foam bubbles, and the ball point light.
        float thinTip=smoothstep(.22,.72,H)*smoothstep(-.015,.085,vHeight-surrounding);
        float backlit=pow(max(dot(L,-V),0.),3.)*pow(.5-.5*dot(L,N),2.);
        vec3 crestScatter=uScatter*thinTip*(.35+1.15*backlit);
        vec3 bubbleScatter=uBubble*smoothstep(.08,.45,mass)*(1.-foamMask)*.38;
        // Ball point light on the water's diffuse/scatter term (1/d² falloff within ~1.5 diameters).
        vec3 delta=ballWorld-vWorld;
        float distDiam=length(delta)/max(2.*uRadius,1e-4);
        vec3 Lb=delta/max(length(delta),1e-4);
        float ballWrap=clamp((dot(N,Lb)+.35)/1.35,0.,1.);
        float ballFalloff=(1./(1.+4.8*distDiam*distDiam))*(1.-smoothstep(1.15,1.55,distDiam))*smoothstep(.36,.62,distDiam);
        vec3 ballLight=vec3(.12,.008,.001)*uGlow*ballWrap*ballFalloff;
        vec3 body=uDeep+crestScatter+bubbleScatter+ballLight;
        // Small sun disc (0.5-0.8 deg) + GGX key energy >= 0.55 breaking into pinpoint glints on the fine ripples.
        float cosSun=dot(R,L);
        float sunDisc=smoothstep(.99997563,.99999048,cosSun)*12.;
        float glitter=(ggx(N,V,L,rough)*1.8+sunDisc)*step(0.,dot(N,L));
        glitter=glitter/(1.+glitter/12.);
        vec3 sun=sunColor*glitter*visibility;
        // Broken horizontal reflection bars stepping down the camera-side trough (1.0-2.8 diameters for farthest 10%, >=80% camera-side, no glued skirt).
        vec3 forward=normalize(vec3(cameraPosition.x-ballWorld.x,0.,cameraPosition.z-ballWorld.z)),across=vec3(forward.z,0.,-forward.x),offset=vWorld-ballWorld;
        float along=dot(offset,forward),lateral=abs(dot(offset,across));
        float alongD=along/(2.*uRadius),latD=lateral/(2.*uRadius),radD=length(offset.xz)/(2.*uRadius);
        // Exclude the glued contact skirt (alongD < 0.42) and extend down the camera-side trough to ~2.5 diameters.
        float troughWindow=smoothstep(.42,.66,alongD)*(1.-smoothstep(2.05,2.65,alongD));
        float widthLimit=mix(.36,.68,clamp((alongD-.4)/2.0,0.,1.));
        float latWindow=1.-smoothstep(widthLimit*.7,widthLimit,latD);
        // Project reflected ray onto the vertical plane through the ball, stretched vertically by trough curvature and sliced into horizontal bars by the transverse ripples.
        float rayDistance=max(.1,dot(delta,R));
        vec3 toBallDir=normalize(delta);
        float azErr=abs(dot(R-toBallDir,across));
        float elDiff=R.y-toBallDir.y;
        float coneHit=exp(-(azErr*azErr)/(.038+.12*rough))*exp(-(elDiff*elDiff)/(.14+.25*rough));
        float ripplePitch=dot(detailSlope,forward.xz);
        float horizontalBars=smoothstep(-.02,.12,ripplePitch)*smoothstep(-.5,.05,R.y);
        float hit=troughWindow*latWindow*coneHit*horizontalBars;
        vec3 orange=uReflectionRadiance*hit*F*uGlow*(1.-.45*smoothstep(.4,2.4,alongD));
        // Shade whitewater as a diffuse scattering medium: key wrap + blue ambient + crevice darkening, no plastic sheen.
        float keyWrap=clamp((dot(baseNormal,L)+.45)/1.45,0.,1.);
        float skyAmb=.45+.55*clamp(baseNormal.y,0.,1.);
        float foldCrest=smoothstep(-.04,.07,vHeight-surrounding);
        float crevice=clamp(.52*billowVal+.48*foldCrest,0.,1.)*cavity;
        float foamLight=clamp(.2+.32*keyWrap*skyAmb+.55*pow(billowVal,2.8)*cavity,0.,1.);
        vec3 foam=mix(mix(uMoundShadow,uMoundMid,smoothstep(.0,.52,foamLight)),uMoundTop,smoothstep(.48,.96,foamLight));
        foam*=vec3(.95,1.03,1.06)*(.84+.3*cloud(qScene*48.));
        vec3 waterCol=(1.-F)*body+F*sky+sun+orange;
        vec3 foamShaded=foam+orange*.18+ballLight*.35;
        vec3 col=mix(waterCol,foamShaded,foamMask);
        if(uDebug==1.)col=N*.5+.5;
        if(uDebug==2.)col=vec3(clamp(.5+vHeight/uSize*3.,0.,1.));
        if(uDebug==3.)col=vec3(clamp(1.-texture2D(uDx,uv).a,0.,1.),coverage,clamp(texture2D(uGeometry,uv).a,0.,1.));
        if(uDebug==4.)col=vec3(mass);if(uDebug==5.)col=gl_FrontFacing?vec3(0.,.4,0.):vec3(1.,0.,0.);
        if(uDebug==7.)col=orange+ballLight;if(uDebug==8.)col=vec3(g0.xy*.3+.5,.5);if(uDebug==9.)col=vec3(g1.xy*.3+.5,.5);if(uDebug==10.)col=vec3(g2.xy*.3+.5,.5);
        if(uDebug==11.)col=F*sky;if(uDebug==12.)col=(1.-F)*body;if(uDebug==13.)col=sun;
        if(uDebug==100.)col=vec3(1.,coverage,clamp(glitter,0.,1.));if(uDebug==101.)col=vec3(length(delta)/(6.*uRadius),clamp(orange.r,0.,1.),0.);
        gl_FragColor=vec4(col,1.);
      }`,
  });
  updateAeratedMidColor(material);
  return material;
}
export function bindPhysicalMaterial(material: ShaderMaterial, ocean: PhysicalOcean): void {
  const u = material.uniforms, c = ocean.cascades;
  u.uFoam.value = ocean.history; u.uGrad0.value = c[0].maps.textures[1]; u.uGrad1.value = c[1].maps.textures[1]; u.uGrad2.value = c[2].maps.textures[1];
  u.uBallState.value = ocean.ballState.textures[0];
  u.uSize.value = ocean.parameters.sheetSizeMetres; u.uLengths.value.fromArray(ocean.parameters.cascadeLengths); u.uFrozen.value = ocean.frozen; u.uFrame.value = wrapTime(ocean.time) / LOOP * 121; u.uTime.value = wrapTime(ocean.time); u.uHs.value = ocean.heroHs;
  u.uStorm.value = ocean.storm;
  const windAngle = ocean.parameters.model === 'phillips' ? PHILLIPS_WIND_ANGLE : Math.PI / 4;
  u.uWindDirection.value.set(Math.cos(windAngle), Math.sin(windAngle));
  u.uRadius.value = ocean.ballRadius;
  u.uImmersionOffset.value = ocean.ballRadius * (1 - 2 * STORM_VIEW.immersion);
}
