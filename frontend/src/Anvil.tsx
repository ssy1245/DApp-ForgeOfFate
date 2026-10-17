import { useMemo } from 'react';
import { Shape } from 'three';

function BeveledBlock({width,height,depth,bevel=0.04,position,color,roughness=0.5}:{width:number;height:number;depth:number;bevel?:number;position:[number,number,number];color:string;roughness?:number}){
 const shape=useMemo(()=>{const w=width/2-bevel,h=height/2-bevel;const s=new Shape();s.moveTo(-w,-h);s.lineTo(w,-h);s.lineTo(w,h);s.lineTo(-w,h);s.closePath();return s;},[width,height,bevel]);
 return <mesh position={[position[0],position[1],position[2]-depth/2+bevel]} castShadow receiveShadow><extrudeGeometry args={[shape,{depth:depth-2*bevel,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:2,steps:1}]}/><meshStandardMaterial color={color} metalness={0.82} roughness={roughness}/></mesh>;
}

export default function Anvil(){
 const waist=useMemo(()=>{const s=new Shape();s.moveTo(-1.75,-0.25);s.lineTo(1.75,-0.25);s.quadraticCurveTo(0.9,-0.08,0.92,0.06);s.quadraticCurveTo(0.95,0.25,1.62,0.37);s.lineTo(-1.62,0.37);s.quadraticCurveTo(-0.95,0.25,-0.92,0.06);s.quadraticCurveTo(-0.9,-0.08,-1.75,-0.25);s.closePath();return s;},[]);
 return <group>
  <BeveledBlock position={[0,-0.4,0]} width={4.5} height={0.3} depth={2.25} bevel={0.065} color="#3f494b" roughness={0.65}/>
  <mesh position={[0,0,-0.82]} castShadow receiveShadow><extrudeGeometry args={[waist,{depth:1.64,bevelEnabled:true,bevelSize:0.035,bevelThickness:0.035,bevelSegments:2,steps:1,curveSegments:8}]}/><meshStandardMaterial color="#465457" metalness={0.8} roughness={0.55}/></mesh>
  <BeveledBlock position={[0,0.375,0]} width={5.65} height={0.12} depth={2.3} bevel={0.025} color="#374246" roughness={0.65}/>
  <BeveledBlock position={[0,0.49,0]} width={5.8} height={0.24} depth={2.4} color="#879291" roughness={0.38}/>
  <mesh position={[3.44,0.46,0]} rotation={[0,0,-Math.PI/2]} scale={[0.45,1,1]} castShadow><coneGeometry args={[0.47,1.28,24]}/><meshStandardMaterial color="#6e7b7d" metalness={0.85} roughness={0.4}/></mesh>
  {[-1.88,1.88].flatMap(x=>[-0.84,0.84].map(z=><group key={`${x}:${z}`} position={[x,-0.23,z]}><mesh><cylinderGeometry args={[0.105,0.105,0.035,12]}/><meshStandardMaterial color="#283031" metalness={0.85} roughness={0.65}/></mesh><mesh position={[0,0.04,0]}><cylinderGeometry args={[0.065,0.07,0.06,6]}/><meshStandardMaterial color="#8a8770" metalness={0.8} roughness={0.55}/></mesh></group>))}
  <mesh position={[-2.35,0.612,-0.72]}><boxGeometry args={[0.24,0.008,0.24]}/><meshStandardMaterial color="#131b1c" metalness={0.3} roughness={0.95}/></mesh>
  <mesh position={[-1.83,0.614,-0.74]} rotation={[Math.PI/2,0,0]}><circleGeometry args={[0.075,16]}/><meshBasicMaterial color="#172021"/></mesh>
  {Array.from({length:10},(_,i)=><mesh key={i} position={[-2.25+i*0.45,0.613,i%2?0.72:-0.43]} rotation={[0,0.25+i*0.13,0]}><boxGeometry args={[0.12+(i%3)*0.1,0.002,0.006]}/><meshStandardMaterial color="#b0b5ac" metalness={0.7} roughness={0.58}/></mesh>)}
  <group position={[0,0.025,0.87]}><mesh><boxGeometry args={[1.12,0.24,0.045]}/><meshStandardMaterial color="#8a7049" metalness={0.75} roughness={0.55}/></mesh><mesh position={[0,0,0.03]} rotation={[0,0,Math.PI/4]}><boxGeometry args={[0.095,0.095,0.015]}/><meshStandardMaterial color="#d2b37d" metalness={0.8} roughness={0.4}/></mesh>{[-0.46,0.46].map(x=><mesh key={x} position={[x,0,0.035]}><sphereGeometry args={[0.025,6,4]}/><meshStandardMaterial color="#ceb689" metalness={0.7} roughness={0.5}/></mesh>)}</group>
 </group>;
}
