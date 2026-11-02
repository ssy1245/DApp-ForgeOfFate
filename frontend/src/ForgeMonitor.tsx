import {useEffect,useMemo} from 'react';
import {CanvasTexture,SRGBColorSpace} from 'three';
import {ANVIL_POSITION} from './workshopLayout';

export type MonitorData={title:string;weapon:string;level:string;priceLabel:string;price:string;next:string;rows:{label:string;value:string;tone?:'success'|'danger'}[];status:string;mutation?:string};
// One immutable display snapshot feeds both the world screen and its readable HTML view.
export default function ForgeMonitor({data}:{data:MonitorData}){
 const encoded=JSON.stringify(data);
 const texture=useMemo(()=>{const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=704;const map=new CanvasTexture(canvas);map.colorSpace=SRGBColorSpace;return map;},[]);
 useEffect(()=>{
  const d:MonitorData=JSON.parse(encoded),ctx=(texture.image as HTMLCanvasElement).getContext('2d');if(!ctx)return;
  // Use the room's blue-grey iron palette; the surface receives the same light as the walls.
  const field=ctx.createLinearGradient(0,0,1536,704);field.addColorStop(0,'#343e42');field.addColorStop(.55,'#293236');field.addColorStop(1,'#242d31');
  ctx.fillStyle=field;ctx.fillRect(0,0,1536,704);
  for(let i=0;i<360;i++){ctx.fillStyle=i%2?'#bdc9cc07':'#00000010';ctx.fillRect((i*173)%1536,(i*67)%704,45+(i%31),1);}
  ctx.strokeStyle='#85775b';ctx.lineWidth=2;ctx.strokeRect(18,18,1500,668);
  ctx.strokeStyle='#a9b7b845';ctx.lineWidth=1;ctx.strokeRect(34,34,1468,636);
  const line=(x:number,y:number,endX:number,endY:number,color='#b6a07448')=>{ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(endX,endY);ctx.stroke();};
  const diamond=(x:number,y:number,r:number)=>{ctx.fillStyle='#c8a56b';ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();ctx.fill();};
  const serif="Georgia, 'Songti SC', 'STSong', 'Noto Serif SC', serif";
  const text=(value:string,x:number,y:number,size:number,color='#e9dbb6',width=1400,font=serif)=>{ctx.fillStyle=color;ctx.font=`500 ${size}px ${font}`;ctx.fillText(value,x,y,width);};
  text(d.title,66,92,32,'#c8b68f',650);text('F O R G E   O F   F A T E',986,88,25,'#c8b68f',460);
  line(66,122,1470,122);diamond(754,82,9);
  text(d.weapon,66,205,45,'#eee5d1',640);text(d.level,60,382,160,'#f7ebcf');
  text(d.priceLabel,66,451,31,'#a6ab97');text(d.price,66,520,47,'#e9d4ab',630);
  line(750,174,750,540);
  text(d.next,806,205,32,'#c8b68f',660);
  d.rows.forEach((r,i)=>{const color=r.tone==='danger'?'#f0a08d':r.tone==='success'?'#b6d99f':undefined;text(r.label,806,270+i*58,30,color||'#c4c5b1',470,"'Noto Sans SC', sans-serif");text(r.value,1300,270+i*58,38,color||'#e9d4ab',170);});
  if(d.mutation)text(d.mutation,66,567,24,'#d3b793',1400,"'Noto Sans SC', sans-serif");
  line(66,d.mutation?592:580,1470,d.mutation?592:580);diamond(80,627,5);text(d.status,103,637,30,'#b8b6a5',1360,"'Noto Sans SC', sans-serif");
  texture.needsUpdate=true;
 },[encoded,texture]);
 useEffect(()=>()=>texture.dispose(),[texture]);
 return <group name="forge-status-monitor" position={[ANVIL_POSITION[0],3.15,-6.38]}>
  <mesh castShadow receiveShadow><boxGeometry args={[5.28,2.55,0.18]}/><meshStandardMaterial color="#30383b" metalness={.55} roughness={.85}/></mesh>
  <mesh position={[0,0,.101]} receiveShadow><planeGeometry args={[5.04,2.31]}/><meshStandardMaterial map={texture} roughness={.92} metalness={.08}/></mesh>
  {[-1.21,1.21].map(y=><mesh key={y} position={[0,y,.11]}><boxGeometry args={[5.18,.04,.045]}/><meshStandardMaterial color="#6f6756" metalness={.65} roughness={.78}/></mesh>)}
  {[-2.58,2.58].map(x=><mesh key={x} position={[x,0,.11]}><boxGeometry args={[.04,2.46,.045]}/><meshStandardMaterial color="#6f6756" metalness={.65} roughness={.78}/></mesh>)}
  {[-2.58,2.58].flatMap(x=>[-1.21,1.21].map(y=><mesh key={`${x}:${y}`} position={[x,y,.15]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.045,.045,.03,6]}/><meshStandardMaterial color="#c4a26a" metalness={.8} roughness={.55}/></mesh>))}
 </group>;
}
