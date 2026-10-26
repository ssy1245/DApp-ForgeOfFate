import { useI18n } from './i18n';
import type { ReactNode } from 'react';

// Vite includes this UI image in development and emits a cached asset at build time.
export const ironIconUrl = new URL('../../assets/3d/tools/Fe-icon.png', import.meta.url).href;

export default function IronIcon({ size = 'small' }: { size?: 'small' | 'large' }) {
  return <i className={`iron-icon iron-icon--${size}`} aria-hidden="true"><img src={ironIconUrl} alt="" decoding="async"/></i>;
}

export function IronAmount({ amount }: { amount: ReactNode }) {
 const {t} = useI18n();
  return <span className="material-amount"><IronIcon/>{amount} {t(" 铁块")}</span>;
}
