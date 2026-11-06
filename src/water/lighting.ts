// Rounded aerated puffs, shared by foam geometry and its diffuse shading.
export const FOAM_BILLOW_GLSL = `
float foamHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float foamBillow(vec2 q){
  vec2 p=q/.42,cell=floor(p),f=fract(p);float nearest=10.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 offset=vec2(float(x),float(y)),id=cell+offset;
    vec2 centre=.2+.6*vec2(foamHash(id+13.7),foamHash(id+57.1));
    vec2 d=f-offset-centre;nearest=min(nearest,dot(d,d));
  }
  float puffs=exp(-nearest*5.5);
  return .76*puffs+.16*cloud(q*4.1+vec2(2.7,8.1))+.08*cloud(q*7.2+vec2(6.3,1.9));
}
`;
// Shared analytic studio optics; unchanged for the S comparison variant.
export const STUDIO_GLSL = /* glsl */`
const float PI=3.141592653589793;
vec3 linearRGB(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 studioSky(vec3 ray,float rough){
  vec3 R=normalize(ray);vec3 horizon=linearRGB(vec3(93.,124.,134.)/255.),zenith=linearRGB(vec3(159.,198.,216.)/255.);
  vec3 sky=mix(horizon,zenith,pow(max(R.y,0.),.65));
  float az=atan(R.x,R.z),el=asin(clamp(R.y,-1.,1.));float keyAz=atan(-.75,.60);float angle=atan(sin(az-keyAz),cos(az-keyAz));
  float blur=rough*.35;float strip=(1.-smoothstep(.035+blur,.055+blur,abs(el-.4363323)))*(1.-smoothstep(.55,.65,abs(angle)));
  float second=(1.-smoothstep(.026+blur,.042+blur,abs(el-.1745329)))*(1.-smoothstep(.8,.91,abs(atan(sin(angle-PI),cos(angle-PI)))));
  sky+=vec3(.89,.95,1.)*(strip*2.6+second*.7);
  vec3 sunDir=normalize(vec3(-.75,1.25,.60));float disk=1.-smoothstep(.00008+rough*rough*.1,.00012+rough*rough*.2,1.-dot(R,sunDir));sky+=vec3(.79,.90,1.)*disk*18.;
  sky*=mix(.55,1.,smoothstep(0.,.06,R.y));return R.y<0.?linearRGB(vec3(19.,35.,38.)/255.):sky;
}
float dielectric(float cosine){float c=clamp(cosine,0.,1.),eta=1./1.333,ct=sqrt(max(0.,1.-eta*eta*(1.-c*c)));float rs=(eta*c-ct)/(eta*c+ct),rp=(c-eta*ct)/(c+eta*ct);return .5*(rs*rs+rp*rp);}
float ggx(vec3 N,vec3 V,vec3 L,float rough){vec3 H=normalize(V+L);float nv=max(dot(N,V),.001),nl=max(dot(N,L),.001),nh=max(dot(N,H),0.),vh=max(dot(V,H),0.);float a=rough*rough,a2=a*a,d=nh*nh*(a2-1.)+1.;float D=a2/(PI*d*d);float gv=2.*nv/(nv+sqrt(a2+(1.-a2)*nv*nv)),gl=2.*nl/(nl+sqrt(a2+(1.-a2)*nl*nl));return D*gv*gl*dielectric(vh)/(4.*nv);}
vec3 ballReflection(vec3 world,vec3 R,float rough,vec3 ball,float radius){vec3 to=ball-world;float distance=length(to),along=dot(to,R);float cone=radius+distance*rough;float miss=length(to-R*max(along,0.));float hit=(1.-smoothstep(cone*.75,cone,miss))*step(0.,along);return vec3(hit);}
float labHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float cloud(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(labHash(i),labHash(i+vec2(1,0)),f.x),mix(labHash(i+vec2(0,1)),labHash(i+1.),f.x),f.y);}
`;
