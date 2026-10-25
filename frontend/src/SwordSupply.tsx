import { useEffect, useMemo, type ReactNode } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { SWORD_SUPPLY_POSITION } from './workshopLayout';

export default function SwordSupply({remaining,total,onInteract,renderSword}:{remaining:number|null;total:number;onInteract:()=>void;renderSword:()=>ReactNode}){
 const texture=useMemo(()=>{
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=320;
  const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#182321';ctx.fillRect(0,0,768,320);
  ctx.strokeStyle='#b28d52';ctx.lineWidth=8;ctx.strokeRect(5,5,758,310);
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#e1c791';ctx.font='bold 48px sans-serif';ctx.fillText('领 剑 处',384,62);
  ctx.fillStyle=remaining===0?'#adae9b':'#fff0cb';ctx.font='bold 66px sans-serif';
  ctx.fillText(remaining===null?'正在清点…':`今日可领 ${remaining} / ${total} 把`,384,157);
  ctx.fillStyle='#b9c6b1';ctx.font='30px sans-serif';
  ctx.fillText(remaining===0?'今日已领完 · UTC 零点刷新':'免费普通剑 · 每次领取一把',384,252);
  const map=new CanvasTexture(canvas);map.colorSpace=SRGBColorSpace;return map;
 },[remaining,total]);
 useEffect(()=>()=>texture.dispose(),[texture]);
 return <group name="sword-supply" position={[...SWORD_SUPPLY_POSITION]} onClick={e=>{if(e.delta>4)return;e.stopPropagation();onInteract();}}>
  <group rotation={[0,Math.PI/2,0]}>
   <mesh position={[0,0.15,0]} castShadow receiveShadow><boxGeometry args={[3.15,0.3,1.2]}/><meshStandardMaterial color="#4a4030" roughness={0.85}/></mesh>
   {[-1.35,1.35].map(x=><mesh key={x} position={[x,1.5,-0.3]} castShadow><boxGeometry args={[0.18,2.7,0.2]}/><meshStandardMaterial color="#715738" roughness={0.8}/></mesh>)}
   {[0.6,1.7,2.6].map(y=><mesh key={y} position={[0,y,-0.3]} castShadow><boxGeometry args={[2.9,0.14,0.22]}/><meshStandardMaterial color="#715738" roughness={0.8}/></mesh>)}
   {Array.from({length:Math.min(total,3)},(_,i)=><group key={i} position={[(i-1)*0.8,0,0]}>
    <mesh position={[0,0.39,0.12]}><boxGeometry args={[0.5,0.16,0.38]}/><meshStandardMaterial color="#a88a55" metalness={0.65} roughness={0.5}/></mesh>
    {i<(remaining??0)&&<group position={[0,1.5,0.08]} scale={0.55}>{renderSword()}</group>}
   </group>)}
  </group>
  <sprite position={[0,3.5,0]} scale={[3.8,1.58,1]}><spriteMaterial map={texture} toneMapped={false}/></sprite>
  <pointLight position={[1.15,2.6,0]} color="#f5cb8b" intensity={8} distance={6}/>
 </group>;
}
