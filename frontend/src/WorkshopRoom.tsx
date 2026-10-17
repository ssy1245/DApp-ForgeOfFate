import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Group, InstancedMesh, Matrix4 } from 'three';

function Timber({position,size,rotation=0}:{position:[number,number,number];size:[number,number,number];rotation?:number}){
 return <mesh position={position} rotation={[0,0,rotation]} castShadow receiveShadow><boxGeometry args={size}/><meshStandardMaterial color="#493c2e" roughness={0.91}/></mesh>;
}
function StoneFloor(){
 const ref=useRef<InstancedMesh>(null);
 useLayoutEffect(()=>{
  if(!ref.current)return;
  const matrix=new Matrix4(),color=new Color();
  for(let i=0;i<208;i++){
   matrix.makeTranslation(-9.375+(i%16)*1.25,-0.79,-6.1+Math.floor(i/16)*1.25);
   ref.current.setMatrixAt(i,matrix);
   color.set(i%5===0?'#635f53':i%3===0?'#514f46':'#59584e');
   ref.current.setColorAt(i,color);
  }
  ref.current.instanceMatrix.needsUpdate=true;
  if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;
 },[]);
 return <><mesh position={[0,-0.95,1.4]} receiveShadow><boxGeometry args={[20.55,0.3,16.7]}/><meshStandardMaterial color="#292b27" roughness={1}/></mesh><instancedMesh ref={ref} args={[undefined,undefined,208]} receiveShadow><boxGeometry args={[1.225,0.08,1.225]}/><meshStandardMaterial roughness={0.96}/></instancedMesh></>;
}
function Masonry({width}:{width:number}){
 const ref=useRef<InstancedMesh>(null),cols=Math.ceil(width/1.4);
 const count=cols*4;
 useLayoutEffect(()=>{
  if(!ref.current)return;
  const matrix=new Matrix4(),color=new Color();
  for(let i=0;i<count;i++){
   const row=Math.floor(i/cols),col=i%cols;
   matrix.makeTranslation(-width/2+(col+0.5)*width/cols+(row%2?0.08:-0.08),-0.49+row*0.45,0.21);
   ref.current.setMatrixAt(i,matrix);color.set(i%4===0?'#696354':i%3===0?'#575849':'#605e50');ref.current.setColorAt(i,color);
  }
  ref.current.instanceMatrix.needsUpdate=true;if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;
 },[width,cols,count]);
 return <instancedMesh ref={ref} args={[undefined,undefined,count]} receiveShadow><boxGeometry args={[width/cols-0.025,0.42,0.13]}/><meshStandardMaterial roughness={0.98}/></instancedMesh>;
}
function Window({x}:{x:number}){
 return <group position={[x,2.9,0.04]}>
  <mesh position={[0,0,-0.05]}><planeGeometry args={[2.5,2.2]}/><meshBasicMaterial color="#73898d"/></mesh>
  {[-1.35,1.35].map(px=><Timber key={px} position={[px,0,0.21]} size={[0.17,2.5,0.3]}/>)}
  {[-1.2,1.2].map(y=><Timber key={y} position={[0,y,0.21]} size={[2.86,0.18,0.35]}/>)}
  <Timber position={[0,-1.28,0.38]} size={[3.1,0.16,0.7]}/>
  {[-0.8,0,0.8].map(px=><mesh key={px} position={[px,0,0.16]}><boxGeometry args={[0.045,2.2,0.045]}/><meshStandardMaterial color="#313b37" metalness={0.7} roughness={0.7}/></mesh>)}
  {[-0.55,0.15,0.8].map(y=><mesh key={y} position={[0,y,0.16]}><boxGeometry args={[2.5,0.035,0.05]}/><meshStandardMaterial color="#313b37" metalness={0.7} roughness={0.7}/></mesh>)}
 </group>;
}
function Door(){return <group position={[0,1.25,0.09]}>
 {Array.from({length:8},(_,i)=><mesh key={i} position={[-1.14+i*0.326,0,0]} castShadow receiveShadow><boxGeometry args={[0.312,4.0,0.22]}/><meshStandardMaterial color={i%2?'#55402d':'#634b32'} roughness={0.95}/></mesh>)}
 {[-1.4,1.4].map(x=><Timber key={x} position={[x,0.05,0.1]} size={[0.22,4.22,0.36]}/>)}
 <Timber position={[0,2.14,0.1]} size={[3.05,0.25,0.45]}/>
 {[-1.2,0.95].map(y=><mesh key={y} position={[0,y,0.16]}><boxGeometry args={[2.48,0.15,0.07]}/><meshStandardMaterial color="#242d29" metalness={0.75} roughness={0.7}/></mesh>)}
 <mesh position={[0.8,-0.1,0.25]}><torusGeometry args={[0.13,0.025,8,16]}/><meshStandardMaterial color="#9c8963" metalness={0.8} roughness={0.55}/></mesh>
 </group>;}
function Lantern({position}:{position:[number,number,number]}){return <group position={position}>
 <Timber position={[0,0.15,-0.15]} size={[0.12,0.7,0.15]}/>
 <mesh><boxGeometry args={[0.26,0.4,0.25]}/><meshBasicMaterial color="#ffc273" toneMapped={false}/></mesh>
 {[-0.24,0.24].map(y=><mesh key={y} position={[0,y,0]}><boxGeometry args={[0.4,0.1,0.38]}/><meshStandardMaterial color="#34332b" metalness={0.7} roughness={0.65}/></mesh>)}
 {[-0.16,0.16].flatMap(x=>[-0.15,0.15].map(z=><mesh key={`${x}:${z}`} position={[x,0,z]}><boxGeometry args={[0.035,0.48,0.035]}/><meshStandardMaterial color="#36382c" metalness={0.7} roughness={0.7}/></mesh>))}
 <pointLight position={[0,0,0.35]} color="#ffce8d" intensity={18} distance={10} decay={2}/>
 </group>;}
function Wall({position,rotation,width,windows=[],door=false,cutaway,axis,sign}:{position:[number,number,number];rotation:number;width:number;windows?:number[];door?:boolean;cutaway:boolean;axis:'x'|'z';sign:number}){
 const ref=useRef<Group>(null);
 useFrame(({camera})=>{if(ref.current)ref.current.visible=!cutaway||camera.position[axis]*sign<0.8;});
 const panel=(x:number,y:number,w:number,h:number,key:string)=><mesh key={key} position={[x,y,0]} castShadow receiveShadow><boxGeometry args={[w,h,0.38]}/><meshStandardMaterial color="#79715d" roughness={0.96}/></mesh>;
 const pieces:ReactNode[]=[];
 if(door){
  pieces.push(panel(-(width+2.65)/4,2.35,(width-2.65)/2,6.2,'left'),panel((width+2.65)/4,2.35,(width-2.65)/2,6.2,'right'),panel(0,4.4,2.65,2.1,'lintel'));
 }else{
  pieces.push(panel(0,0.5,width,2.5,'lower'),panel(0,4.75,width,1.4,'upper'));
  let edge=-width/2;
  for(const x of [...windows].sort((a,b)=>a-b)){
   const end=x-1.3;if(end>edge)pieces.push(panel((edge+end)/2,2.9,end-edge,2.3,`between:${x}`));edge=x+1.3;
  }
  if(edge<width/2)pieces.push(panel((edge+width/2)/2,2.9,width/2-edge,2.3,'end'));
 }
 return <group ref={ref} position={position} rotation={[0,rotation,0]}>
  {pieces}{!door&&<Masonry width={width}/>}{windows.map(x=><Window key={x} x={x}/>)}{door&&<Door/>}
  {[-width/2+0.16,0,width/2-0.16].filter(x=>!door||Math.abs(x)>1.5).map(x=><group key={x}><Timber position={[x,2.35,0.3]} size={[0.24,6.2,0.34]}/><Timber position={[x+(x>0?-0.45:0.45),4.7,0.3]} size={[0.16,1.35,0.23]} rotation={x>0?-Math.PI/4:Math.PI/4}/></group>)}
  <Timber position={[0,5.26,0.28]} size={[width,0.3,0.4]}/>
  {!door&&<Timber position={[0,1.27,0.28]} size={[width,0.16,0.24]}/>}
  {!door&&<Lantern position={[width/2-1.3,3.15,0.62]}/>}
 </group>;
}
export default function WorkshopRoom({cutaway}:{cutaway:boolean}){
 return <>
  <StoneFloor/>
  <Wall position={[0,0,-6.85]} rotation={0} width={20.4} windows={[-5.1,3.1]} axis="z" sign={-1} cutaway={cutaway}/>
  <Wall position={[-10.2,0,1.4]} rotation={Math.PI/2} width={16.5} windows={[-2.3]} axis="x" sign={-1} cutaway={cutaway}/>
  <Wall position={[10.2,0,1.4]} rotation={-Math.PI/2} width={16.5} windows={[2.3]} axis="x" sign={1} cutaway={cutaway}/>
  <Wall position={[0,0,9.65]} rotation={Math.PI} width={20.4} door axis="z" sign={1} cutaway={cutaway}/>
  <group visible={!cutaway}>
   <mesh position={[0,5.52,1.4]} receiveShadow><boxGeometry args={[20.8,0.2,16.9]}/><meshStandardMaterial color="#352f26" roughness={1}/></mesh>
   {[-5,-1,3,7].map(z=><Timber key={z} position={[0,5.22,z]} size={[20.5,0.38,0.35]}/>)}
   {[-7,-3.5,0,3.5,7].map(x=><Timber key={x} position={[x,5.36,1.4]} size={[0.18,0.18,16.6]}/>)}
  </group>
  <pointLight position={[-4.8,3.2,-5.6]} color="#a4bec9" intensity={12} distance={10}/>
  <pointLight position={[3.1,3.5,-5.6]} color="#a4bec9" intensity={10} distance={8}/>
 </>;
}
