// The workstations line the back and side walls, leaving the center floor open.
export const ANVIL_POSITION = [0.4, 0.6, -5] as const;
export const CABINET_ROTATION = -Math.PI / 2;
export const CABINET_SCALE = [1.9, 2.15, 1.55] as const;
// Local heights: extend the display cavity while keeping the feet on the floor
// and the top below the workshop beams. Sword scale stays independent of height.
export const CABINET_FRAME = {baseY:-1.15,topY:1.21,baseThickness:0.22,railThickness:0.12,feetBottom:-1.4} as const;
export const CABINET_INTERIOR = {
 bottom:CABINET_FRAME.baseY+CABINET_FRAME.baseThickness/2,
 top:CABINET_FRAME.topY-CABINET_FRAME.railThickness/2,
} as const;
export const CABINETS = [
 {id:'cabinet-1',label:'展示柜 1',position:[9.15,2.26,-3.7]},
 {id:'cabinet-2',label:'展示柜 2',position:[9.15,2.26,0.25]},
 {id:'cabinet-3',label:'展示柜 3',position:[9.15,2.26,4.2]},
] as const;
export type CabinetId = typeof CABINETS[number]['id'];
export function isCabinet(station:string|null):station is CabinetId {
 return CABINETS.some(cabinet=>cabinet.id===station);
}
export const CRATE_POSITION = [-9.25, -0.35, 1] as const;
export const SWORD_SUPPLY_POSITION = [-8.9, -0.75, 5] as const;
export const SWORD_SUPPLY_FOOTPRINT = {halfDepth:0.65,halfWidth:1.6,clearance:0.3};
export const FURNACE_POSITION = [-7.1, -0.75, -5.2] as const;
// Work surfaces: anvil = 1.21; furnace hearth = 1.23.
export const FURNACE_RAISE = 0.95;
export const FURNACE_WIDTH_SCALE = 1.35;
export const FURNACE_FOOTPRINT = {halfWidth:2.7,back:1.4,front:2.05,clearance:0.3};

export function canStand(x:number,z:number){
 if(Math.abs(x)>9.5||z>9||z< -6)return false;
 const ax=x-ANVIL_POSITION[0],az=z-ANVIL_POSITION[2];
 if(ax> -3.4&&ax<4.25&&Math.abs(az)<1.6)return false;
 // All three cabinets face inward; include clearance around their enlarged frames.
 if(CABINETS.some(({position})=>Math.abs(x-position[0])<0.45*CABINET_SCALE[2]+0.3&&Math.abs(z-position[2])<0.825*CABINET_SCALE[0]+0.3))return false;
 const fx=x-FURNACE_POSITION[0],fz=z-FURNACE_POSITION[2],f=FURNACE_FOOTPRINT;
 if(Math.abs(fx)<f.halfWidth+f.clearance&&fz> -f.back-f.clearance&&fz<f.front+f.clearance)return false;
 if(Math.abs(x-CRATE_POSITION[0])<0.8&&Math.abs(z-CRATE_POSITION[2])<0.8)return false;
 const supply=SWORD_SUPPLY_FOOTPRINT;
 if(Math.abs(x-SWORD_SUPPLY_POSITION[0])<supply.halfDepth+supply.clearance&&Math.abs(z-SWORD_SUPPLY_POSITION[2])<supply.halfWidth+supply.clearance)return false;
 return true;
}
