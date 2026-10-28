import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { useI18n } from './i18n';
import { WAREHOUSE_POSITION } from './workshopLayout';

export default function WarehouseChest({ onInteract }: { onInteract: () => void }) {
  const { t } = useI18n();
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 220;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#192521'; ctx.fillRect(0, 0, 640, 220);
    ctx.strokeStyle = '#b89456'; ctx.lineWidth = 6; ctx.strokeRect(5, 5, 630, 210);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f0d7a4';
    ctx.font = 'bold 48px sans-serif'; ctx.fillText(t('武器仓库'), 320, 78, 590);
    ctx.font = '30px sans-serif'; ctx.fillStyle = '#bcc9b5'; ctx.fillText(t('存入 · 取出 · 继续锻造'), 320, 160, 590);
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace; return map;
  }, [t]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <group name="warehouse-chest" position={[...WAREHOUSE_POSITION]} onClick={event => { if (event.delta > 4) return; event.stopPropagation(); onInteract(); }}>
    <group rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, .7, 0]} castShadow receiveShadow><boxGeometry args={[2.6, 1.3, 1.45]}/><meshStandardMaterial color="#493c2b" roughness={.8}/></mesh>
      <mesh position={[0, 1.4, 0]} castShadow><boxGeometry args={[2.72, .2, 1.55]}/><meshStandardMaterial color="#745b3a" roughness={.7}/></mesh>
      {[-.9, .9].map(x => <mesh key={x} position={[x, .8, .01]} castShadow><boxGeometry args={[.13, 1.55, 1.5]}/><meshStandardMaterial color="#99814d" metalness={.7} roughness={.5}/></mesh>)}
      <mesh position={[0, 1.04, .76]}><boxGeometry args={[.28, .42, .1]}/><meshStandardMaterial color="#c9a05c" metalness={.75} roughness={.35}/></mesh>
      {[-.55, 0, .55].map(x => <mesh key={x} position={[x, .7, .731]}><boxGeometry args={[.02, 1.15, .01]}/><meshStandardMaterial color="#2a281f"/></mesh>)}
    </group>
    <group position={[-.8, 2.65, 0]} rotation={[0, Math.PI / 2, 0]}>
      <mesh><boxGeometry args={[2.9, 1, .07]}/><meshStandardMaterial color="#493c2b" roughness={.85}/></mesh>
      <mesh position={[0, 0, .04]}><planeGeometry args={[2.9, 1]}/><meshBasicMaterial map={texture} toneMapped={false}/></mesh>
    </group>
    <pointLight position={[1.4, 2.4, 0]} intensity={7} distance={5} color="#e7c48b"/>
  </group>;
}
