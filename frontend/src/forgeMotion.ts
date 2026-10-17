import { Euler, Quaternion, Vector3 } from 'three';
import { ANVIL_POSITION } from './workshopLayout';

// Shared world-space contact and timing keep the hammer face, sparks and outcome together.
export const FORGE_CONTACT = new Vector3(ANVIL_POSITION[0]-0.65,ANVIL_POSITION[1]+0.76,ANVIL_POSITION[2]+0.06);
export const IMPACT_MS = 410;
export const SWING_MS = 900;
export const HAMMER_FACE = new Vector3(-0.385, 0.75, 0);
export const IMPACT_ROTATION = new Quaternion().setFromEuler(new Euler(0, 0.12, Math.PI / 2));
export const IMPACT_GRIP = FORGE_CONTACT.clone().sub(HAMMER_FACE.clone().applyQuaternion(IMPACT_ROTATION));
export const WINDUP_GRIP = IMPACT_GRIP.clone().add(new Vector3(0.55, 0.75, 0.5));
export const WINDUP_ROTATION = new Quaternion().setFromEuler(new Euler(-0.35, 0.12, -0.3));
export const smooth = (t:number) => {const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
