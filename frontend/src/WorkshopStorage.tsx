import { useI18n } from './i18n';

type Props = {
  weapon?: { id: string; name: string; name_en?: string; level: number; branch?: string };
  storedCount: number;
  disabled: boolean;
  onStore: () => void;
  onOpen: () => void;
};

export default function WorkshopStorage({ weapon, storedCount, disabled, onStore, onOpen }: Props) {
  const { t, name } = useI18n();
  return <section className="workshop-storage" aria-label={t('工坊武器与仓库')}>
    <div className="workshop-storage-copy"><span>{t('当前工坊')}</span>
      <strong>{weapon ? `${name(weapon)} +${weapon.level}` : t('工坊空闲')}</strong>
    </div>
    <div className="workshop-storage-actions">
      <button className="secondary" disabled={disabled || !weapon} onClick={onStore}>{t('存入仓库')}</button>
      <button className="primary" disabled={disabled} onClick={onOpen}>{t('打开武器仓库')} <span>{storedCount}</span></button>
    </div>
  </section>;
}
