import knightText from '../../assets/stories/weapons/knightsword-stories.md?raw';
import rapierText from '../../assets/stories/weapons/rapier-stories.md?raw';
import greatswordText from '../../assets/stories/weapons/greatsword-stories.md?raw';
import catalog from '../../assets/3d/sword-tiers.json';
import { type WeaponLocale } from './swordTiers';
import { artworkTier, type WeaponIdentity } from './weaponImages';

export type WeaponLoreEntry = {
  tierId: string;
  description: string;
  story: string[];
};

// The Markdown document remains the source for both authoring and the reader.
export function parseWeaponLore(markdown: string, locale: WeaponLocale = 'zh'): WeaponLoreEntry[] {
  return markdown.replace(/\r\n?/g, '\n').split(/^##\s+/m).slice(1).flatMap(section => {
    const heading = section.split('\n', 1)[0];
    const title = heading.match(/^\+\d+(?:[～~–-]\+?\d+)?\s*·\s*(.+)$/)?.[1].trim();
    const tier = catalog.find(item => item.name === title);
    if (!tier) return [];

    const contents = new Map(section.split(/^###\s+/m).slice(1).map(block => {
      const [label, ...lines] = block.split('\n');
      return [label.trim(), lines.join('\n').trim()];
    }));
    const description = contents.get(locale === 'en' ? 'Weapon description' : '武器描述');
    const story = contents.get(locale === 'en' ? 'Story fragment' : '故事片段');
    if (!description || !story) return [];
    return [{ tierId: tier.id, description, story: story.split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean) }];
  });
}

const documents = [knightText, rapierText, greatswordText];
const entries = {
  zh: new Map(documents.flatMap(text => parseWeaponLore(text, 'zh')).map(entry => [entry.tierId, entry])),
  en: new Map(documents.flatMap(text => parseWeaponLore(text, 'en')).map(entry => [entry.tierId, entry])),
};

export function getWeaponLore(weapon: WeaponIdentity, locale: WeaponLocale = 'zh'): WeaponLoreEntry | undefined {
  const tier = artworkTier(weapon);
  return tier ? entries[locale].get(tier.id) : undefined;
}
