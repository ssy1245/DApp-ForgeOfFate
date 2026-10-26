import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from './i18n';
import WeaponArtwork from './WeaponArtwork';
import { getWeaponLore, type WeaponLoreEntry } from './weaponLoreData';
import { type WeaponIdentity } from './weaponImages';
import './weaponLore.css';

function LoreReader({ weapon, entry }: { weapon: WeaponIdentity; entry: WeaponLoreEntry }) {
  const { t, name, locale } = useI18n();
  const [opened, setOpened] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    if (!opened || !dialog.current) return;
    const panel = dialog.current;
    const previousOverflow = document.body.style.overflow;
    panel.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      if (panel.open) panel.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [opened]);

  return <>
    <button type="button" className="weapon-lore-trigger" aria-haspopup="dialog" aria-expanded={opened} aria-controls={opened ? id : undefined} onClick={() => setOpened(true)}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/></svg>
      <span>{t('武器描述与故事')}</span><span className="lore-trigger-arrow" aria-hidden="true">↗</span>
    </button>
    {opened && <dialog ref={dialog} id={id} className="weapon-lore-dialog" aria-labelledby={`${id}-title`} onClose={() => setOpened(false)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="lore-sheet">
        <header className="lore-heading">
          <div><p className="lore-kicker">{t('武器描述与故事')}</p><h2 id={`${id}-title`}>{name(weapon)} <span>+{weapon.level}</span></h2></div>
          <button type="button" className="lore-close" autoFocus onClick={() => dialog.current?.close()}>{t('关闭')} <span aria-hidden="true">×</span></button>
        </header>
        <div className="lore-layout">
          <aside className="lore-art"><WeaponArtwork weapon={weapon}/></aside>
          <div className="lore-copy" lang={locale === 'en' ? 'en' : 'zh-CN'}>
            <section aria-labelledby={`${id}-description`}><h4 id={`${id}-description`}>{t('武器描述')}</h4><p>{entry.description}</p></section>
            <section className="lore-story" aria-labelledby={`${id}-story`}><h4 id={`${id}-story`}>{t('故事片段')}</h4><div>{entry.story.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></section>
          </div>
        </div>
      </div>
    </dialog>}
  </>;
}

export default function WeaponLore({ weapon }: { weapon: WeaponIdentity }) {
  const { locale } = useI18n();
  const entry = getWeaponLore(weapon, locale);
  return entry ? <LoreReader key={entry.tierId} weapon={weapon} entry={entry}/> : null;
}
