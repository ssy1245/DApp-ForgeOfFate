import { useI18n } from './i18n';
import { type ReactNode } from 'react';
import WeaponArtwork from './WeaponArtwork';
import { artworkTier, type WeaponIdentity } from './weaponImages';
import { swordBranches } from './swordTiers';

type CardWeapon = WeaponIdentity & { demo?: boolean | number; quality?: string };
type Props = {
  weapon: CardWeapon;
  serial: string;
  status: string;
  statusTone?: 'active' | 'sealed' | 'listed';
  nft?: boolean;
  detail?: ReactNode;
  valueLabel: string;
  value: ReactNode;
  valueUnit?: string;
  children: ReactNode;
};

const cleanName = (name = '') => name.replace(/^\[DEMO\]\s*/i, '').replace(/\s*\+\d+\s*$/, '').trim();

export default function WeaponCard({ weapon, serial, status, statusTone = 'active', nft = false, detail, valueLabel, value, valueUnit, children }: Props) {
  const {t, name, locale} = useI18n();
  const tier = artworkTier(weapon);
  const route = swordBranches.find(item => item.id === (weapon.branch || tier?.branch));
  const displayName = name(weapon);
  const englishName = cleanName(weapon.name_en) || tier?.name_en;

  return <article className="weapon-card" data-branch={route?.id || 'unknown'} data-nft={nft || undefined}>
    <div className="card-topline">
      <span className={`card-status ${statusTone}`}><i aria-hidden="true"/>{status}</span>
      <span className="card-serial" title={serial}>{serial}</span>
    </div>
    <WeaponArtwork weapon={weapon} nft={nft}/>
    <div className="card-body">
      <div className="card-route"><span>{route ? name(route) : t('武器藏品')}</span><span>{weapon.quality ? t(weapon.quality) : (nft ? 'NFT' : t('锻造武器'))}{weapon.demo ? ' · DEMO' : ''}</span></div>
      <h3>{displayName}</h3>
      {locale === 'zh' && englishName && <p className="card-english" lang="en">{englishName}</p>}
      {detail && <div className="card-detail">{detail}</div>}
      <div className="card-valuation"><span>{valueLabel}</span><div><strong>{value}</strong>{valueUnit && <small>{valueUnit}</small>}</div></div>
      <div className="card-actions">{children}</div>
    </div>
  </article>;
}
