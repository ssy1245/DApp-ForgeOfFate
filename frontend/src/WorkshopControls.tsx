import { useI18n } from './i18n';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Euler, Vector3 } from 'three';
import { ANVIL_POSITION, CABINETS, CABINET_SCALE, FURNACE_POSITION, FURNACE_FOOTPRINT, SWORD_SUPPLY_POSITION, SWORD_SUPPLY_FOOTPRINT, canStand, type CabinetId } from './workshopLayout';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ViewMode = 'orbit' | 'walk';
export type Station = 'anvil' | CabinetId | 'furnace' | 'supply' | null;
export type MoveKey = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD';
export const STATIONS:Record<Exclude<Station,null>,Vector3> = {
 anvil:new Vector3(ANVIL_POSITION[0],0,ANVIL_POSITION[2]),
 ...Object.fromEntries(CABINETS.map(({id,position})=>[id,new Vector3(position[0]-0.45*CABINET_SCALE[2]-0.35,0,position[2])])) as Record<CabinetId,Vector3>,
 furnace:new Vector3(FURNACE_POSITION[0],0,FURNACE_POSITION[2]+FURNACE_FOOTPRINT.front),
 supply:new Vector3(SWORD_SUPPLY_POSITION[0]+SWORD_SUPPLY_FOOTPRINT.halfDepth+0.4,0,SWORD_SUPPLY_POSITION[2]),
};

export { canStand } from './workshopLayout';

export default function WorkshopControls({mode, reset, movement, sensitivity, onNear, onInteract, onActiveChange, onError, onPrimary}: {
  mode: ViewMode; reset: number; movement: Set<MoveKey>; sensitivity: number;
  onPrimary: () => void;
  onNear: (station: Station) => void; onInteract: () => void;
  onActiveChange: (active: boolean) => void; onError: (message: string) => void;
}) {
 const {t} = useI18n();
  const {camera, gl, size} = useThree();
  const orbit = useRef<OrbitControls | null>(null);
  const keys = useRef(new Set<string>());
  const active = useRef(false);
  const sensitivityRef = useRef(sensitivity); sensitivityRef.current = sensitivity;
  const near = useRef<Station>(null);
  const previousView = useRef('');
  const interact = useRef(onInteract); interact.current = onInteract;
  const primary=useRef(onPrimary);primary.current=onPrimary;
  const yaw = useRef(0), pitch = useRef(-0.15);
  const forward = useRef(new Vector3()), right = useRef(new Vector3());

  useEffect(() => {
    gl.domElement.setAttribute('aria-label', t('工坊三维视图：点击进入，鼠标移动转头，WASD 移动，E 交互，Esc 暂停'));
  }, [gl, t]);

  useEffect(() => {
    const canvas = gl.domElement;
    const viewKey = `${mode}:${reset}`;
    const preserveWalk = mode === 'walk' && previousView.current === viewKey;
    previousView.current = viewKey;
    canvas.tabIndex = 0;
    canvas.style.touchAction = 'none';
    near.current = null; onNear(null); keys.current.clear();movement.clear();
    active.current=false;onActiveChange(false);
    if (mode === 'orbit') {
      const fit = Math.max(1, 1.2 / (size.width / size.height));
      camera.position.set(-18,13,23).sub(new Vector3(0,1.6,1)).multiplyScalar(fit).add(new Vector3(0,1.6,1));
      const control = new OrbitControls(camera, canvas);
      control.target.set(0,1.6,1);
      control.enableDamping = true; control.enablePan = false;
      control.minDistance = 4; control.maxDistance = Math.max(60, 40 * fit);
      control.minPolarAngle = 0.15; control.maxPolarAngle = Math.PI / 2 - 0.06;
      control.update(); orbit.current = control;
      return () => {control.dispose(); orbit.current = null;};
    }
    if (!preserveWalk) {
      camera.position.set(0, 2.65, 6.5);
      yaw.current = 0; pitch.current = -0.15;
      camera.quaternion.setFromEuler(new Euler(pitch.current, yaw.current, 0, 'YXZ'));
    }
    let touchLast: {x:number;y:number} | null = null;
    let requested=false, fallback=false;
    let mouseLast:{x:number;y:number}|null=null;
    const cursorClass='forge-mouse-captured';
    const captureCursor=()=>document.body.classList.add(cursorClass);
    const pause = () => {
      document.body.classList.remove(cursorClass);
      requested=false;fallback=false;mouseLast=null;active.current=false;keys.current.clear();movement.clear();touchLast=null;onActiveChange(false);
      if(document.pointerLockElement===canvas)document.exitPointerLock();
    };
    const fail = () => {
      if(!requested||fallback)return;
      captureCursor();
      fallback=true;active.current=true;keys.current.clear();movement.clear();onActiveChange(true);
      onError('鼠标已隐藏 · 移出工坊不暂停 · 按 Esc 退出操控。');
    };
    const rotate = (dx:number,dy:number) => {
      yaw.current-=dx*0.002*sensitivityRef.current;
      pitch.current=Math.max(-1.4,Math.min(1.4,pitch.current-dy*0.002*sensitivityRef.current));
      camera.quaternion.setFromEuler(new Euler(pitch.current,yaw.current,0,'YXZ'));
    };
    const down = (e: PointerEvent) => {
      if(e.button!==0)return;
      canvas.focus({preventScroll:true});
      if(e.pointerType==='touch'){
        active.current=true;onActiveChange(true);
        canvas.setPointerCapture(e.pointerId);touchLast={x:e.clientX,y:e.clientY};return;
      }
      if(document.pointerLockElement===canvas||fallback){primary.current();return;}
      requested=true;mouseLast={x:e.clientX,y:e.clientY};
      try {
        if(!canvas.requestPointerLock){fail();return;}
        const request=canvas.requestPointerLock();
        request?.catch(fail);
      }catch{fail();}
    };
    const lockChanged = () => {
      const locked=document.pointerLockElement===canvas;
      if(locked&&!requested){document.exitPointerLock();return;}
      if(locked){captureCursor();onError('鼠标已锁定 · WASD 移动 · 按 Esc 退出操控。');fallback=false;active.current=true;onActiveChange(true);keys.current.clear();movement.clear();}
      else if(!fallback)pause();
    };
    const mouseMove = (e:MouseEvent) => {
      if(!active.current)return;
      if(document.pointerLockElement===canvas){rotate(e.movementX,e.movementY);return;}
      if(fallback){
        if(mouseLast)rotate(e.clientX-mouseLast.x,e.clientY-mouseLast.y);
        mouseLast={x:e.clientX,y:e.clientY};
      }
    };
    // Leaving the canvas does not end the session. Only explicit exit, focus loss,
    // or interacting with the surrounding page releases game controls.
    const leaveWindow=()=>{mouseLast=null;};
    const outsideDown=(e:PointerEvent)=>{
      if(active.current&&e.target instanceof Element&&!e.target.closest('.workshop-view'))pause();
    };
    const touchMove = (e:PointerEvent) => {
      if(e.pointerType!=='touch'||!active.current||!touchLast)return;
      rotate((e.clientX-touchLast.x)*2,(e.clientY-touchLast.y)*2);
      touchLast={x:e.clientX,y:e.clientY};
    };
    const touchUp = () => {touchLast=null;};
    const keydown = (e:KeyboardEvent) => {
      if(e.code==='Escape'){pause();return;}
      if(!active.current)return;
      if(!['KeyW','KeyA','KeyS','KeyD','KeyE','Space'].includes(e.code))return;
      e.preventDefault();keys.current.add(e.code);
      if(e.code==='KeyE'&&!e.repeat)interact.current();
      if(e.code==='Space'&&!e.repeat)primary.current();
    };
    const keyup = (e:KeyboardEvent) => keys.current.delete(e.code);
    const visibility = () => {if(document.hidden)pause();};
    const focus = (e:FocusEvent) => {
      if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement)pause();
    };
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',touchMove);
    canvas.addEventListener('pointerup',touchUp);canvas.addEventListener('pointercancel',touchUp);
    canvas.addEventListener('lostpointercapture',touchUp);
    document.addEventListener('pointerlockchange',lockChanged);document.addEventListener('pointerlockerror',fail);
    document.addEventListener('mousemove',mouseMove);document.addEventListener('mouseleave',leaveWindow);
    document.addEventListener('pointerdown',outsideDown,true);document.addEventListener('visibilitychange',visibility);
    document.addEventListener('focusin',focus);
    window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',pause);
    return () => {
      canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',touchMove);
      canvas.removeEventListener('pointerup',touchUp);canvas.removeEventListener('pointercancel',touchUp);
      canvas.removeEventListener('lostpointercapture',touchUp);
      document.removeEventListener('pointerlockchange',lockChanged);document.removeEventListener('pointerlockerror',fail);
      document.removeEventListener('mousemove',mouseMove);document.removeEventListener('mouseleave',leaveWindow);
      document.removeEventListener('pointerdown',outsideDown,true);document.removeEventListener('visibilitychange',visibility);
      document.removeEventListener('focusin',focus);
      window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',pause);
      pause();
    };
  }, [mode,reset,camera,gl,onNear,onActiveChange,onError,movement,size.width,size.height]);

  useFrame((_,dt) => {
    if(orbit.current){orbit.current.rotateSpeed=sensitivityRef.current;orbit.current.update();}
    if(mode !== 'walk') return;
    // Both physical keys and on-screen WASD are ignored until the scene is entered.
    const pressed=(code:MoveKey)=>active.current&&(keys.current.has(code)||movement.has(code));
    const y=Number(pressed('KeyW'))-Number(pressed('KeyS'));
    const x=Number(pressed('KeyD'))-Number(pressed('KeyA'));
    camera.getWorldDirection(forward.current);forward.current.y=0;forward.current.normalize();
    right.current.crossVectors(forward.current,new Vector3(0,1,0)).normalize();
    const length=Math.hypot(x,y)||1, speed=Math.min(dt,0.05)*3;
    const dx=(forward.current.x*y+right.current.x*x)/length*speed;
    const dz=(forward.current.z*y+right.current.z*x)/length*speed;
    if(canStand(camera.position.x+dx,camera.position.z))camera.position.x+=dx;
    if(canStand(camera.position.x,camera.position.z+dz))camera.position.z+=dz;
    let next:Station=null, closest=3.1;
    for(const [name,position] of Object.entries(STATIONS)){
      const d=Math.hypot(camera.position.x-position.x,camera.position.z-position.z);
      if(d<closest){closest=d;next=name as Station;}
    }
    if(next!==near.current){near.current=next;onNear(next);}
  });
  return null;
}
