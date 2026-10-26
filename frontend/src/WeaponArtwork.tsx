import { useId, useState } from 'react';
import { artworkTier, referenceImageUrl, type WeaponIdentity } from './weaponImages';

export default function WeaponArtwork({weapon, nft = false}: {weapon: WeaponIdentity; nft?: boolean}) {
  const tier = artworkTier(weapon);
  const source = tier?.reference ? referenceImageUrl(tier.reference) : undefined;
  const [failedSource, setFailedSource] = useState<string>();
  const clipId = useId();
  const frame = tier?.reference_frame;
  const label = `${tier?.name || weapon.name || '武器'} +${weapon.level}`;
  const failed = () => setFailedSource(source);

  return <div className={`weapon-art${source && source !== failedSource ? ' has-reference' : ''}${nft ? ' nft' : ''}`}>
    {source && source !== failedSource ? frame ?
      <svg className="weapon-reference" viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`} role="img" aria-label={label} style={{transform: `rotate(${frame.rotation}deg)`}}>
        <defs><clipPath id={clipId}><rect x={frame.x} y={frame.y} width={frame.width} height={frame.height}/></clipPath></defs>
        <image href={source} width={frame.image_width} height={frame.image_height} clipPath={`url(#${clipId})`} onError={failed}/>
      </svg> :
      <img className="weapon-reference" src={source} alt={label} loading="lazy" decoding="async" onError={failed}/>
      : <span className="weapon-art-fallback" role="img" aria-label={`${label}，暂无图片`}>⚔</span>}
    <span className="weapon-level">+{weapon.level}</span>
    {nft && <small>NFT</small>}
  </div>;
}
