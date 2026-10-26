import type { ReactNode } from 'react';
import { useI18n } from './i18n';

export const goldIconUrl = new URL('../../assets/3d/tools/Gold-icon.png', import.meta.url).href;

export default function GoldIcon({ size = 'small' }: { size?: 'small' | 'large' }) {
  return <i className={`gold-icon gold-icon--${size}`} aria-hidden="true"><img src={goldIconUrl} alt="" decoding="async"/></i>;
}

export function GoldAmount({ amount }: { amount: ReactNode }) {
  const { t } = useI18n();
  return <span className="gold-amount"><GoldIcon/><span>{amount}</span><small>{t('金币')}</small></span>;
}
