// Lab-only presentation. No dependency on the main page's water/bake.
export const POST_VERTEX = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
export const POST_FRAGMENT = /* glsl */`
precision highp float;uniform sampler2D uSource;uniform float uTime;uniform vec2 uResolution;uniform bool uDiagnostic;varying vec2 vUv;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec3 neutral(vec3 c){float minimum=min(c.r,min(c.g,c.b));float offset=minimum<.08?minimum-6.25*minimum*minimum:.04;c=max(c-offset,0.);float peak=max(c.r,max(c.g,c.b));float mapped=peak<.76?peak:1.-.0576/(peak-.52);return c*(mapped/max(peak,1e-8));}
vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,0.),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
void main(){vec3 c=texture2D(uSource,vUv).rgb;if(uDiagnostic){gl_FragColor=vec4(c,1.);return;}vec2 q=(vUv-.5)*2.;float vig=smoothstep(.35,1.6,length(q))*.85;
  float warm=smoothstep(1.6,2.7,c.r/max(c.g,.0001))*smoothstep(.14,.21,c.b/max(c.r,.0001));c=mix(c,mix(c*.72,vec3(.48,.14,.13),warm),vig);
  float lum=dot(c,vec3(.2126,.7152,.0722));c=srgb(neutral(c));float frame=floor(mod(uTime,3.63)/3.63*4096.);float n=hash(floor(vUv*uResolution/1.5)+vec2(frame*19.,frame*37.))-.5;c*=1.+n*.09*(1.-smoothstep(.6,1.,lum));gl_FragColor=vec4(c,1.);}
`;
export const EMBER_VERTEX='varying vec3 vNormal,vWorld;void main(){vNormal=normalize(mat3(modelMatrix)*normal);vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}';
export const EMBER_FRAGMENT=/* glsl */`precision highp float;uniform bool uDiagnostic;varying vec3 vNormal,vWorld;void main(){if(uDiagnostic){gl_FragColor=vec4(0.,0.,0.,1.);return;}vec3 V=normalize(cameraPosition-vWorld),up=vec3(0,1,0),right=normalize(cross(up,V)),vertical=cross(V,right);vec2 p=vec2(dot(vNormal,right),dot(vNormal,vertical));float r=length(p);float hot=exp(-dot(p-vec2(-.12,.12),p-vec2(-.12,.12))/.03);vec3 body=mix(vec3(6.95,1.8,.045),vec3(8.,4.8,.7),hot);body=mix(body,vec3(.85,.112,.041),smoothstep(.91,1.,r));gl_FragColor=vec4(body,1.);}`;
