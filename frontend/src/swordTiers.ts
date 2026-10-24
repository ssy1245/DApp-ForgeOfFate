import branches from '../../assets/3d/sword-branches.json';
import catalog from '../../assets/3d/sword-tiers.json';
export type SwordTier = typeof catalog[number];
export const swordTiers: SwordTier[] = catalog.filter(tier => tier.branch === 'longsword');
export function swordTier(level: number, tiers: SwordTier[] = swordTiers): SwordTier {
  return [...tiers].reverse().find(tier => level >= tier.min_level) ?? tiers[0];
}
export function nextSwordTier(level: number, tiers: SwordTier[] = swordTiers): SwordTier | undefined {
  return tiers.find(tier => tier.min_level > level);
}

export const swordBranches = branches;
export function branchTiers(branch = 'longsword', main: SwordTier[] = swordTiers): SwordTier[] {
  const route = swordBranches.find(item => item.id === branch);
  if (!route || route.id === 'longsword') return main;
  const tiers = route.tiers ?? catalog.filter(tier => tier.branch === route.id);
  return [main[0], ...tiers];
}
