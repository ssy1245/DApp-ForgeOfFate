import type { ReactNode } from 'react';
import { useI18n } from './i18n';

// The supplied artwork is already transparent; use the original PNG unchanged.
export const wardIconUrl = new URL('../../assets/3d/tools/protect.png', import.meta.url).href;

export default function WardIcon({ size = 'small' }: { size?: 'small' | 'medium' | 'large' }) {
  return <i className={`ward-icon ward-icon--${size}`} aria-hidden="true"><img src={wardIconUrl} alt="" decoding="async"/></i>;
}

export function WardAmount({ amount }: { amount: ReactNode }) {
  const { t } = useI18n();
  return <span className="ward-amount"><WardIcon/>{amount} {t('保护符')}</span>;
}
