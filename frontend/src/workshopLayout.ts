// The workstations line the back and side walls, leaving the center floor open.
export const ANVIL_POSITION = [0.4, 0.6, -5] as const;
export const CABINET_POSITION = [9.35, 1.77, -3.5] as const;
export const CABINET_ROTATION = -Math.PI / 2;
export const CRATE_POSITION = [-9.25, -0.35, 1] as const;
export const FURNACE_POSITION = [-7.1, -0.75, -5.2] as const;
// Work surfaces: anvil = 1.21; furnace hearth = 1.23.
export const FURNACE_RAISE = 0.95;
export const FURNACE_WIDTH_SCALE = 1.35;
export const FURNACE_FOOTPRINT = {halfWidth:2.7,back:1.4,front:2.05,clearance:0.3};

export function canStand(x:number,z:number){
 if(Math.abs(x)>9.5||z>9||z< -6)return false;
 const ax=x-ANVIL_POSITION[0],az=z-ANVIL_POSITION[2];
 if(ax> -3.4&&ax<4.25&&Math.abs(az)<1.6)return false;
 // The cabinet faces inward from the right wall.
 if(x>CABINET_POSITION[0]-0.95&&x<CABINET_POSITION[0]+0.95&&Math.abs(z-CABINET_POSITION[2])<1.5)return false;
 const fx=x-FURNACE_POSITION[0],fz=z-FURNACE_POSITION[2],f=FURNACE_FOOTPRINT;
 if(Math.abs(fx)<f.halfWidth+f.clearance&&fz> -f.back-f.clearance&&fz<f.front+f.clearance)return false;
 if(Math.abs(x-CRATE_POSITION[0])<0.8&&Math.abs(z-CRATE_POSITION[2])<0.8)return false;
 return true;
}
