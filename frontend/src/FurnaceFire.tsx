import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DoubleSide, Group, Mesh, PointLight } from 'three';

const vertexShader=`
 varying vec2 vUv;
 uniform float uTime;
 uniform float uSeed;
 uniform float uHeight;
 void main(){
   vUv=uv;
   vec3 p=position;
   // Keep the fire rooted in the coal bed: the upper tongue takes most of the motion.
   float tip=pow(uv.y,1.7);
   float draft=sin(uTime*0.95)*0.13+sin(uTime*1.43)*0.055;
   float curl=sin(uTime*2.25+uSeed+uv.y*4.8)*0.12
             +sin(uTime*3.6+uSeed*0.7-uv.y*7.0)*0.045;
   float breath=0.95+sin(uTime*1.8+uSeed)*0.08+sin(uTime*3.1+uSeed*0.4)*0.045;
   p.y=(p.y+uHeight*0.5)*breath-uHeight*0.5;
   p.x*=1.0+sin(uTime*2.0+uSeed)*uv.y*0.09;
   p.x+=(draft+curl)*tip;
   p.z+=sin(uTime*1.7+uSeed+uv.y*5.0)*tip*0.075;
   gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
 }
`;
const fragmentShader=`
 varying vec2 vUv;
 uniform float uTime;
 uniform float uSeed;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){
   vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
   return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
 }
 float fbm(vec2 p){
   float n=0.0,a=0.5;
   for(int i=0;i<4;i++){n+=a*noise(p);p=p*2.03+vec2(13.2,7.1);a*=0.5;}
   return n;
 }
 void main(){
   float y=vUv.y;
   vec2 p=vec2((vUv.x-0.5)*2.0,y);
   float flow=fbm(vec2(p.x*4.0+uSeed,y*5.0-uTime*2.8));
   float curl=(sin(y*7.0-uTime*2.4+uSeed)*0.17+sin(uTime*1.1+uSeed)*0.06)*y;
   float tongue=0.1*sin(p.x*14.0+uSeed+uTime*1.7);
   float width=pow(1.0-y,0.9)*(0.86+0.075*sin(uTime*2.2+uSeed+y*5.0));
   float edge=width-abs(p.x+curl+(flow-0.5)*y*0.38)+(flow-0.48)*0.27+tongue*y;
   float mask=smoothstep(-0.06,0.1,edge)*smoothstep(0.0,0.06,y)*(1.0-smoothstep(0.85,1.0,y));
   float holes=smoothstep(0.15,0.45,flow+(1.0-y)*0.55);
   float core=clamp(edge*1.6+(1.0-y)*0.35,0.0,1.0);
   vec3 color=mix(vec3(0.95,0.075,0.008),vec3(1.0,0.42,0.025),smoothstep(0.0,0.5,core));
   color=mix(color,vec3(1.0,0.88,0.42),smoothstep(0.45,0.95,core));
   float alpha=mask*holes*(0.65+flow*0.25)*0.72;
   if(alpha<0.015)discard;
   gl_FragColor=vec4(color*1.1,alpha);
 }
`;

function Flame({x,z,height,width,seed,rotation=0}:{x:number;z:number;height:number;width:number;seed:number;rotation?:number}){
 const material=useMemo(()=>({uTime:{value:0},uSeed:{value:seed},uHeight:{value:height}}),[seed,height]);
 useFrame(({clock})=>{material.uTime.value=clock.elapsedTime;});
 return <mesh position={[x,1.06+height/2,z]} rotation={[0,rotation,0]} renderOrder={2}>
  <planeGeometry args={[width,height,8,16]}/>
  <shaderMaterial uniforms={material} vertexShader={vertexShader} fragmentShader={fragmentShader} transparent depthWrite={false} side={DoubleSide} blending={AdditiveBlending} toneMapped={false}/>
 </mesh>;
}

export default function FurnaceFire(){
 const embers=useRef<Group>(null),light=useRef<PointLight>(null);
 useFrame(({clock})=>{
  const t=clock.elapsedTime;
  if(light.current)light.current.intensity=11+Math.sin(t*9.7)*1.5+Math.sin(t*17.3)*0.7;
  embers.current?.children.forEach((o,i)=>{
   const phase=(t*(0.22+(i%5)*0.035)+i*0.137)%1;
   o.position.set(Math.sin(i*12.7)*0.85+Math.sin(t*1.7+i)*phase*0.17,1.05+phase*2.5,0.15+Math.cos(i*5.3)*0.6);
   o.scale.setScalar(Math.sin(phase*Math.PI)*(0.6+(i%3)*0.3));
   ((o as Mesh).material as any).opacity=Math.sin(phase*Math.PI)*0.85;
  });
 });
 return <>
  <mesh position={[0,1.025,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[2.15,1.85]}/><meshBasicMaterial color="#aa2608" toneMapped={false}/></mesh>
  {Array.from({length:24},(_,i)=><mesh key={i} position={[-0.9+(i%6)*0.36,1.075+(i%3)*0.018,-0.63+Math.floor(i/6)*0.4]} rotation={[i*0.31,i*1.7,i*0.19]} scale={[0.2,0.13,0.18]}>
   <dodecahedronGeometry args={[1,0]}/><meshStandardMaterial color={i%3===0?'#1e1410':'#3a1b11'} roughness={1} emissive={i%3===0?'#8a1a04':'#f04708'} emissiveIntensity={i%3===0?0.5:1.4}/>
  </mesh>)}
  {[-0.7,-0.2,0.35,0.75].map((x,i)=><Flame key={i} x={x} z={i%2?0.15:-0.35} height={1.35+(i%3)*0.25} width={1.0+(i%2)*0.2} seed={i*3.1}/>)}
  <Flame x={0} z={0.45} height={1.85} width={1.7} seed={15}/>
  <Flame x={0} z={-0.05} height={1.75} width={1.5} seed={21} rotation={Math.PI/3}/>
  <group ref={embers}>{Array.from({length:24},(_,i)=><mesh key={i}><sphereGeometry args={[0.012+(i%3)*0.005,4,4]}/><meshBasicMaterial color={i%3?'#ff952c':'#ffe1a0'} transparent depthWrite={false} toneMapped={false}/></mesh>)}</group>
  <pointLight ref={light} position={[0,1.7,0.7]} color="#ff8a38" intensity={11} distance={5.5} decay={2}/>
 </>;
}
