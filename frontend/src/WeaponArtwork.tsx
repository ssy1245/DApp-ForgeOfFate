import { useState } from 'react';
import { artworkTier, displayImageUrl, type WeaponIdentity } from './weaponImages';

export default function WeaponArtwork({weapon, nft = false}: {weapon: WeaponIdentity; nft?: boolean}) {
  const tier = artworkTier(weapon);
  const source = tier?.display ? displayImageUrl(tier.display) : undefined;
  const [failedSource, setFailedSource] = useState<string>();
  const label = `${tier?.name || weapon.name || '武器'} +${weapon.level}`;
  const failed = () => setFailedSource(source);

  return <div className={`weapon-art${source && source !== failedSource ? ' has-display' : ''}${nft ? ' nft' : ''}`}>
    <div className="artwork-rule" aria-hidden="true"><span>FORGE OF FATE</span><i>✦</i></div>
    {source && source !== failedSource ?
      <img className="weapon-reference" src={source} alt={label} loading="lazy" decoding="async" onError={failed}/>
      : <span className="weapon-art-fallback" role="img" aria-label={`${label}，暂无图片`}>⚔</span>}
    <div className="weapon-level"><small>强化等级</small><span>+{weapon.level}</span></div>
    <span className="artwork-caption">{nft ? '链上藏品' : '锻造藏品'}<small>{nft ? 'ON-CHAIN RELIC' : 'FORGED IN EMBER'}</small></span>
  </div>;
}
