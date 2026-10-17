import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Mesh, PointLight } from 'three';
import { FORGE_CONTACT, IMPACT_MS } from './forgeMotion';

export default function ForgeEffects({hit,result}:{hit:number;result:string}) {
  const flash=useRef<PointLight>(null);
  const ref=useRef<Group>(null), previous=useRef(hit), start=useRef(-10000);
  useEffect(()=>{if(hit!==previous.current){previous.current=hit;start.current=performance.now()+IMPACT_MS;}},[hit]);
  useFrame(()=>{
    if(!ref.current)return;
    const t=(performance.now()-start.current)/1000;
    ref.current.visible=t>=0&&t<1.1;
    if(flash.current)flash.current.intensity=t>=0?Math.max(0,1-t/0.12)*6:0;
    if(!ref.current.visible)return;
    ref.current.children.forEach((o,i)=>{
      const angle=i*2.39996;
      const speed=1.2+(i%7)*0.45;
      o.position.set(Math.cos(angle)*speed*t,0.05+(1.4+(i%5)*0.35)*t-4.8*t*t,Math.sin(angle)*speed*t);
      o.rotation.set(t*(i%4+1),t*2,angle+t);
      o.scale.setScalar(Math.max(0.1,1-t/1.1));
      const material=(o as Mesh).material as any;
      if(material)material.opacity=Math.max(0,1-t/1.1);
    });
  });
  return <><pointLight ref={flash} position={FORGE_CONTACT} color="#ffca6a" intensity={0} distance={2.2}/><group ref={ref} position={FORGE_CONTACT} visible={false}>{Array.from({length:56},(_,i)=><mesh key={i}>
    {result==='destroy'&&i<12?<boxGeometry args={[0.09,0.03,0.15]}/>:<sphereGeometry args={[0.018+(i%3)*0.008,4,4]}/>}
    <meshBasicMaterial transparent depthWrite={false} color={result==='destroy'&&i<12?'#86847a':i%3===0?'#fff1ad':i%2?'#ffc049':'#f46e22'} toneMapped={false}/>
  </mesh>)}</group></>;
}
