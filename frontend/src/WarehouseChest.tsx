import { useEffect, useMemo, useState } from 'react';
import { Box3, CanvasTexture, Group, Mesh, SRGBColorSpace, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useI18n } from './i18n';
import { modelUrl } from './modelAssets';
import { WAREHOUSE_POSITION, WAREHOUSE_FOOTPRINT } from './workshopLayout';

function releaseModel(root: Group) {
  const resources = new Set<{ dispose: () => void }>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      resources.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) resources.add(value);
    }
  });
  resources.forEach(resource => resource.dispose());
}

function ChestModel() {
  const [model, setModel] = useState<Group | null>(null);
  useEffect(() => {
    let live = true;
    let loaded: Group | undefined;
    new GLTFLoader().loadAsync(modelUrl('weapon storage')).then(({ scene }) => {
      if (!live) { releaseModel(scene); return; }
      const bounds = new Box3().setFromObject(scene);
      const size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
      // Keep the original proportions and floor contact inside the walk collision box.
      const scale = Math.min(WAREHOUSE_FOOTPRINT.halfWidth * 2 / size.x, WAREHOUSE_FOOTPRINT.halfDepth * 2 / size.z);
      scene.position.sub(new Vector3(center.x, bounds.min.y, center.z));
      const root = new Group(); root.name = 'warehouse-chest-model';
      root.add(scene); root.scale.setScalar(scale);
      root.traverse(object => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; } });
      loaded = root; setModel(root);
    }).catch(() => { /* The fallback chest remains usable if the asset is unavailable. */ });
    return () => { live = false; if (loaded) releaseModel(loaded); };
  }, []);
  return model ? <primitive object={model} dispose={null}/> : <FallbackChest/>;
}

function FallbackChest() {
  return <group name="warehouse-chest-fallback" scale={WAREHOUSE_FOOTPRINT.halfWidth / 1.36}>
    <mesh position={[0, .7, 0]} castShadow receiveShadow><boxGeometry args={[2.6, 1.3, 1.45]}/><meshStandardMaterial color="#493c2b" roughness={.8}/></mesh>
    <mesh position={[0, 1.4, 0]} castShadow><boxGeometry args={[2.72, .2, 1.55]}/><meshStandardMaterial color="#745b3a" roughness={.7}/></mesh>
    {[-.9, .9].map(x => <mesh key={x} position={[x, .8, .01]} castShadow><boxGeometry args={[.13, 1.55, 1.5]}/><meshStandardMaterial color="#99814d" metalness={.7} roughness={.5}/></mesh>)}
    <mesh position={[0, 1.04, .76]}><boxGeometry args={[.28, .42, .1]}/><meshStandardMaterial color="#c9a05c" metalness={.75} roughness={.35}/></mesh>
  </group>;
}

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
      <ChestModel/>
    </group>
    <group position={[-.8, 3.05, 0]} rotation={[0, Math.PI / 2, 0]}>
      <mesh><boxGeometry args={[3.2, 1, .07]}/><meshStandardMaterial color="#493c2b" roughness={.85}/></mesh>
      <mesh position={[0, 0, .04]}><planeGeometry args={[3.2, 1]}/><meshBasicMaterial map={texture} toneMapped={false}/></mesh>
    </group>
    <pointLight position={[1.4, 2.4, 0]} intensity={7} distance={5} color="#e7c48b"/>
  </group>;
}
