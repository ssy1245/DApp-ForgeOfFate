import catalog from '../../assets/3d/sword-tiers.json';
import { branchTiers, swordBranches, swordTier, type SwordTier } from './swordTiers';
export { referenceImageUrl, displayImageUrl } from './modelAssets';

export type WeaponIdentity = {
  level: number;
  tier_id?: string;
  branch?: string;
  name?: string;
  name_en?: string;
};

const normalizedName = (name = '') => name.replace(/^\[DEMO\]\s*/i, '').replace(/\s*\+\d+\s*$/, '').trim().toLowerCase();
export function artworkTier(weapon: WeaponIdentity): SwordTier | undefined {
  // Frozen NFT IDs retain their identity when the live game's thresholds move.
  const byId = catalog.find(tier => tier.id === weapon.tier_id);
  if (byId) return byId;
  const names = [weapon.name, weapon.name_en].filter(Boolean).map(name => normalizedName(name));
  const byName = catalog.find(tier => tier.min_level > 0 && names.some(name => name === normalizedName(tier.name) || name === normalizedName(tier.name_en)));
  if (byName) return byName;
  if (swordBranches.some(branch => branch.id === weapon.branch)) return swordTier(weapon.level, branchTiers(weapon.branch));
  if (names.some(name => name === normalizedName(catalog[0].name) || name === normalizedName(catalog[0].name_en))) return catalog[0];
  return undefined;
}

export function nftWeaponDetails(value: unknown) {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const attributes = Array.isArray(data.attributes) ? data.attributes.filter(item => item && typeof item === 'object') : [];
  const type = attributes.find(item => item.trait_type === 'Weapon Type')?.value;
  const branch = typeof data.branch === 'string' ? data.branch : typeof type === 'string' ? type : undefined;
  return {
    name: typeof data.name === 'string' ? data.name : '余烬长剑',
    name_en: typeof data.name_en === 'string' ? data.name_en : undefined,
    tier_id: typeof data.tier_id === 'string' ? data.tier_id : undefined,
    branch,
    demo: attributes.some(item => item.trait_type === 'Demo' && item.value === true),
  };
}
