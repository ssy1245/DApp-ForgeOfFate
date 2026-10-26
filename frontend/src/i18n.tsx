import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createTranslator, formatNumber, persistLocale, readLocale, type Locale, type Translator } from './locale';
import { artworkTier, type WeaponIdentity } from './weaponImages';

type Named = Omit<WeaponIdentity, 'level'> & { level?: number };
type I18n = { locale: Locale; setLocale: (locale: Locale) => void; t: Translator; name: (value: Named) => string; number: (value: number) => string };
const Context = createContext<I18n | null>(null);

export function LanguageProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (initialLocale) return initialLocale;
    try { return readLocale(window.localStorage); } catch { return 'zh'; }
  });
  useEffect(() => {
    try { persistLocale(locale, window.localStorage); } catch { /* Keep the current session usable. */ }
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
    document.title = locale === 'en' ? 'Forge of Fate' : 'Forge of Fate · 命运锻造所';
  }, [locale]);
  const value = useMemo<I18n>(() => {
    const t = createTranslator(locale);
    return { locale, setLocale, t, number: value => formatNumber(locale, value), name: value => {
      const tier = value.level === undefined ? undefined : artworkTier({ ...value, level: value.level });
      const raw = (locale === 'en' ? value.name_en || tier?.name_en : value.name || tier?.name) || value.name || '';
      const clean = raw.replace(/^\[DEMO\]\s*/i, '').replace(/\s*\+\d+\s*$/, '').trim();
      const translated = t(clean);
      return translated || t('未知武器');
    } };
  }, [locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n() {
  const value = useContext(Context);
  if (!value) throw Error('LanguageProvider is required');
  return value;
}

export function LanguageSwitch() {
  const { locale, setLocale } = useI18n();
  return <div className="language-switch" role="group" aria-label={locale === 'en' ? 'Language' : '语言'}>
    <button type="button" lang="zh-CN" aria-label="切换为中文" aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button>
    <button type="button" lang="en" aria-label="Switch to English" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button>
  </div>;
}
