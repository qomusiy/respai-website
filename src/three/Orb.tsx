import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../lib/live'

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`

const orbVertex = /* glsl */ `
uniform float uTime; uniform float uLevel; uniform float uFlash;
varying vec3 vNormal; varying vec3 vPos; varying vec3 vView; varying float vDisp;
${NOISE}
void main(){
  vec3 p = position;
  float breath = 0.5 + 0.5 * sin(uTime * 1.4);
  float n = snoise(normal * 1.5 + vec3(0.0, uTime * 0.22, uTime * 0.13));
  float n2 = snoise(normal * 3.2 - vec3(uTime * 0.4));
  float amp = 0.045 + 0.02 * breath + uLevel * 0.22 + uFlash * 0.18;
  float d = n * amp + n2 * (0.015 + uLevel * 0.08);
  vDisp = d;
  p += normal * d;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vPos = position;
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const orbFragment = /* glsl */ `
uniform float uTime; uniform float uLevel; uniform float uFlash; uniform float uDark;
uniform vec3 cDeep; uniform vec3 cMid; uniform vec3 cHot; uniform vec3 cAlert;
varying vec3 vNormal; varying vec3 vPos; varying vec3 vView; varying float vDisp;
${NOISE}
void main(){
  // domain-warped flowing bands, like breath moving through the sphere
  vec3 q = vPos * 1.2;
  float w = snoise(q + vec3(uTime * 0.15, 0.0, -uTime * 0.1));
  float f = snoise(q * 1.7 + w * 1.4 + vec3(0.0, uTime * 0.25, 0.0));
  float bands = smoothstep(-0.4, 0.9, f);
  vec3 col = mix(cDeep, cMid, bands);
  col = mix(col, cHot, smoothstep(0.55, 1.0, f + uLevel * 0.6) * 0.85);
  // fresnel rim
  float fr = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.4);
  col += cHot * fr * (0.55 + uLevel * 0.9);
  // soft key light from top-left
  float key = max(dot(vNormal, normalize(vec3(-0.4, 0.7, 0.6))), 0.0);
  col += vec3(1.0) * pow(key, 18.0) * 0.35;
  col *= 0.85 + vDisp * 2.0;
  // cough flash → hot orange wash
  col = mix(col, cAlert * 1.2 + fr * 0.6, uFlash * 0.8);
  gl_FragColor = vec4(col, 1.0);
}
`

const particleVertex = /* glsl */ `
uniform float uTime; uniform float uLevel; uniform float uFlash; uniform float uPixelRatio;
attribute float aSeed; attribute float aRadius;
varying float vAlpha;
void main(){
  float a = aSeed * 6.2831 + uTime * (0.08 + aSeed * 0.12);
  float r = aRadius * (1.0 + uLevel * 0.35 + uFlash * 0.5 * (0.5 + aSeed));
  float y = sin(aSeed * 91.7 + uTime * 0.6) * 0.18 * aRadius;
  vec3 p = vec3(cos(a) * r, y, sin(a) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.5 + aSeed * 2.5) * uPixelRatio * (1.0 + uLevel) * (8.0 / -mv.z);
  vAlpha = 0.25 + 0.75 * fract(aSeed * 13.1);
}
`
const particleFragment = /* glsl */ `
uniform vec3 uColor; uniform float uFlash; uniform vec3 cAlert;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(mix(uColor, cAlert, uFlash), a);
}
`

export interface OrbProps {
  /** dark backgrounds get a brighter palette */
  palette?: 'night' | 'day'
  particles?: boolean
  /** extra idle motion when nothing is playing */
  idle?: boolean
}

export function Orb({ palette = 'night', particles = true }: OrbProps) {
  const mesh = useRef<THREE.Mesh>(null)
  const level = useRef(0)
  const flash = useRef(0)

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: orbVertex,
        fragmentShader: orbFragment,
        uniforms: {
          uTime: { value: 0 },
          uLevel: { value: 0 },
          uFlash: { value: 0 },
          uDark: { value: palette === 'night' ? 1 : 0 },
          cDeep: { value: new THREE.Color(palette === 'night' ? '#050b1f' : '#0d1a3a') },
          cMid: { value: new THREE.Color(palette === 'night' ? '#1747d1' : '#2b5cf0') },
          cHot: { value: new THREE.Color('#38e8f5') },
          cAlert: { value: new THREE.Color('#ff5a1f') },
        },
      }),
    [palette],
  )

  const pts = useMemo(() => {
    const n = 900
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(n * 3)
    const seed = new Float32Array(n)
    const rad = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      seed[i] = Math.random()
      rad[i] = 1.35 + Math.pow(Math.random(), 2) * 1.1
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.setAttribute('aRadius', new THREE.BufferAttribute(rad, 1))
    const m = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uFlash: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uColor: { value: new THREE.Color(palette === 'night' ? '#7ff3ff' : '#1b4fd8') },
        cAlert: { value: new THREE.Color('#ff7a3d') },
      },
    })
    return { g, m }
  }, [palette])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const active = performance.now() - live.lastFrameAt < 1500
    const target = active ? live.level : 0.08 + 0.05 * Math.sin(t * 1.4)
    level.current += (target - level.current) * Math.min(1, dt * 10)
    flash.current += (live.flash - flash.current) * Math.min(1, dt * 14)
    for (const u of [mat.uniforms, pts.m.uniforms]) {
      u.uTime.value = t
      u.uLevel.value = level.current
      u.uFlash.value = flash.current
    }
    if (mesh.current) {
      mesh.current.rotation.y = t * 0.12
      const s = 1 + level.current * 0.12 + flash.current * 0.08
      mesh.current.scale.setScalar(s)
    }
  })

  return (
    <group>
      <mesh ref={mesh} material={mat}>
        <icosahedronGeometry args={[1, 64]} />
      </mesh>
      {particles && <points geometry={pts.g} material={pts.m} rotation={[0.35, 0, 0.12]} frustumCulled={false} />}
    </group>
  )
}
