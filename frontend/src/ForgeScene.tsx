import { Component, Suspense, createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Box3, Group, Mesh, Quaternion, Shape, Vector3 } from 'three';
import WorkshopControls, { type ViewMode, type Station, type MoveKey } from './WorkshopControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import ForgeEffects from './ForgeEffects';
import FurnaceFire from './FurnaceFire';
import Anvil from './Anvil';
import WorkshopRoom from './WorkshopRoom';
import { ANVIL_POSITION, CABINET_POSITION, CABINET_ROTATION, CRATE_POSITION, FURNACE_POSITION, FURNACE_RAISE, FURNACE_WIDTH_SCALE } from './workshopLayout';
import { IMPACT_MS, SWING_MS, IMPACT_GRIP, IMPACT_ROTATION, WINDUP_GRIP, WINDUP_ROTATION, smooth } from './forgeMotion';
import { swordTiers, swordTier, nextSwordTier, branchTiers, type SwordTier } from './swordTiers';
import { modelUrl } from './modelAssets';
const UpgradeContext=createContext<SwordTier[]>(swordTiers);
const assetCache = new Map<string, Group>();

function cloneAsset(source:Group){const root=source.clone(true);root.traverse(o=>{if(o instanceof Mesh)o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();});return root;}
function Asset({name,size,children,heat=0}:{name:string;size:number;children:ReactNode;heat?:number}) {
  const [model,setModel]=useState<Group|null>(null);
  useEffect(()=>{let live=true;setModel(null);const key=`${name}:${size}`;const cached=assetCache.get(key);if(cached){setModel(cloneAsset(cached));return;} fetch(modelUrl(name)).then(r=>r.ok?r.arrayBuffer():null).then(buffer=>{if(!buffer)return;new GLTFLoader().parse(buffer,'/',g=>{if(!live)return;const root=g.scene;const bounds=new Box3().setFromObject(root);const center=bounds.getCenter(new Vector3());const extent=bounds.getSize(new Vector3());root.position.sub(center);const wrapper=new Group();wrapper.add(root);wrapper.scale.setScalar(size/Math.max(extent.x,extent.y,extent.z,0.001));wrapper.traverse(o=>{if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true;}});assetCache.set(key,wrapper);setModel(cloneAsset(wrapper));},()=>{});}).catch(()=>{});return()=>{live=false;};},[name,size]);
  useEffect(()=>{model?.traverse(o=>{if(o instanceof Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material]){if('emissive' in m){m.emissive.set('#ff4b06');m.emissiveIntensity=heat*1.5;}}}});},[model,heat]);
  return model?<primitive object={model}/>:<>{children}</>;
}
function Sword({level,flat=true,heat=0}:{level:number;flat?:boolean;heat?:number}) {const tier=swordTier(level,useContext(UpgradeContext));return <group rotation={flat?[Math.PI/2,0,-Math.PI/2]:[0,0,Math.PI]}>
  <Asset key={tier.model} name={tier.model} size={tier.size} heat={heat}><group>
    <mesh position={[0,0.55,0]} castShadow><boxGeometry args={[0.27,2.3,0.1]}/><meshStandardMaterial color="#bac0bd" metalness={0.85} roughness={0.25} emissive="#c36322" emissiveIntensity={0.12+level*0.015}/></mesh>
    <mesh position={[0,1.83,0]} rotation={[0,0,Math.PI/4]} castShadow><boxGeometry args={[0.19,0.19,0.08]}/><meshStandardMaterial color="#d4d6cc" metalness={0.8} roughness={0.3}/></mesh>
    <mesh position={[0,-0.65,0]} castShadow><boxGeometry args={[0.95,0.13,0.2]}/><meshStandardMaterial color="#9d7740" metalness={0.7} roughness={0.4}/></mesh>
    <mesh position={[0,-1.05,0]} castShadow><cylinderGeometry args={[0.1,0.1,0.7,8]}/><meshStandardMaterial color="#4a3024" roughness={0.9}/></mesh>
    <mesh position={[0,-1.45,0]}><sphereGeometry args={[0.16,8,6]}/><meshStandardMaterial color="#9d7740" metalness={0.7} roughness={0.4}/></mesh>
  </group></Asset></group>;}
function Hammer({hit,equipped}:{hit:number;equipped:boolean}) {
  const root=useRef<Group>(null);
  const start=useRef<number|null>(null), drawn=useRef(0), lastHit=useRef(hit);
  const fromPosition=useRef(new Vector3()),fromRotation=useRef(new Quaternion());
  const restPosition=useRef(new Vector3()),restRotation=useRef(new Quaternion());
  useEffect(()=>{if(hit!==lastHit.current){lastHit.current=hit;start.current=performance.now();if(root.current){fromPosition.current.copy(root.current.position);fromRotation.current.copy(root.current.quaternion);}}},[hit]);
  useFrame(({camera,size},dt)=>{
    if(!root.current)return;
    const age=start.current===null?SWING_MS:performance.now()-start.current;
    const striking=age<SWING_MS;
    drawn.current+=Math.max(-dt*5,Math.min(dt*5,(equipped?1:0)-drawn.current));
    root.current.visible=striking||drawn.current>0.001;
    const aspect=size.width/size.height;
    const viewFit=Math.max(1,0.9/aspect);
    restPosition.current.set(Math.min(0.52,aspect*0.32),-0.52-(1-drawn.current)*1.5,-1.6*viewFit).applyQuaternion(camera.quaternion).add(camera.position);
    restRotation.current.copy(camera.quaternion);
    if(!striking){root.current.position.copy(restPosition.current);root.current.quaternion.copy(restRotation.current);return;}
    // Deliberate wind-up, accelerating downstroke, contact hold, then a small rebound.
    if(age<280){
      const t=smooth(age/280);
      root.current.position.lerpVectors(fromPosition.current,WINDUP_GRIP,t);
      root.current.quaternion.slerpQuaternions(fromRotation.current,WINDUP_ROTATION,t);
    }else if(age<IMPACT_MS){
      const t=Math.pow((age-280)/(IMPACT_MS-280),2.5);
      root.current.position.lerpVectors(WINDUP_GRIP,IMPACT_GRIP,t);
      root.current.quaternion.slerpQuaternions(WINDUP_ROTATION,IMPACT_ROTATION,t);
    }else if(age<475){
      root.current.position.copy(IMPACT_GRIP);root.current.quaternion.copy(IMPACT_ROTATION);
    }else if(age<635){
      const t=smooth((age-475)/160);
      root.current.position.copy(IMPACT_GRIP).addScaledVector(new Vector3(0.08,0.24,0.1),t);
      root.current.quaternion.slerpQuaternions(IMPACT_ROTATION,WINDUP_ROTATION,t*0.18);
    }else{
      const t=smooth((age-635)/(SWING_MS-635));
      root.current.position.copy(IMPACT_GRIP).add(new Vector3(0.08,0.24,0.1)).lerp(restPosition.current,t);
      root.current.quaternion.copy(IMPACT_ROTATION).slerp(WINDUP_ROTATION,0.18).slerp(restRotation.current,t);
    }
  });
  // The imported hammer points up +Y; its striking face is -X. Pivot at the grip,
  // rather than the bounding-box center, so the metal face reaches the blade.
  return <group ref={root} visible={false}><group position={[0,0.375,0]}><Asset name="hammer" size={1.25}><group>
    <mesh position={[0,-0.18,0]} castShadow><cylinderGeometry args={[0.09,0.1,0.85,8]}/><meshStandardMaterial color="#604633"/></mesh>
    <mesh position={[0,0.375,0]} castShadow><boxGeometry args={[0.77,0.5,0.44]}/><meshStandardMaterial color="#737b7d" metalness={0.85} roughness={0.4}/></mesh>
  </group></Asset></group></group>;
}
function Embers(){const ref=useRef<Group>(null);useFrame(({clock})=>{if(ref.current){ref.current.rotation.y=clock.elapsedTime*0.08;ref.current.position.y=(clock.elapsedTime*0.2)%0.7;}});return <group ref={ref}>{Array.from({length:22},(_,i)=><mesh key={i} position={[Math.sin(i*7)*2.7,0.2+(i%7)*0.45,Math.cos(i*5)*1.8]}><sphereGeometry args={[0.012+(i%3)*0.008,4,4]}/><meshBasicMaterial color={i%2?'#e79838':'#d74a24'}/></mesh>)}</group>;}
type SwordPlace = 'anvil' | 'held' | 'cabinet' | 'furnace' | 'empty';
export type SceneWeapon={branch?:string;id:string;level:number;status:string;heat_charges:number;heat_ready_at:number;protected_left:number};
function HeldSword({level,heat}:{level:number;heat:number}) {
  const ref=useRef<Group>(null);
  useFrame(({camera,size})=>{if(!ref.current)return;ref.current.position.set(Math.min(0.45,size.width/size.height*0.35),-0.22,-1.7).applyQuaternion(camera.quaternion).add(camera.position);ref.current.quaternion.copy(camera.quaternion);});
  return <group ref={ref}><group scale={0.32} rotation={[0.1,-0.25,-0.3]}><Sword level={level} flat={false} heat={heat}/></group></group>;
}
function Cabinet({occupied,level,onInteract}:{occupied:boolean;level:number;onInteract:()=>void}) {
  return <group position={[...CABINET_POSITION]} rotation={[0,CABINET_ROTATION,0]} scale={[1.4,1.8,1.3]} onClick={e=>{if(e.delta>4)return;e.stopPropagation();onInteract();}}>
    {[-0.65,0.65].flatMap(x=>[-0.28,0.28].map(z=><mesh key={`${x}:${z}`} position={[x,-1.175,z]} castShadow><boxGeometry args={[0.16,0.45,0.16]}/><meshStandardMaterial color="#463625" roughness={0.75}/></mesh>))}
    <mesh castShadow receiveShadow position={[0,-0.8,0]}><boxGeometry args={[1.65,0.3,0.9]}/><meshStandardMaterial color="#463625" roughness={0.75}/></mesh>
    <mesh castShadow position={[0,0,-0.33]}><boxGeometry args={[1.65,1.6,0.12]}/><meshStandardMaterial color="#292b24" roughness={0.85}/></mesh>
    {[-0.78,0.78].map(x=><mesh key={x} castShadow position={[x,0,0]}><boxGeometry args={[0.12,1.9,0.8]}/><meshStandardMaterial color="#795f37" metalness={0.45} roughness={0.55}/></mesh>)}
    {[-0.8,0.85].map(y=><mesh key={y} castShadow position={[0,y,0]}><boxGeometry args={[1.65,0.12,0.85]}/><meshStandardMaterial color="#795f37" metalness={0.45} roughness={0.55}/></mesh>)}
    <mesh position={[0,0.78,0.15]}><boxGeometry args={[1.3,0.025,0.03]}/><meshBasicMaterial color="#f6c97c"/></mesh>
    <pointLight position={[0,0.6,0.35]} intensity={2.5} distance={3} color="#ffd28c"/>
    {occupied&&<group position={[0,0.05,0.08]} scale={0.4}><Sword level={level} flat={false}/></group>}
    <mesh position={[0,-0.66,0.44]}><boxGeometry args={[0.55,0.14,0.025]}/><meshStandardMaterial color="#ba965d" metalness={0.6} roughness={0.4}/></mesh>
  </group>;
}
function ArchStone({index}:{index:number}){
  const shape=useMemo(()=>{
    const start=index/13*Math.PI+0.008,end=(index+1)/13*Math.PI-0.008;
    const ring=new Shape();
    ring.absarc(0,0,1.47,start,end,false);
    ring.lineTo(Math.cos(end)*0.97,Math.sin(end)*0.97);
    ring.absarc(0,0,0.97,end,start,true);ring.closePath();return ring;
  },[index]);
  return <mesh position={[0,2.2,-1.1]} castShadow receiveShadow><extrudeGeometry args={[shape,{depth:2.2,bevelEnabled:true,bevelSegments:1,bevelSize:0.012,bevelThickness:0.012,curveSegments:3,steps:1}]}/><meshStandardMaterial color={index%3===0?'#78694e':index%2?'#625743':'#6b5e49'} roughness={0.95}/></mesh>;
}
function Furnace({occupied,level,heat,onInteract}:{occupied:boolean;level:number;heat:number;onInteract:()=>void}){
  return <group position={[...FURNACE_POSITION]} onClick={e=>{e.stopPropagation();if(e.delta<4)onInteract();}}>
    <mesh position={[0,0.14,0.08]} castShadow receiveShadow><boxGeometry args={[5.4,0.28,2.8]}/><meshStandardMaterial color="#4d4b42" roughness={1}/></mesh>
    <mesh position={[0,0.56,0]} castShadow receiveShadow><boxGeometry args={[5.08,0.56,2.58]}/><meshStandardMaterial color="#49453a" roughness={0.95}/></mesh>
    <mesh position={[0,0.875,0]} castShadow receiveShadow><boxGeometry args={[5.3,0.15,2.72]}/><meshStandardMaterial color="#6c6452" roughness={0.9}/></mesh>
    {[-1.68,0,1.68].map(x=><mesh key={x} position={[x,0.54,1.297]}><boxGeometry args={[0.025,0.48,0.008]}/><meshStandardMaterial color="#262923" roughness={1}/></mesh>)}
    <mesh position={[0,0.14,1.69]} castShadow receiveShadow><boxGeometry args={[3.9,0.28,0.7]}/><meshStandardMaterial color="#514d41" roughness={1}/></mesh>
    <mesh position={[0,0.4,1.44]} castShadow receiveShadow><boxGeometry args={[3.6,0.22,0.45]}/><meshStandardMaterial color="#625a48" roughness={0.95}/></mesh>
    <group position={[0,FURNACE_RAISE,0]}>
    <group scale={[FURNACE_WIDTH_SCALE,1,1]}>
    <mesh position={[0,0.22,0]} receiveShadow castShadow><boxGeometry args={[3.7,0.44,2.5]}/><meshStandardMaterial color="#49463d" roughness={0.97}/></mesh>
    <mesh position={[0,0.55,0]} receiveShadow castShadow><boxGeometry args={[3.35,0.35,2.3]}/><meshStandardMaterial color="#38332c" roughness={1}/></mesh>
    <mesh position={[0,0.88,0.2]} receiveShadow castShadow><boxGeometry args={[3.45,0.3,2.35]}/><meshStandardMaterial color="#68604e" roughness={0.94}/></mesh>
    <mesh position={[0,0.17,1.36]} receiveShadow castShadow><boxGeometry args={[3.1,0.25,0.55]}/><meshStandardMaterial color="#514b3e" roughness={1}/></mesh>
    <mesh position={[0,2.05,-1.03]} receiveShadow><boxGeometry args={[3.05,2.45,0.25]}/><meshStandardMaterial color="#35261e" roughness={1}/></mesh>
    {[-1,1].flatMap(side=>Array.from({length:5},(_,i)=><mesh key={`${side}:${i}`} position={[side*1.37,1.17+i*0.26,0]} castShadow receiveShadow><boxGeometry args={[0.53,0.245,2.2]}/><meshStandardMaterial color={i%2?'#615746':'#574e40'} roughness={0.95}/></mesh>))}
    {Array.from({length:13},(_,i)=><ArchStone key={i} index={i}/>)}
    <mesh position={[0,3.19,-0.2]} castShadow><boxGeometry args={[2.35,0.3,1.75]}/><meshStandardMaterial color="#4c4438" roughness={1}/></mesh>
    <mesh position={[0,3.78,-0.35]} castShadow><boxGeometry args={[1.3,1.05,1.2]}/><meshStandardMaterial color="#443f35" roughness={0.96}/></mesh>
    {[3.4,3.78,4.18].map(y=><mesh key={y} position={[0,y,-0.35]} castShadow><boxGeometry args={[1.43,0.1,1.32]}/><meshStandardMaterial color="#292c29" metalness={0.7} roughness={0.7}/></mesh>)}
    <mesh position={[0,4.38,-0.35]} castShadow><boxGeometry args={[1.65,0.18,1.5]}/><meshStandardMaterial color="#5e5544" roughness={0.95}/></mesh>
    {[-1.38,1.38].flatMap(x=>[1.1,2.1].map(y=><group key={`${x}:${y}`} position={[x,y,1.12]}><mesh><boxGeometry args={[0.58,0.095,0.07]}/><meshStandardMaterial color="#292b26" metalness={0.8} roughness={0.6}/></mesh>{[-0.19,0.19].map(dx=><mesh key={dx} position={[dx,0,0.055]}><sphereGeometry args={[0.032,6,4]}/><meshStandardMaterial color="#9a8260" metalness={0.7} roughness={0.5}/></mesh>)}</group>))}
    {[-0.75,0,0.75].map(x=><mesh key={x} position={[x,0.62,1.19]}><boxGeometry args={[0.46,0.12,0.03]}/><meshStandardMaterial color="#141614" roughness={1}/></mesh>)}
    <FurnaceFire/>
    </group>
    {[-0.75,0.75].map(x=><mesh key={x} position={[x,1.16,0.15]}><boxGeometry args={[0.07,0.06,1.6]}/><meshStandardMaterial color="#362b22" metalness={0.8} roughness={0.6} emissive="#b74212" emissiveIntensity={0.18}/></mesh>)}
    {occupied&&<group position={[0,1.25,0.3]} scale={0.72}><Sword level={level} heat={heat}/></group>}
    </group>
  </group>;
}
function World({level,hit,place,heat,result,hammerEquipped,onStation,roomView}:{level:number;hit:number;place:SwordPlace;heat:number;result:string;hammerEquipped:boolean;onStation:(station:Station)=>void;roomView:ViewMode}){return <>
  <color attach="background" args={['#090e13']}/><fog attach="fog" args={['#090e13',roomView==='orbit'?24:8,roomView==='orbit'?65:30]}/>
  <WorkshopRoom cutaway={roomView==='orbit'}/>

  <pointLight position={[ANVIL_POSITION[0],3.8,ANVIL_POSITION[2]+0.5]} intensity={16} distance={6} color="#a3b2bc"/>
  <ambientLight intensity={0.5} color="#8296ac"/><directionalLight position={[4,7,4]} intensity={1.05} color="#91a9c0" castShadow shadow-mapSize={[1024,1024]}/>
  <pointLight position={[ANVIL_POSITION[0]-3,1.7,ANVIL_POSITION[2]+1]} intensity={12} distance={8} color="#f07428"/><pointLight position={[ANVIL_POSITION[0]+3,3,ANVIL_POSITION[2]+2]} intensity={9} distance={7} color="#91adbf"/>
  <group position={[ANVIL_POSITION[0],0,ANVIL_POSITION[2]]}>
    <mesh position={[0,-0.55,0]} castShadow receiveShadow><boxGeometry args={[6.8,0.4,2.9]}/><meshStandardMaterial color="#45443b" roughness={1}/></mesh>
    <mesh position={[0,-0.15,0]} castShadow receiveShadow><boxGeometry args={[6.5,0.4,2.7]}/><meshStandardMaterial color="#555348" roughness={0.95}/></mesh>
  </group>
  <group position={[...ANVIL_POSITION]}><Asset name="anvil" size={7}><Anvil/></Asset></group>
  {place==='anvil'&&<group position={[ANVIL_POSITION[0]-0.18,ANVIL_POSITION[1]+0.73,ANVIL_POSITION[2]]} rotation={[0,0.12,-0.025]} onClick={e=>{if(e.delta>4)return;e.stopPropagation();onStation('anvil');}}><Sword level={level} heat={heat}/></group>}
  {place==='held'&&<HeldSword level={level} heat={heat}/>}
  <ForgeEffects hit={hit} result={result}/><Cabinet occupied={place==='cabinet'} level={level} onInteract={()=>onStation('cabinet')}/><Hammer hit={hit} equipped={hammerEquipped}/>
  <Furnace occupied={place==='furnace'} level={level} heat={heat} onInteract={()=>onStation('furnace')}/>
  {[0,1,2,3,4].map(i=><mesh key={i} position={[-9.1+(i%2)*0.25,-0.5+(i%3)*0.15,3.2+(i%3)*0.3]} rotation={[i,0.3,i]} castShadow><dodecahedronGeometry args={[0.25,0]}/><meshStandardMaterial color={i%2?'#626c68':'#8b714e'} metalness={0.5} roughness={0.8}/></mesh>)}
  <mesh position={[...CRATE_POSITION]} castShadow><boxGeometry args={[1,0.8,0.75]}/><meshStandardMaterial color="#594330" roughness={0.9}/></mesh><group position={[ANVIL_POSITION[0],0,ANVIL_POSITION[2]+1]}><Embers/></group>
</>;}
class Fallback extends Component<{children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true};}render(){return this.state.failed?<div className="scene-fallback">⚒<span>命运锻造台 · 3D 暂不可用，游戏操作仍可继续</span></div>:this.props.children;}}
export default function ForgeScene({level,hit,weapon,result,busy,probabilities,shield,shields,onShield,onPlacement,onHeat,onStrike,visualTiers=swordTiers,maxLevel,heatSeconds,heatStrikes}: {
  level:number;hit:number;weapon?:SceneWeapon;result:string;busy:boolean;probabilities:Record<string,number>;
  onPlacement:(place:string)=>void;
  shield:boolean;shields:number;onShield:(value:boolean)=>void;onHeat:()=>void;onStrike:()=>void;visualTiers?:SwordTier[];maxLevel:number;heatSeconds:number;heatStrikes:number;
}){
  const appearanceTiers=branchTiers(weapon?.branch,visualTiers);
  const nextAppearance=nextSwordTier(level,appearanceTiers);
  const [mode,setMode]=useState<ViewMode>('walk');
  const [active,setActive]=useState(false);
  const [hudOpen,setHudOpen]=useState(()=>window.innerWidth>700);
  const [impactResult,setImpactResult]=useState('');
  useEffect(()=>{if(!hit)return;const timer=setTimeout(()=>setImpactResult(result),IMPACT_MS);return()=>clearTimeout(timer);},[hit,result]);
  useEffect(()=>setImpactResult(''),[weapon?.id]);
  const [sensitivity,setSensitivity]=useState(()=>{try{const n=Number(localStorage.getItem('forge:look-sensitivity')||'1');return Number.isFinite(n)?Math.max(0.2,Math.min(2.5,n)):1;}catch{return 1;}});
  useEffect(()=>{try{localStorage.setItem('forge:look-sensitivity',String(sensitivity));}catch{}},[sensitivity]);
  const [place,setPlace]=useState<SwordPlace>('empty');
  useEffect(()=>onPlacement(place),[place,onPlacement]);
  const [clock,setClock]=useState(Date.now()/1000);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()/1000),100);return()=>clearInterval(timer);},[]);
  useEffect(()=>{setPlace(weapon?'anvil':'empty');},[weapon?.id]);
  useEffect(()=>{if(weapon&&weapon.heat_charges>0&&weapon.heat_ready_at>Date.now()/1000)setPlace('furnace');},[weapon?.id,weapon?.heat_ready_at]);
  const warming=!!weapon&&weapon.heat_charges>0&&weapon.heat_ready_at>clock;
  const hot=!!weapon&&weapon.heat_charges>0&&!warming;
  const heat=warming?Math.max(0.1,1-(weapon!.heat_ready_at-clock)/heatSeconds):hot?0.35+0.65*weapon!.heat_charges/heatStrikes:0;
  const ready=!!weapon&&weapon.status==='active'&&hot&&place==='anvil'&&!busy;
  const strikeNow=()=>{if(ready&&near==='anvil')onStrike();else setHint('先将武器加热并放回铁砧，再敲击强化。');};
  const [near,setNear]=useState<Station>(null);
  const [reset,setReset]=useState(0);
  const [hint,setHint]=useState('点击画面进入：鼠标移动转头，WASD 移动，E 拿放；按 Esc 暂停并释放鼠标。');
  const movement=useRef(new Set<MoveKey>());
  const [expanded,setExpanded]=useState(false);
  const container=useRef<HTMLDivElement>(null);
  const interact=useCallback((target:Station)=>{
    if(mode==='walk'&&!active)return;
    if(!weapon){setHint('请先领取补给并锻造一把武器。');return;}
    if(busy)return;
    if(target==='furnace'){
      if(place==='furnace'){if(warming){setHint('武器还在加热，请稍候。');return;}setPlace('held');setHint('已取出烧红的长剑，带回铁砧开始锻造。');}
      else if(place==='held'){if(hot){setHint('武器尚有热量，可以直接放回铁砧。');return;}onHeat();}
      else setHint('先拿起长剑，再带到熔炉加热。');return;
    }
    if(!target){setHint('走近锻造台或展示柜，再按 E 交互。');return;}
    if(mode==='walk'&&target!==near){setHint('再走近一些，就可以拿放武器。');return;}
    if(place==='held'){setPlace(target);setHint(target==='anvil'?'长剑已放回锻造台，锻造锤就绪。':'长剑已放进展示柜，锻造锤已收起。');}
    else if(place===target){setPlace('held');setHint('已拿起长剑，锻造锤自动收起。走近另一处可以放下长剑。');}
    else setHint('这里暂时没有武器；请先拿起长剑。');
  },[mode,near,place,active,weapon,busy,warming,hot,onHeat]);
  useEffect(()=>{movement.current.clear();},[mode]);
  useEffect(()=>{const stop=()=>movement.current.clear();window.addEventListener('blur',stop);return()=>window.removeEventListener('blur',stop);},[]);
  const changeMode=(next:ViewMode)=>{movement.current.clear();setMode(next);setHint(next==='walk'?'点击画面进入：鼠标移动转头，WASD 移动，E 拿放；按 Esc 暂停并释放鼠标。':'拖动旋转视角，滚轮缩放；点击剑或下方按钮拿起。');};
  const hammerEquipped=mode==='walk'&&!!weapon&&place==='anvil'&&near==='anvil';
  const nearLabel=near==='anvil'?'锻造台':near==='cabinet'?'展示柜':near==='furnace'?'熔炉':'靠近锻造设施';
  return <UpgradeContext.Provider value={appearanceTiers}><Fallback><div ref={container} className={`workshop-view ${expanded?'workshop-expanded':''}`}>
    <div className="workshop-toolbar"><div className="view-modes"><button aria-pressed={mode==='orbit'} onClick={()=>changeMode('orbit')}>环绕查看</button><button aria-pressed={mode==='walk'} onClick={()=>changeMode('walk')}>第一人称</button></div><div><button onClick={()=>{movement.current.clear();setReset(r=>r+1);}}>复位</button><button aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'收起':'展开'}</button></div></div>
    <label className="look-sensitivity">视角灵敏度 <input aria-label="视角灵敏度" type="range" min="0.2" max="2.5" step="0.1" value={sensitivity} onChange={e=>setSensitivity(Number(e.target.value))}/><output>{sensitivity.toFixed(1)}×</output></label>
    <Canvas shadows camera={{position:[6.6,6.3,9.3],fov:44}} dpr={[1,1.6]}>
      <WorkshopControls mode={mode} reset={reset} movement={movement.current} sensitivity={sensitivity} onNear={setNear} onActiveChange={setActive} onError={setHint} onPrimary={strikeNow} onInteract={()=>interact(near)}/>
      <Suspense fallback={null}><World roomView={mode} level={level} hit={hit} place={place} heat={heat} result={result} hammerEquipped={hammerEquipped} onStation={station=>{if(mode==='orbit')interact(station);}}/></Suspense>
    </Canvas>
    {mode==='walk'&&!active&&!busy&&<div className="workshop-entry"><strong>点击画面进入工坊</strong><span><kbd>W A S D</kbd> 移动 <kbd>E</kbd> 拿放 <kbd>Esc</kbd> 暂停</span></div>}
    {mode==='walk'&&<><div className="workshop-crosshair" aria-hidden="true">+</div><div className="walk-pad" aria-label="移动方向">{[['KeyW','前进'],['KeyA','左移'],['KeyS','后退'],['KeyD','右移']].map(([key,label])=><button key={key} aria-label={`${key.slice(-1)} ${label}`} disabled={!active} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);movement.current.add(key as MoveKey);}} onPointerUp={()=>movement.current.delete(key as MoveKey)} onPointerCancel={()=>movement.current.clear()} onLostPointerCapture={()=>movement.current.delete(key as MoveKey)}>{key.slice(-1)}</button>)}</div></>}
    <div className="workshop-interactions"><span>{place==='held'?'持剑中':place==='anvil'?'长剑在锻造台':place==='furnace'?'长剑在熔炉':place==='empty'?'请先锻造武器':'长剑在展示柜'}{mode==='walk'?` · ${active?nearLabel:'已暂停'}`:''}{hammerEquipped?' · 已取出锻造锤':''}</span><div>
      {place!=='empty'&&place!=='held'?<button disabled={mode==='walk'&&(!active||near!==place)} onClick={()=>interact(place==='furnace'?'furnace':place==='cabinet'?'cabinet':'anvil')}>拿起长剑{mode==='walk'?' · E':''}</button>:place==='held'?<><button disabled={mode==='walk'&&(!active||near!=='anvil')} onClick={()=>interact('anvil')}>放回锻造台</button><button disabled={mode==='walk'&&(!active||near!=='cabinet')} onClick={()=>interact('cabinet')}>放进展示柜</button></>:null}
    </div><small role="status">{hint}</small></div>
    <aside className={`forge-hud ${hudOpen?'hud-open':'hud-compact'}`} aria-label="铁砧锻造面板"><button className="hud-heading" aria-label={hudOpen?'收起武器面板':'展开武器面板'} aria-expanded={hudOpen} onClick={()=>setHudOpen(v=>!v)}><span className="hud-heading-label">武器状态 <small>{hudOpen?'收起 −':'展开 +'}</small></span><span className="hud-weapon"><span>{swordTier(level,appearanceTiers).name}</span><strong>+{level}</strong></span></button>{hudOpen&&<><p>{!weapon?'尚未锻造武器':weapon.status!=='active'?'已封存 · 属性固定':warming?`熔炉加热中 · ${Math.max(0,weapon.heat_ready_at-clock).toFixed(1)} 秒`:hot?`烧红 · 可敲 ${weapon.heat_charges} 锤`:`需要加热 · 每炉可敲 ${heatStrikes} 锤`}</p>
      <div className={`hud-heat ${warming?'warming':''}`} aria-label={`剩余热量 ${weapon?.heat_charges??0} / ${heatStrikes} 锤`}><span>锻造热量</span><div>{Array.from({length:heatStrikes},(_,i)=><i key={i} className={i<(weapon?.heat_charges??0)?'charged':''}/>)}</div><b>{weapon?.heat_charges??0}/{heatStrikes}</b></div>
      <p>{nextAppearance?`Next appearance: +${nextAppearance.min_level} · ${nextAppearance.name}`:"Current route appearance complete"}</p><div className="hud-transitions">{[['up','升级',`+${Math.min(maxLevel,level+1)}`],['double','大成功',`+${Math.min(maxLevel,level+2)}`],['down','降级',`+${Math.max(0,level-1)}`],['destroy','损毁','永久消失'],...(probabilities.saved?[['saved','保护生效',`维持 +${level}`]]:[])].map(([key,label,next])=><div key={key}><span>{label} → {next}</span><b>{weapon?`${((probabilities[key]||0)*100).toFixed(1)}%`:'—'}</b></div>)}</div>
      <label className="hud-shield"><input type="checkbox" checked={shield} disabled={busy||!weapon||weapon.status!=='active'||weapon.protected_left>0||shields<1} onChange={e=>onShield(e.target.checked)}/>单锤保护符 · {shields} 张</label>
      {weapon?.protected_left? <p>免损毁阶段 · 剩余 {weapon.protected_left} 锤</p>:null}
      <div className="hud-buttons"><button disabled={busy||!weapon||weapon.status!=='active'||weapon.heat_charges>0} onClick={onHeat}>送入熔炉</button>{place==='furnace'?<button disabled={busy||warming} onClick={()=>{setPlace('anvil');setHint('已将烧红的武器放回铁砧。');}}>取回铁砧</button>:<button disabled={!ready} onClick={onStrike}>敲击 · 空格 / 左键</button>}</div>
      {hit>0&&impactResult&&<div className={`hud-result ${impactResult}`} role="status">{({up:'强化成功 +1',double:'大成功 +2',down:'强化降级 −1',destroy:'武器损毁，已失去',saved:'保护生效，等级不变'} as Record<string,string>)[impactResult]}</div>}
    </>}
    </aside>
  </div></Fallback></UpgradeContext.Provider>;
}
